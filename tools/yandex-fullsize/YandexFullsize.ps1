# Yandex Disk full-size downloader
# Double-click YandexFullsize.bat. Paste a public link. Each file is downloaded
# on its own, at original size, into the same folders as on the disk.
# A whole-folder zip is never requested: that call hangs while Disk is unstable.
#
# Headless check (no window): 
#   powershell -File YandexFullsize.ps1 -SelfTestUrl http://127.0.0.1:9/d/x -SelfTestDest C:\temp\out

param(
    [string]$SelfTestUrl = "",
    [string]$SelfTestDest = "",
    [int]$SelfTestLimit = 0
)

# Shown at the top of the window. Change this number whenever the file is updated.
$script:AppVersion = "1.6"

$script:selfTest = -not [string]::IsNullOrWhiteSpace($SelfTestUrl)

if (-not $script:selfTest) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    try {
        Add-Type @"
using System;
using System.Runtime.InteropServices;
public class YandexFullsizeWin32 {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, string lParam);
    [DllImport("user32.dll", EntryPoint = "SendMessage")]
    public static extern IntPtr SendMessageInt(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
}
"@
        [YandexFullsizeWin32]::SetProcessDPIAware() | Out-Null
    } catch {
    }

    [System.Windows.Forms.Application]::EnableVisualStyles()
}

try {
    $protocols = [System.Net.SecurityProtocolType]::Tls12
    $tls13 = [Enum]::Parse([System.Net.SecurityProtocolType], "Tls13")
    $protocols = $protocols -bor $tls13
    [System.Net.ServicePointManager]::SecurityProtocol = $protocols
} catch {
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    } catch {
    }
}
try {
    [System.Net.ServicePointManager]::Expect100Continue = $false
    [System.Net.ServicePointManager]::DefaultConnectionLimit = 8
} catch {
}

# .NET Framework turns "?public_key=https://..." into an extra path segment.
# Yandex then answers 404 with description "Not Found" and nothing downloads.
function Enable-RawQueryUris {
    try {
        $parserType = [System.UriParser]
        $getSyntax = $parserType.GetMethod("GetSyntax", [Reflection.BindingFlags]"Static,NonPublic")
        $field = $parserType.GetField("m_Flags", [Reflection.BindingFlags]"Instance,NonPublic")
        if (-not $field) {
            $field = $parserType.GetField("_flags", [Reflection.BindingFlags]"Instance,NonPublic")
        }
        if (-not $getSyntax -or -not $field) { return }
        $unescapeDotsAndSlashes = 33554432
        foreach ($scheme in @("http", "https")) {
            $parser = $getSyntax.Invoke($null, @($scheme))
            if (-not $parser) { continue }
            $current = [int]$field.GetValue($parser)
            $updated = $current -band (-bnot $unescapeDotsAndSlashes)
            if ($updated -eq $current) { continue }
            $field.SetValue($parser, [Enum]::ToObject($field.FieldType, $updated))
        }
    } catch {
    }
}
Enable-RawQueryUris

$script:sync = [hashtable]::Synchronized(@{
    Cancel = $false
    Done = $false
    Current = 0
    Total = 0
    Status = "Вставьте публичную ссылку на папку Яндекс Диска."
    OpenPath = ""
    Request = $null
    Process = $null
    PartFile = ""
    PartName = ""
    PartGot = [int64]0
    PartExpected = [int64]0
    SavedCount = 0
    FailedCount = 0
    FinishedCount = 0
})
$script:sync.Messages = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))
$script:job = $null

function Add-LogLine([string]$text) {
    [void]$script:sync.Messages.Add($text)
}

$worker = {
    param($sync, $publicUrl, $destRoot, $makeRootFolder, $fileLimit)

    $ErrorActionPreference = "Stop"
    $userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    $state = @{
        Sk = ""
        Origin = ""
        Cookies = (New-Object System.Net.CookieContainer)
    }

    function Write-Log([string]$text) {
        if ($text.Length -gt 500) { $text = $text.Substring(0, 500) }
        [void]$sync.Messages.Add($text)
    }

    function Assert-Continue {
        if ($sync.Cancel) { throw "CANCELLED" }
    }

    function ConvertTo-SafeSegment([string]$name) {
        if ([string]::IsNullOrWhiteSpace($name)) { return "_" }
        $invalid = [System.IO.Path]::GetInvalidFileNameChars()
        $chars = $name.ToCharArray()
        for ($i = 0; $i -lt $chars.Length; $i++) {
            if ($invalid -contains $chars[$i]) { $chars[$i] = "_" }
        }
        $clean = (-join $chars).Trim().TrimEnd(".", " ")
        if ([string]::IsNullOrWhiteSpace($clean)) { $clean = "_" }
        $stem = [System.IO.Path]::GetFileNameWithoutExtension($clean)
        $reserved = @(
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
        )
        if ($reserved -contains $stem.ToUpperInvariant()) { $clean = "_" + $clean }
        return $clean
    }

    function Get-SafeRelative([string]$diskPath, [string]$fallbackName) {
        $parts = @($diskPath -split "/" | Where-Object { $_ -and ($_ -ne ".") -and ($_ -ne "..") })
        if ($parts.Count -eq 0) { return (ConvertTo-SafeSegment $fallbackName) }
        $safe = foreach ($part in $parts) { ConvertTo-SafeSegment $part }
        return ($safe -join [System.IO.Path]::DirectorySeparatorChar)
    }

    function Format-ByteCount([int64]$n) {
        if ($n -ge 1MB) { return ("{0:N1} МБ" -f ($n / 1MB)) }
        if ($n -ge 1KB) { return ("{0:N0} КБ" -f ($n / 1KB)) }
        return "$n Б"
    }

    function Get-CurlPath {
        if ($env:SystemRoot) {
            foreach ($rel in @("System32\curl.exe", "Sysnative\curl.exe")) {
                $candidate = Join-Path $env:SystemRoot $rel
                if ([System.IO.File]::Exists($candidate)) { return $candidate }
            }
        }
        $cmd = @(Get-Command curl -CommandType Application -ErrorAction SilentlyContinue) | Select-Object -First 1
        if ($cmd -and $cmd.Source) { return [string]$cmd.Source }
        return $null
    }

    function Get-FileLength([string]$path) {
        if ([string]::IsNullOrWhiteSpace($path)) { return [int64]0 }
        if (-not [System.IO.File]::Exists($path)) { return [int64]0 }
        try {
            $stream = [System.IO.File]::Open(
                $path,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::ReadWrite
            )
            try { return [int64]$stream.Length } finally { $stream.Close() }
        } catch {
            try { return [int64](New-Object System.IO.FileInfo $path).Length } catch { return [int64]0 }
        }
    }

    function ConvertTo-ErrorText([string]$body, [string]$fallback) {
        if ($body -match '"message"\s*:\s*"((?:\\.|[^"\\])*)"') {
            return (($Matches[1] -replace '\\"', '"') -replace '\\n', ' ')
        }
        if ($body -match '"title"\s*:\s*"((?:\\.|[^"\\])*)"') {
            return (($Matches[1] -replace '\\"', '"') -replace '\\n', ' ')
        }
        if ($body -match '"description"\s*:\s*"((?:\\.|[^"\\])*)"') {
            $text = $Matches[1]
            if ($text -eq "Not Found") {
                return "Яндекс не нашёл ресурс по этому запросу."
            }
            return $text
        }
        if ($body -match 'DiskNotFoundError') {
            return "Ссылка не открывается. Проверьте, что она публичная и скопирована целиком."
        }
        if (-not [string]::IsNullOrWhiteSpace($body) -and $body.Length -lt 300 -and $body -notmatch '<html') {
            return $body.Trim()
        }
        if ([string]::IsNullOrWhiteSpace($fallback)) { return "Яндекс Диск не ответил." }
        return $fallback
    }

    function Get-SiteOrigin([string]$url) {
        $uri = [Uri]$url
        if ($uri.IsDefaultPort) { return ($uri.Scheme + "://" + $uri.Host) }
        return ($uri.Scheme + "://" + $uri.Host + ":" + $uri.Port)
    }

    function New-DiskRequest([string]$url) {
        $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($url)
        $request.UserAgent = $userAgent
        $request.CookieContainer = $state.Cookies
        $request.AllowAutoRedirect = $true
        $request.KeepAlive = $false
        $request.Timeout = 30000
        $request.ReadWriteTimeout = 30000
        try {
            $request.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
        } catch {
        }
        return $request
    }

    function Get-CurlPathQuoted([string]$path) {
        return $path.Replace("\", "/")
    }

    function Invoke-CurlProcess([string[]]$configLines) {
        $curl = Get-CurlPath
        if (-not $curl) { throw "NO_CURL" }
        $config = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllLines($config, $configLines, [System.Text.Encoding]::ASCII)
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $curl
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $false
        $psi.RedirectStandardError = $false
        $psi.Arguments = "--config `"$config`""
        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $sync.Process = $proc
        try {
            while (-not $proc.WaitForExit(250)) {
                if ($sync.Cancel) {
                    try { $proc.Kill() } catch { }
                    throw "CANCELLED"
                }
                Update-TransferStatus
            }
            try { $proc.WaitForExit() | Out-Null } catch { }
            if ($sync.Cancel) { throw "CANCELLED" }
            return [int]$proc.ExitCode
        } finally {
            $sync.Process = $null
            try { $proc.Dispose() } catch { }
            if ([System.IO.File]::Exists($config)) {
                try { [System.IO.File]::Delete($config) } catch { }
            }
        }
    }

    function Update-TransferStatus {
        $path = [string]$sync.PartFile
        if ([string]::IsNullOrWhiteSpace($path)) { return }
        $got = Get-FileLength $path
        $sync.PartGot = $got
        $need = [int64]$sync.PartExpected
        $elapsed = 0
        $started = $sync.PartStarted
        if ($started -is [DateTime]) {
            $elapsed = [int]([DateTime]::UtcNow - $started).TotalSeconds
            if ($elapsed -lt 0) { $elapsed = 0 }
        }
        $name = [string]$sync.PartName
        if ($got -gt 0 -and $need -gt 0) {
            $pct = [int](($got * 100) / $need)
            if ($pct -gt 100) { $pct = 100 }
            $sync.Status = "Скачивается файл $($sync.Current) из $($sync.Total) — $pct% ($name, $(Format-ByteCount $got) из $(Format-ByteCount $need))"
        } elseif ($got -gt 0) {
            $sync.Status = "Скачивается файл $($sync.Current) из $($sync.Total) — $name, $(Format-ByteCount $got)"
        } else {
            $sync.Status = "Жду данные ${elapsed} с: файл $($sync.Current) из $($sync.Total) — $name"
        }
    }

    function Get-LastHttpCode([string]$headerFile) {
        if (-not [System.IO.File]::Exists($headerFile)) { return 0 }
        $text = [System.IO.File]::ReadAllText($headerFile)
        $code = 0
        foreach ($match in [regex]::Matches($text, 'HTTP/\d(?:\.\d)?\s+(\d{3})')) {
            $code = [int]$match.Groups[1].Value
        }
        return $code
    }

    function Invoke-CurlDownload([string]$Url, [string]$OutFile, [int]$MaxSeconds, [bool]$ForceIPv4, [bool]$Resume) {
        $curl = Get-CurlPath
        if (-not $curl) { throw "NO_CURL" }
        $headerFile = [System.IO.Path]::GetTempFileName()
        $errFile = [System.IO.Path]::GetTempFileName()
        $sync.PartFile = $OutFile
        $sync.PartStarted = [DateTime]::UtcNow
        Update-TransferStatus

        $agent = $userAgent.Replace('"', "")
        $referer = ([string]$publicUrl).Replace('"', "")
        $safeUrl = $Url.Replace('"', "")
        $lines = New-Object System.Collections.Generic.List[string]
        [void]$lines.Add("silent")
        [void]$lines.Add("show-error")
        [void]$lines.Add("location")
        [void]$lines.Add("path-as-is")
        [void]$lines.Add("http1.1")
        if ($ForceIPv4) { [void]$lines.Add("ipv4") }
        if ($Resume) { [void]$lines.Add("continue-at = -") }
        [void]$lines.Add("connect-timeout = 1")
        [void]$lines.Add("speed-limit = 1024")
        [void]$lines.Add("speed-time = 1")
        [void]$lines.Add("max-time = $MaxSeconds")
        [void]$lines.Add("user-agent = `"$agent`"")
        if ($referer -match '^https?://') { [void]$lines.Add("referer = `"$referer`"") }
        [void]$lines.Add("output = `"$(Get-CurlPathQuoted $OutFile)`"")
        [void]$lines.Add("dump-header = `"$(Get-CurlPathQuoted $headerFile)`"")
        [void]$lines.Add("stderr = `"$(Get-CurlPathQuoted $errFile)`"")
        [void]$lines.Add("url = `"$safeUrl`"")

        try {
            $exitCode = Invoke-CurlProcess $lines.ToArray()
            $httpCode = Get-LastHttpCode $headerFile
            $errText = ""
            if ([System.IO.File]::Exists($errFile)) { $errText = [System.IO.File]::ReadAllText($errFile).Trim() }
            if ($errText.Length -gt 180) { $errText = $errText.Substring(0, 180) }
            $sync.PartGot = Get-FileLength $OutFile
            return @{ Exit = $exitCode; Http = $httpCode; Error = $errText }
        } finally {
            foreach ($extra in @($headerFile, $errFile)) {
                if ([System.IO.File]::Exists($extra)) {
                    try { [System.IO.File]::Delete($extra) } catch { }
                }
            }
        }
    }

    function Invoke-CurlToFile([string]$Url, [string]$OutFile, [int]$MaxSeconds) {
        $headerFile = [System.IO.Path]::GetTempFileName()
        $errFile = [System.IO.Path]::GetTempFileName()
        $agent = $userAgent.Replace('"', "")
        $safeUrl = $Url.Replace('"', "")
        $lines = @(
            "silent",
            "show-error",
            "location",
            "path-as-is",
            "http1.1",
            "connect-timeout = 15",
            ("max-time = " + $MaxSeconds),
            ("user-agent = `"" + $agent + "`""),
            ("output = `"" + (Get-CurlPathQuoted $OutFile) + "`""),
            ("dump-header = `"" + (Get-CurlPathQuoted $headerFile) + "`""),
            ("stderr = `"" + (Get-CurlPathQuoted $errFile) + "`""),
            ("url = `"" + $safeUrl + "`"")
        )
        try {
            $exitCode = Invoke-CurlProcess $lines
            $httpCode = Get-LastHttpCode $headerFile
            if ($exitCode -ne 0 -and $httpCode -eq 0) {
                $errText = ""
                if ([System.IO.File]::Exists($errFile)) { $errText = [System.IO.File]::ReadAllText($errFile).Trim() }
                if ($errText.Length -gt 180) { $errText = $errText.Substring(0, 180) }
                throw ("Сеть оборвалась. " + $errText)
            }
            return $httpCode
        } finally {
            foreach ($extra in @($headerFile, $errFile)) {
                if ([System.IO.File]::Exists($extra)) {
                    try { [System.IO.File]::Delete($extra) } catch { }
                }
            }
        }
    }

    function Receive-ApiText([string]$url) {
        $temp = [System.IO.Path]::GetTempFileName()
        try {
            if (Get-CurlPath) {
                $code = Invoke-CurlToFile $url $temp 45
                $body = ""
                if ([System.IO.File]::Exists($temp)) {
                    $body = [System.IO.File]::ReadAllText($temp, [System.Text.Encoding]::UTF8)
                }
                return @{ Code = $code; Body = $body }
            }
        } catch {
            if ($_.Exception.Message -eq "CANCELLED" -or $sync.Cancel) { throw "CANCELLED" }
            if ($_.Exception.Message -ne "NO_CURL") { throw }
        } finally {
            if ([System.IO.File]::Exists($temp)) {
                try { [System.IO.File]::Delete($temp) } catch { }
            }
        }

        $response = $null
        try {
            $request = New-DiskRequest $url
            $request.Method = "GET"
            $request.Accept = "application/json"
            $sync.Request = $request
            $response = $request.GetResponse()
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
            try { $json = $reader.ReadToEnd() } finally { $reader.Close() }
            return @{ Code = [int]$response.StatusCode; Body = $json }
        } catch {
            if ($sync.Cancel) { throw "CANCELLED" }
            $web = $_.Exception
            if ($web -isnot [System.Net.WebException] -and $_.Exception.InnerException) {
                $web = $_.Exception.InnerException
            }
            $body = ""
            $code = 0
            if ($web -is [System.Net.WebException] -and $web.Response) {
                $code = [int]$web.Response.StatusCode
                try {
                    $errReader = New-Object System.IO.StreamReader($web.Response.GetResponseStream(), [System.Text.Encoding]::UTF8)
                    $body = $errReader.ReadToEnd()
                    $errReader.Close()
                } catch { }
            }
            if ($code -eq 0) { throw $_.Exception.Message }
            return @{ Code = $code; Body = $body }
        } finally {
            $sync.Request = $null
            if ($response) { $response.Close() }
        }
    }

    function Invoke-Yandex([string]$endpoint, [hashtable]$query) {
        $pairs = New-Object System.Collections.Generic.List[string]
        foreach ($key in $query.Keys) {
            $value = $query[$key]
            if ($null -eq $value) { continue }
            $text = [string]$value
            if ($text -eq "") { continue }
            $encodedKey = [uri]::EscapeDataString([string]$key)
            $encodedValue = [uri]::EscapeDataString($text)
            [void]$pairs.Add("$encodedKey=$encodedValue")
        }
        $url = "https://cloud-api.yandex.net/v1/disk/public/$endpoint?" + ($pairs -join "&")
        $lastError = $null
        for ($try = 1; $try -le 3; $try++) {
            Assert-Continue
            try {
                $result = Receive-ApiText $url
                if ($result.Code -ge 200 -and $result.Code -lt 300 -and $result.Body) {
                    return ($result.Body | ConvertFrom-Json)
                }
                $detail = ConvertTo-ErrorText ([string]$result.Body) ("HTTP " + $result.Code)
                if ([string]$result.Body -match 'DiskNotFoundError|FieldValidationError') { throw $detail }
                $lastError = $detail
                if ($try -eq 3) { throw $detail }
                Write-Log ("Повтор $try. $detail")
                Start-Sleep -Seconds 1
            } catch {
                if ($_.Exception.Message -eq "CANCELLED" -or $sync.Cancel) { throw "CANCELLED" }
                $detail = $_.Exception.Message
                if ($detail -match 'не открывается|обязательн|FieldValidation|DiskNotFound') { throw $detail }
                $lastError = $detail
                if ($try -eq 3) { throw $detail }
                Write-Log ("Повтор $try. $detail")
                Start-Sleep -Seconds 1
            }
        }
        throw $lastError
    }

    function Test-LooksLikeHtml([string]$path) {
        $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $buffer = New-Object byte[] 64
            $read = $stream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { return $false }
            $text = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read).TrimStart()
            return ($text -match '^(?i)<\!DOCTYPE|<html|<head')
        } finally {
            $stream.Close()
        }
    }

    function Receive-Http([string]$href, [string]$part, [int64]$expected) {
        $request = New-DiskRequest $href
        $request.Method = "GET"
        $request.Referer = $publicUrl
        $request.Timeout = 2000
        $request.ReadWriteTimeout = 1000
        $sync.Request = $request
        $sync.PartFile = $part
        $sync.PartStarted = [DateTime]::UtcNow
        $sync.PartExpected = $expected
        $sync.PartGot = [int64]0
        $response = $null
        $body = $null
        $file = $null
        try {
            $response = $request.GetResponse()
            $type = [string]$response.ContentType
            if ($type -like "text/html*") { throw "Яндекс вернул страницу вместо файла" }
            $body = $response.GetResponseStream()
            $file = [System.IO.File]::Create($part)
            $buffer = New-Object byte[] 65536
            $got = [int64]0
            while (($count = $body.Read($buffer, 0, $buffer.Length)) -gt 0) {
                if ($sync.Cancel) { throw "CANCELLED" }
                $file.Write($buffer, 0, $count)
                $got += $count
                $sync.PartGot = $got
                Update-TransferStatus
            }
        } finally {
            if ($file) { $file.Close() }
            if ($body) { $body.Close() }
            if ($response) { $response.Close() }
            $sync.Request = $null
        }
    }

    function Get-DownloadHref([string]$hash) {
        if ([string]::IsNullOrWhiteSpace($hash)) { throw "нет кода файла" }
        if ([string]::IsNullOrWhiteSpace($state.Sk)) { throw "нет ключа страницы" }
        $origin = $state.Origin
        if ([string]::IsNullOrWhiteSpace($origin)) { $origin = Get-SiteOrigin $publicUrl }
        $url = $origin + "/public/api/download-url"
        $lastText = ""
        for ($round = 1; $round -le 2; $round++) {
            Assert-Continue
            $json = '{"hash":"' + ($hash.Replace('\', '\\').Replace('"', '\"')) + '","inline":false,"sk":"' + ($state.Sk.Replace('"', '\"')) + '"}'
            $encoded = [uri]::EscapeDataString($json)
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($encoded)
            $request = New-DiskRequest $url
            $request.Method = "POST"
            $request.ContentType = "text/plain"
            $request.Accept = "application/json"
            $request.Referer = $publicUrl
            $request.Headers.Add("X-Requested-With", "XMLHttpRequest")
            $request.ContentLength = $bytes.Length
            $sync.Request = $request
            $response = $null
            try {
                $stream = $request.GetRequestStream()
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Close()
                $response = $request.GetResponse()
                $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
                try { $lastText = $reader.ReadToEnd() } finally { $reader.Close() }
            } catch {
                if ($sync.Cancel) { throw "CANCELLED" }
                $web = $_.Exception
                if ($web -isnot [System.Net.WebException] -and $_.Exception.InnerException) {
                    $web = $_.Exception.InnerException
                }
                if ($web -is [System.Net.WebException] -and $web.Response) {
                    $errReader = New-Object System.IO.StreamReader($web.Response.GetResponseStream(), [System.Text.Encoding]::UTF8)
                    try { $lastText = $errReader.ReadToEnd() } finally { $errReader.Close() }
                } else {
                    throw $_.Exception.Message
                }
            } finally {
                $sync.Request = $null
                if ($response) { $response.Close() }
            }
            if ($lastText -match 'wrongSk' -and $lastText -match '"newSk"\s*:\s*"([^"]+)"' -and $round -eq 1) {
                $state.Sk = $Matches[1]
                continue
            }
            break
        }
        $parsed = $null
        try { $parsed = $lastText | ConvertFrom-Json } catch { throw (ConvertTo-ErrorText $lastText "Диск не дал ссылку на файл") }
        if ($parsed -and $parsed.data -and $parsed.data.url) { return [string]$parsed.data.url }
        throw (ConvertTo-ErrorText $lastText "Диск не дал ссылку на файл")
    }

    function Resolve-FileHref([string]$hash, [string]$diskPath, [string]$fallback) {
        if (-not [string]::IsNullOrWhiteSpace($hash) -and -not [string]::IsNullOrWhiteSpace($state.Sk)) {
            try { return (Get-DownloadHref $hash) } catch {
                if ($_.Exception.Message -eq "CANCELLED") { throw "CANCELLED" }
                Write-Log ("Свежая ссылка не выдалась: " + $_.Exception.Message)
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($diskPath)) {
            try {
                $meta = Invoke-Yandex "resources/download" @{
                    public_key = $publicUrl
                    path = $diskPath
                }
                if ($meta.href) { return [string]$meta.href }
            } catch {
                if ($_.Exception.Message -eq "CANCELLED") { throw "CANCELLED" }
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($fallback)) { return $fallback }
        throw "Яндекс не дал ссылку на файл"
    }

    function Get-MaxSeconds([int64]$expected) {
        $seconds = 180
        if ($expected -gt 0) { $seconds = [int]($expected / 100000) + 60 }
        if ($seconds -lt 90) { $seconds = 90 }
        if ($seconds -gt 7200) { $seconds = 7200 }
        return $seconds
    }

    function Test-NonAscii([string]$text) {
        foreach ($ch in $text.ToCharArray()) {
            if ([int]$ch -gt 127) { return $true }
        }
        return $false
    }

    function Get-DownloadPartPath([string]$dest) {
        $part = $dest + ".part"
        if (-not (Test-NonAscii $part)) { return $part }
        $tempRoot = $env:TEMP
        if ([string]::IsNullOrWhiteSpace($tempRoot)) { $tempRoot = [System.IO.Path]::GetTempPath() }
        if ((Test-NonAscii $tempRoot) -and $env:SystemRoot) {
            $tempRoot = Join-Path $env:SystemRoot "Temp"
        }
        return (Join-Path $tempRoot ("yandex-fullsize-" + [guid]::NewGuid().ToString("N") + ".part"))
    }

    function Test-PreviewReady([string]$path) {
        $length = Get-FileLength $path
        if ($length -lt 800) { return $false }
        if (Test-LooksLikeHtml $path) { return $false }
        $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            $head = New-Object byte[] 8
            $read = $stream.Read($head, 0, $head.Length)
            if ($read -lt 3) { return $false }
            $isJpeg = ($head[0] -eq 255 -and $head[1] -eq 216)
            $isPng = ($head[0] -eq 137 -and $head[1] -eq 80 -and $head[2] -eq 78)
            if (-not $isJpeg -and -not $isPng) { return $true }
            $tail = New-Object byte[] 8
            if ($length -ge 8) { [void]$stream.Seek($length - 8, [System.IO.SeekOrigin]::Begin) }
            $tailRead = $stream.Read($tail, 0, $tail.Length)
            if ($isJpeg) { return ($tailRead -ge 2 -and $tail[$tailRead - 2] -eq 255 -and $tail[$tailRead - 1] -eq 217) }
            $marker = [System.Text.Encoding]::ASCII.GetString($tail, 0, $tailRead)
            return ($marker.Contains("IEND"))
        } finally {
            $stream.Close()
        }
    }

    function Test-CompleteDownload([string]$path, [int64]$expected) {
        $actual = Get-FileLength $path
        if ($actual -le 0) { return $false }
        if (Test-LooksLikeHtml $path) { return $false }
        if ($expected -gt 0 -and $actual -ne $expected) { return $false }
        return $true
    }

    function Save-FullFile([string]$hash, [string]$diskPath, [string]$fallback, [string]$dest, [int64]$expected) {
        $folder = [System.IO.Path]::GetDirectoryName($dest)
        [void][System.IO.Directory]::CreateDirectory($folder)
        $part = Get-DownloadPartPath $dest
        $maxSeconds = Get-MaxSeconds $expected
        $sync.PartExpected = $expected
        $sync.PartFile = $part
        $lastError = "не удалось скачать файл"
        try {
            for ($try = 1; $try -le 1; $try++) {
                Assert-Continue
                if ([System.IO.File]::Exists($part)) { [System.IO.File]::Delete($part) }
                $sync.PartGot = [int64]0
                $href = Resolve-FileHref $hash $diskPath $fallback
                $forceV4 = (($try % 2) -eq 1)
                if (-not (Get-CurlPath)) {
                    Receive-Http $href $part $expected
                    if (Test-CompleteDownload $part $expected) {
                        $actual = Get-FileLength $part
                        if ([System.IO.File]::Exists($dest)) { [System.IO.File]::Delete($dest) }
                        [System.IO.File]::Move($part, $dest)
                        $sync.PartGot = $actual
                        return $actual
                    }
                    $lastError = "нет данных от Диска"
                } else {
                    for ($piece = 1; $piece -le 8; $piece++) {
                        Assert-Continue
                        $before = Get-FileLength $part
                        $result = Invoke-CurlDownload $href $part $maxSeconds $forceV4 ($before -gt 0)
                        if ($sync.Cancel) { throw "CANCELLED" }
                        $actual = Get-FileLength $part
                        $sync.PartGot = $actual
                        if ($result.Http -ge 400) {
                            $lastError = "Яндекс вернул код " + $result.Http
                            break
                        }
                        if (Test-CompleteDownload $part $expected) {
                            if ([System.IO.File]::Exists($dest)) { [System.IO.File]::Delete($dest) }
                            [System.IO.File]::Move($part, $dest)
                            $sync.PartFile = ""
                            $sync.PartGot = $actual
                            return $actual
                        }
                        if ($actual -gt $before) {
                            Write-Log ("Связь оборвалась на {0}, продолжаю с этого места" -f (Format-ByteCount $actual))
                            continue
                        }
                        $lastError = [string]$result.Error
                        if ([string]::IsNullOrWhiteSpace($lastError) -or $lastError -match 'too slow|timed out|Timeout|transfer closed|Operation|SSL') {
                            $lastError = "нет данных от Диска"
                        }
                        break
                    }
                }
            }
            throw $lastError
        } finally {
            $sync.PartFile = ""
            if ([System.IO.File]::Exists($part)) {
                try { [System.IO.File]::Delete($part) } catch { }
            }
        }
    }

    function Get-JsonBlock([string]$text, [string]$marker) {
        $start = $text.IndexOf($marker)
        if ($start -lt 0) { return $null }
        $i = $text.IndexOf("{", $start)
        if ($i -lt 0) { return $null }
        $depth = 0
        $inString = $false
        $escape = $false
        for ($n = $i; $n -lt $text.Length; $n++) {
            $ch = $text[$n]
            if ($inString) {
                if ($escape) { $escape = $false }
                elseif ($ch -eq [char]92) { $escape = $true }
                elseif ($ch -eq [char]34) { $inString = $false }
                continue
            }
            if ($ch -eq [char]34) { $inString = $true; continue }
            if ($ch -eq [char]123) { $depth++ }
            elseif ($ch -eq [char]125) {
                $depth--
                if ($depth -eq 0) { return $text.Substring($i, ($n - $i) + 1) }
            }
        }
        return $null
    }

    function Get-PublicHtml([string]$pageUrl) {
        $response = $null
        try {
            $request = New-DiskRequest $pageUrl
            $request.Method = "GET"
            $request.Accept = "text/html"
            $request.Timeout = 45000
            $request.ReadWriteTimeout = 45000
            $sync.Request = $request
            $response = $request.GetResponse()
            if ($response.ResponseUri) { $state.Origin = Get-SiteOrigin ([string]$response.ResponseUri.AbsoluteUri) }
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
            try { return $reader.ReadToEnd() } finally { $reader.Close() }
        } catch {
            if ($sync.Cancel) { throw "CANCELLED" }
        } finally {
            $sync.Request = $null
            if ($response) { $response.Close() }
        }
        $temp = [System.IO.Path]::GetTempFileName()
        try {
            $code = Invoke-CurlToFile $pageUrl $temp 60
            if ($code -lt 200 -or $code -ge 300) { throw ("Страница диска ответила кодом " + $code) }
            if ([string]::IsNullOrWhiteSpace($state.Origin)) { $state.Origin = Get-SiteOrigin $pageUrl }
            return [System.IO.File]::ReadAllText($temp, [System.Text.Encoding]::UTF8)
        } finally {
            if ([System.IO.File]::Exists($temp)) {
                try { [System.IO.File]::Delete($temp) } catch { }
            }
        }
    }

    function Get-DiskFiles([string]$url) {
        $sync.Status = "Открываю страницу диска..."
        Write-Log "Открываю страницу диска..."
        $html = Get-PublicHtml $url
        if ([string]::IsNullOrWhiteSpace($html)) { throw "Пустая страница по ссылке." }
        if ($html -match '"sk"\s*:\s*"([^"]+)"') { $state.Sk = $Matches[1] }
        if ([string]::IsNullOrWhiteSpace($state.Origin)) { $state.Origin = Get-SiteOrigin $url }
        $block = Get-JsonBlock $html '"resources":'
        if (-not $block) { throw "По ссылке нет списка файлов. Проверьте, что ссылка публичная." }
        $resources = $block | ConvertFrom-Json
        $map = @{}
        $root = $null
        foreach ($prop in $resources.PSObject.Properties) {
            $map[$prop.Name] = $prop.Value
            $item = $prop.Value
            if ($item.type -eq "dir" -and -not $item.parent) { $root = $item }
        }
        if (-not $root) {
            foreach ($prop in $resources.PSObject.Properties) {
                if ($prop.Value.type -eq "file") { $root = $prop.Value; break }
            }
        }
        if (-not $root) { throw "По ссылке нет списка файлов." }

        $files = New-Object System.Collections.Generic.List[object]
        $seenFiles = @{}
        $seenDirs = @{}
        function Add-ListedFile($node, [string]$dirPrefix) {
            $name = [string]$node.name
            $relative = $dirPrefix + $name
            if ($seenFiles.ContainsKey($relative)) { return }
            $seenFiles[$relative] = $true
            $href = ""
            $hash = ""
            $size = [int64]0
            if ($node.path) { $hash = [string]$node.path }
            $preview = ""
            if ($node.meta) {
                if ($node.meta.original) { $href = [string]$node.meta.original }
                if ($node.meta.size) { $size = [int64]$node.meta.size }
                if ($node.meta.xxxlPreview) { $preview = [string]$node.meta.xxxlPreview }
                elseif ($node.meta.lPreview) { $preview = [string]$node.meta.lPreview }
                elseif ($node.meta.defaultPreview) { $preview = [string]$node.meta.defaultPreview }
            }
            [void]$files.Add([pscustomobject]@{
                name = $name
                path = ("/" + $relative)
                size = $size
                href = $href
                hash = $hash
                preview = $preview
            })
            $sync.Status = "Нашёл файлов: $($files.Count)"
        }
        function Walk-Dir($node, [string]$dirPrefix) {
            Assert-Continue
            $kids = @()
            if ($node.children) { $kids = @($node.children) }
            if ($kids.Count -eq 0 -and $node.parent) {
                Import-ApiFolder ($dirPrefix.TrimEnd("/"))
                return
            }
            foreach ($id in $kids) {
                $key = [string]$id
                if (-not $map.ContainsKey($key)) {
                    Import-ApiFolder ($dirPrefix.TrimEnd("/"))
                    return
                }
                $child = $map[$key]
                if ($child.type -eq "dir") {
                    Walk-Dir $child ($dirPrefix + [string]$child.name + "/")
                } elseif ($child.type -eq "file") {
                    Add-ListedFile $child $dirPrefix
                }
            }
        }
        function Import-ApiFolder([string]$folderPath) {
            $apiPath = "/"
            if (-not [string]::IsNullOrWhiteSpace($folderPath)) { $apiPath = "/" + $folderPath.Trim("/") }
            if ($seenDirs.ContainsKey($apiPath)) { return }
            $seenDirs[$apiPath] = $true
            $offset = 0
            do {
                Assert-Continue
                $sync.Status = "Дочитываю папку $apiPath..."
                $page = Invoke-Yandex "resources" @{
                    public_key = $url
                    path = $apiPath
                    limit = 100
                    offset = $offset
                }
                $batch = @()
                if ($page._embedded -and $page._embedded.items) { $batch = @($page._embedded.items) }
                $total = 0
                if ($page._embedded -and $null -ne $page._embedded.total) { $total = [int]$page._embedded.total }
                foreach ($item in $batch) {
                    if ($null -eq $item) { continue }
                    if ($item.type -eq "dir") {
                        Import-ApiFolder ([string]$item.path).TrimStart("/")
                    } elseif ($item.type -eq "file") {
                        $filePath = [string]$item.path
                        if ($filePath.StartsWith("/")) { $filePath = $filePath.Substring(1) }
                        if ($seenFiles.ContainsKey($filePath)) { continue }
                        $seenFiles[$filePath] = $true
                        [void]$files.Add([pscustomobject]@{
                            name = [string]$item.name
                            path = ("/" + $filePath)
                            size = $(if ($item.size) { [int64]$item.size } else { [int64]0 })
                            href = ""
                            hash = ""
                            preview = ""
                        })
                    }
                }
                if ($batch.Count -eq 0) { break }
                $offset += $batch.Count
            } while ($offset -lt $total)
        }

        if ($root.type -eq "file") {
            Add-ListedFile $root ""
        } else {
            Walk-Dir $root ""
        }
        $diskName = [string]$root.name
        if ([string]::IsNullOrWhiteSpace($diskName)) { $diskName = "Яндекс Диск" }
        return @{ Name = $diskName; Files = $files }
    }

    $saved = 0
    $failed = New-Object System.Collections.Generic.List[string]
    try {
        Write-Log "Читаю ссылку..."
        $sync.Status = "Открываю ссылку..."
        $disk = Get-DiskFiles $publicUrl
        $files = $disk.Files
        $sync.Total = $files.Count
        $sync.Current = 0
        if ($files.Count -eq 0) {
            $sync.Status = "По ссылке нет файлов."
            Write-Log "По ссылке нет файлов. Нужна публичная ссылка на папку или файл."
            return
        }

        $rootName = ConvertTo-SafeSegment ([string]$disk.Name)
        if ($makeRootFolder) {
            $fullName = $rootName + " original"
            $smallName = $rootName + " small"
        } else {
            $fullName = "original"
            $smallName = "small"
        }
        $outRoot = [System.IO.Path]::GetFullPath((Join-Path $destRoot $fullName))
        $previewRoot = [System.IO.Path]::GetFullPath((Join-Path $destRoot $smallName))
        [void][System.IO.Directory]::CreateDirectory($outRoot)
        [void][System.IO.Directory]::CreateDirectory($previewRoot)
        Write-Log ("Файлов: {0}" -f $files.Count)
        Write-Log ("Полные файлы: " + $outRoot)
        Write-Log ("Превью: " + $previewRoot)
        $sync.OpenPath = [System.IO.Path]::GetFullPath($destRoot)

        $skipped = 0
        $limit = 0
        if ($fileLimit) { $limit = [int]$fileLimit }
        $queue = New-Object System.Collections.Generic.List[object]
        $listed = 0
        foreach ($file in $files) {
            if ($limit -gt 0 -and $listed -ge $limit) { break }
            $listed++
            [void]$queue.Add([pscustomobject]@{ File = $file; Index = $listed })
        }
        $sync.FinishedCount = 0
        $left = New-Object System.Collections.Generic.List[object]
        $round = 1
        while ($queue.Count -gt 0 -and $round -le 2) {
            Assert-Continue
            $left = New-Object System.Collections.Generic.List[object]
            if ($round -gt 1) {
                Write-Log ("Круг {0}. Осталось файлов: {1}" -f $round, $queue.Count)
                $sync.Status = "Круг ${round}. Осталось файлов: $($queue.Count)"
            }
            foreach ($entry in $queue) {
                Assert-Continue
                $file = $entry.File
                $index = [int]$entry.Index
                $sync.Current = $index
                $relative = Get-SafeRelative ([string]$file.path) ([string]$file.name)
                $dest = [System.IO.Path]::GetFullPath((Join-Path $outRoot $relative))
                $previewDest = [System.IO.Path]::GetFullPath((Join-Path $previewRoot $relative))
                $rootPrefix = $outRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
                $previewPrefix = $previewRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
                if (-not $dest.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not $previewDest.StartsWith($previewPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                    Write-Log "Пропуск, странный путь: $relative"
                    continue
                }
                $expected = [int64]0
                if ($file.size) { $expected = [int64]$file.size }
                $previewUrl = [string]$file.preview
                $sync.PartName = [string]$file.name
                $sync.PartExpected = $expected
                $sync.PartGot = [int64]0
                $sync.Status = "Файл $index из $($files.Count): $relative"

                $fullReady = ($expected -gt 0 -and (Get-FileLength $dest) -eq $expected)
                $previewReady = [string]::IsNullOrWhiteSpace($previewUrl) -or (Test-PreviewReady $previewDest)
                if ($fullReady -and $previewReady) {
                    $skipped++
                    $sync.FinishedCount = $saved + $skipped
                    $sync.PartGot = $expected
                    Write-Log ("Уже есть: {0}" -f $relative)
                    continue
                }

                $pending = $false
                if (-not $previewReady) {
                    $sync.Status = "Превью, файл $index из $($files.Count): $relative"
                    Write-Log ("Превью {0}/{1}: {2}" -f $index, $files.Count, $relative)
                    try {
                        [void](Save-FullFile "" "" $previewUrl $previewDest 0)
                        if (-not (Test-PreviewReady $previewDest)) {
                            if ([System.IO.File]::Exists($previewDest)) { [System.IO.File]::Delete($previewDest) }
                            throw "превью оборвалось"
                        }
                        Write-Log ("Превью готово: {0}" -f $relative)
                    } catch {
                        if ($_.Exception.Message -eq "CANCELLED" -or $sync.Cancel) { throw "CANCELLED" }
                        $pending = $true
                        Write-Log ("Превью пока не вышло: {0} — {1}" -f $relative, $_.Exception.Message)
                    }
                }
                if (-not $fullReady) {
                    Write-Log ("Скачиваю {0}/{1}: {2}" -f $index, $files.Count, $relative)
                    try {
                        $size = Save-FullFile ([string]$file.hash) ([string]$file.path) ([string]$file.href) $dest $expected
                        $sync.PartGot = $size
                        Write-Log ("Готово: {0} ({1})" -f $relative, (Format-ByteCount $size))
                    } catch {
                        if ($_.Exception.Message -eq "CANCELLED" -or $sync.Cancel) { throw "CANCELLED" }
                        $pending = $true
                        Write-Log ("Пока не вышло: {0} — {1}" -f $relative, $_.Exception.Message)
                    }
                }
                if ($pending) {
                    [void]$left.Add($entry)
                    [void]$failed.Add($relative)
                } else {
                    $saved++
                    $sync.FinishedCount = $saved + $skipped
                }
            }
            if ($left.Count -eq 0) { break }
            if ($round -ge 2) {
                Write-Log "Два круга пройдены. Дальше не повторяю."
                break
            }
            $queue = $left
            $round++
        }

        $missing = New-Object System.Collections.Generic.List[string]
        foreach ($entry in $left) {
            $file = $entry.File
            $relative = Get-SafeRelative ([string]$file.path) ([string]$file.name)
            [void]$missing.Add($relative)
            Write-Log ("Не скачалось: {0}" -f $relative)
        }
        $sync.SavedCount = $saved
        $sync.FailedCount = $missing.Count
        $sync.FinishedCount = $saved + $skipped
        if ($missing.Count -eq 0) {
            $sync.Status = "Готово. Новых: $saved. Уже было: $skipped."
        } else {
            $sync.Status = "Готово. Новых: $saved. Уже было: $skipped. Не скачались: $($missing.Count)."
        }
        Write-Log $sync.Status
        Write-Log ("Полные файлы: " + $outRoot)
        Write-Log ("Превью: " + $previewRoot)
    } catch {
        if ($_.Exception.Message -eq "CANCELLED" -or $sync.Cancel) {
            $sync.Status = "Остановлено. Уже скачанные файлы лежат в папке."
            $sync.SavedCount = $saved
            $sync.FailedCount = $failed.Count
            Write-Log $sync.Status
            return
        }
        $sync.Status = "Ошибка: " + $_.Exception.Message
        $sync.SavedCount = $saved
        if ($failed.Count -gt 0) { $sync.FailedCount = $failed.Count } else { $sync.FailedCount = 1 }
        Write-Log $sync.Status
    } finally {
        $sync.Request = $null
        $sync.PartFile = ""
        $sync.PartGot = [int64]0
        $sync.PartExpected = [int64]0
        $sync.Done = $true
    }
}

if ($script:selfTest) {
    if ([string]::IsNullOrWhiteSpace($SelfTestDest)) { throw "Нужна папка -SelfTestDest" }
    $script:sync.Cancel = $false
    $script:sync.Done = $false
    & $worker $script:sync $SelfTestUrl $SelfTestDest $true $SelfTestLimit
    foreach ($line in @($script:sync.Messages)) { Write-Output $line }
    Write-Output ("RESULT saved={0} failed={1}" -f $script:sync.SavedCount, $script:sync.FailedCount)
    if ([int]$script:sync.SavedCount -lt 1 -or [int]$script:sync.FailedCount -gt 0) { exit 1 }
    exit 0
}

function Read-Settings {
    $path = Join-Path (Join-Path $env:APPDATA "YandexFullsize") "settings.json"
    if (-not [System.IO.File]::Exists($path)) { return $null }
    try {
        $text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
        return ($text | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Write-Settings([string]$url, [string]$folder, [bool]$makeRoot) {
    try {
        $dir = Join-Path $env:APPDATA "YandexFullsize"
        [void][System.IO.Directory]::CreateDirectory($dir)
        $json = (@{ url = $url; folder = $folder; makeRoot = $makeRoot } | ConvertTo-Json -Compress)
        [System.IO.File]::WriteAllText((Join-Path $dir "settings.json"), $json, [System.Text.Encoding]::UTF8)
    } catch {
    }
}

$colorBg = [System.Drawing.Color]::FromArgb(246, 245, 242)
$colorText = [System.Drawing.Color]::FromArgb(32, 32, 32)
$colorMuted = [System.Drawing.Color]::FromArgb(90, 90, 90)
$colorGreen = [System.Drawing.Color]::FromArgb(31, 107, 58)

$form = New-Object System.Windows.Forms.Form
$form.Text = "Яндекс Диск — полные файлы — версия $script:AppVersion"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(680, 520)
$form.MinimumSize = New-Object System.Drawing.Size(720, 480)
$form.BackColor = $colorBg
$form.ForeColor = $colorText
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Полные файлы с Яндекс Диска"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $false
$title.Location = New-Object System.Drawing.Point(18, 14)
$title.Size = New-Object System.Drawing.Size(450, 32)
$title.Anchor = "Top, Left"
$form.Controls.Add($title)

$versionLabel = New-Object System.Windows.Forms.Label
$versionLabel.Text = "версия $script:AppVersion"
$versionLabel.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$versionLabel.ForeColor = $colorGreen
$versionLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
$versionLabel.AutoSize = $false
$versionLabel.Location = New-Object System.Drawing.Point(486, 14)
$versionLabel.Size = New-Object System.Drawing.Size(176, 32)
$versionLabel.Anchor = "Top, Right"
$form.Controls.Add($versionLabel)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "Папка «имя original» — большие файлы, «имя small» — превью. Секунда без данных — следующий файл, всего два круга."
$hint.ForeColor = $colorMuted
$hint.AutoSize = $false
$hint.Location = New-Object System.Drawing.Point(18, 48)
$hint.Size = New-Object System.Drawing.Size(644, 48)
$hint.Anchor = "Top, Left, Right"
$form.Controls.Add($hint)

$linkLabel = New-Object System.Windows.Forms.Label
$linkLabel.Text = "Ссылка"
$linkLabel.Location = New-Object System.Drawing.Point(18, 100)
$linkLabel.Size = New-Object System.Drawing.Size(200, 20)
$form.Controls.Add($linkLabel)

$urlBox = New-Object System.Windows.Forms.TextBox
$urlBox.Location = New-Object System.Drawing.Point(18, 122)
$urlBox.Size = New-Object System.Drawing.Size(644, 28)
$urlBox.Anchor = "Top, Left, Right"
$urlBox.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.Controls.Add($urlBox)

$folderLabel = New-Object System.Windows.Forms.Label
$folderLabel.Text = "Куда сохранить"
$folderLabel.Location = New-Object System.Drawing.Point(18, 160)
$folderLabel.Size = New-Object System.Drawing.Size(200, 20)
$form.Controls.Add($folderLabel)

$destBox = New-Object System.Windows.Forms.TextBox
$destBox.Location = New-Object System.Drawing.Point(18, 182)
$destBox.Size = New-Object System.Drawing.Size(520, 28)
$destBox.Anchor = "Top, Left, Right"
$destBox.Text = [Environment]::GetFolderPath("Desktop")
$form.Controls.Add($destBox)

$browse = New-Object System.Windows.Forms.Button
$browse.Text = "Обзор"
$browse.Location = New-Object System.Drawing.Point(548, 180)
$browse.Size = New-Object System.Drawing.Size(114, 30)
$browse.Anchor = "Top, Right"
$browse.FlatStyle = "Flat"
$browse.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($browse)

$makeRoot = New-Object System.Windows.Forms.CheckBox
$makeRoot.Text = "Добавить имя диска к папкам original и small"
$makeRoot.Checked = $true
$makeRoot.AutoSize = $true
$makeRoot.Location = New-Object System.Drawing.Point(18, 220)
$form.Controls.Add($makeRoot)

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "Скачать"
$btnStart.Location = New-Object System.Drawing.Point(18, 252)
$btnStart.Size = New-Object System.Drawing.Size(150, 36)
$btnStart.FlatStyle = "Flat"
$btnStart.FlatAppearance.BorderSize = 0
$btnStart.BackColor = $colorGreen
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($btnStart)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "Стоп"
$btnStop.Location = New-Object System.Drawing.Point(178, 252)
$btnStop.Size = New-Object System.Drawing.Size(110, 36)
$btnStop.FlatStyle = "Flat"
$btnStop.Enabled = $false
$btnStop.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($btnStop)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(18, 302)
$bar.Size = New-Object System.Drawing.Size(644, 16)
$bar.Anchor = "Top, Left, Right"
$bar.Minimum = 0
$bar.Maximum = 1000
$bar.Value = 0
$bar.Style = "Continuous"
$form.Controls.Add($bar)

$status = New-Object System.Windows.Forms.Label
$status.Text = $script:sync.Status
$status.ForeColor = $colorMuted
$status.AutoSize = $false
$status.Location = New-Object System.Drawing.Point(18, 324)
$status.Size = New-Object System.Drawing.Size(644, 22)
$status.Anchor = "Top, Left, Right"
$form.Controls.Add($status)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = "Vertical"
$log.WordWrap = $true
$log.BackColor = [System.Drawing.Color]::White
$log.Location = New-Object System.Drawing.Point(18, 352)
$log.Size = New-Object System.Drawing.Size(644, 150)
$log.Anchor = "Top, Bottom, Left, Right"
$log.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$form.Controls.Add($log)

$btnStart.DialogResult = [System.Windows.Forms.DialogResult]::None
$btnStop.DialogResult = [System.Windows.Forms.DialogResult]::None

$saved = Read-Settings
if ($saved) {
    if ($saved.url) { $urlBox.Text = [string]$saved.url }
    if ($saved.folder -and [System.IO.Directory]::Exists([string]$saved.folder)) {
        $destBox.Text = [string]$saved.folder
    }
    if ($null -ne $saved.makeRoot) { $makeRoot.Checked = [bool]$saved.makeRoot }
}

$form.Add_Shown({
    $urlBox.Focus()
    try {
        [YandexFullsizeWin32]::SendMessage($urlBox.Handle, 0x1501, [IntPtr]::Zero, "https://disk.yandex.ru/d/...") | Out-Null
    } catch {
    }
})

$browse.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Куда сохранить файлы"
    if ([System.IO.Directory]::Exists($destBox.Text)) { $dialog.SelectedPath = $destBox.Text }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $destBox.Text = $dialog.SelectedPath
    }
})

function Set-Running([bool]$running) {
    $btnStart.Enabled = -not $running
    $btnStop.Enabled = $running
    $urlBox.Enabled = -not $running
    $destBox.Enabled = -not $running
    $browse.Enabled = -not $running
    $makeRoot.Enabled = -not $running
}

$btnStop.Add_Click({
    $script:sync.Cancel = $true
    $status.Text = "Останавливаю..."
    $request = $script:sync.Request
    if ($request) {
        try { $request.Abort() } catch { }
    }
    $proc = $script:sync.Process
    if ($proc) {
        try { if (-not $proc.HasExited) { $proc.Kill() } } catch { }
    }
})

$btnStart.Add_Click({
    $form.DialogResult = [System.Windows.Forms.DialogResult]::None
    if ($script:job) { return }
    $url = $urlBox.Text.Trim()
    if ($url -match '^(https?://\S+)') { $url = $Matches[1] }
    $url = $url -replace '[?#].*$', ''
    $urlBox.Text = $url
    if ($url -notmatch '^https?://([^/]*\.)?(disk\.yandex\.(ru|com|kz|by|uz)|yadi\.sk)/') {
        $status.Text = "Нужна публичная ссылка вида https://disk.yandex.ru/d/..."
        return
    }
    $folder = $destBox.Text.Trim()
    if ([string]::IsNullOrWhiteSpace($folder)) {
        $status.Text = "Выберите папку, куда сохранить файлы."
        return
    }
    try {
        [void][System.IO.Directory]::CreateDirectory($folder)
    } catch {
        $status.Text = "Не удалось открыть папку: " + $_.Exception.Message
        return
    }

    Write-Settings $url $folder $makeRoot.Checked
    $script:sync.Cancel = $false
    $script:sync.Done = $false
    $script:sync.Current = 0
    $script:sync.Total = 0
    $script:sync.OpenPath = ""
    $script:sync.PartGot = [int64]0
    $script:sync.PartExpected = [int64]0
    $script:sync.SavedCount = 0
    $script:sync.FailedCount = 0
    $script:sync.FinishedCount = 0
    $script:sync.Messages.Clear()
    $log.Clear()
    Set-ProgressState 1
    $bar.Value = 0
    $status.Text = "Запускаю..."
    Set-Running $true

    $rs = [runspacefactory]::CreateRunspace()
    $rs.ApartmentState = "MTA"
    $rs.Open()
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript($worker).AddArgument($script:sync).AddArgument($url).AddArgument($folder).AddArgument([bool]$makeRoot.Checked).AddArgument(0)
    $handle = $ps.BeginInvoke()
    $script:job = @{ Ps = $ps; Runspace = $rs; Handle = $handle }
})

function Set-ProgressState([int]$state) {
    try {
        # 0x410 is PBM_SETSTATE. 1 runs, 3 pauses and stops the moving highlight.
        [YandexFullsizeWin32]::SendMessageInt($bar.Handle, 0x410, [IntPtr]$state, [IntPtr]::Zero) | Out-Null
    } catch {
    }
}

function Set-ProgressValue([int]$value) {
    if ($bar.Maximum -ne 1000) {
        $bar.Value = 0
        $bar.Maximum = 1000
    }
    if ($value -lt 0) { $value = 0 }
    if ($value -gt 1000) { $value = 1000 }
    # Assigning the same value again restarts the Windows slide animation.
    if ($bar.Value -eq $value) { return }
    $bar.Value = $value
}

function Set-ProgressFull {
    if ($bar.Maximum -ne 1000) {
        $bar.Value = 0
        $bar.Maximum = 1000
    }
    Set-ProgressState 1
    # A themed bar animates toward the value and stops short unless the
    # value is nudged back and forth in the same tick.
    $bar.Value = 1000
    $bar.Value = 999
    $bar.Value = 1000
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    try {
        while ($script:sync.Messages.Count -gt 0) {
            $line = [string]$script:sync.Messages[0]
            $script:sync.Messages.RemoveAt(0)
            $log.AppendText($line + [Environment]::NewLine)
        }
    } catch {
    }
    $status.Text = [string]$script:sync.Status
    $finishedNow = $script:sync.Done -and $script:job -and $script:job.Handle.IsCompleted
    if ($script:job -and -not $finishedNow) {
        $total = [int]$script:sync.Total
        if ($total -gt 0) {
            $done = [int]$script:sync.FinishedCount
            $frac = 0.0
            $need = [int64]$script:sync.PartExpected
            $got = [int64]$script:sync.PartGot
            if ($need -gt 0 -and $got -gt 0 -and $got -lt $need) {
                $frac = [double]$got / [double]$need
            }
            $overall = [int]((($done + $frac) * 1000) / $total)
            Set-ProgressValue $overall
        }
    }
    if ($finishedNow) {
        if ($script:sync.Cancel) {
            Set-ProgressState 3
        } else {
            Set-ProgressFull
        }
        try { $script:job.Ps.EndInvoke($script:job.Handle) | Out-Null } catch { }
        try { $script:job.Ps.Dispose() } catch { }
        try { $script:job.Runspace.Close(); $script:job.Runspace.Dispose() } catch { }
        $script:job = $null
        $script:sync.Done = $false
        Set-Running $false
        if ($script:sync.OpenPath -and [System.IO.Directory]::Exists([string]$script:sync.OpenPath)) {
            $path = [string]$script:sync.OpenPath
            $script:sync.OpenPath = ""
            Start-Process -FilePath $path
        }
    }
})
$timer.Start()

$form.Add_FormClosing({
    $script:sync.Cancel = $true
    $request = $script:sync.Request
    if ($request) { try { $request.Abort() } catch { } }
    $proc = $script:sync.Process
    if ($proc) { try { if (-not $proc.HasExited) { $proc.Kill() } } catch { } }
    $timer.Stop()
})

[void]$form.ShowDialog()
$timer.Stop()
