# Yandex Disk full-size downloader
# Double-click YandexFullsize.bat. Paste a public link. Each file is downloaded
# on its own, at original size, into the same folders as on the disk.
# A whole-folder zip is never requested: that call hangs while Disk is unstable.

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
}
"@
    [YandexFullsizeWin32]::SetProcessDPIAware() | Out-Null
} catch {
}

[System.Windows.Forms.Application]::EnableVisualStyles()
try {
    $protocols = [System.Net.SecurityProtocolType]::Tls12
    $tls13 = [Enum]::Parse([System.Net.SecurityProtocolType], "Tls13")
    $protocols = $protocols -bor $tls13
    [System.Net.ServicePointManager]::SecurityProtocol = $protocols
} catch {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
}
[System.Net.ServicePointManager]::Expect100Continue = $false
[System.Net.ServicePointManager]::DefaultConnectionLimit = 8

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
    PartExpected = [int64]0
})
$script:sync.Messages = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))
$script:job = $null

function Add-LogLine([string]$text) {
    [void]$script:sync.Messages.Add($text)
}

$worker = {
    param($sync, $publicUrl, $destRoot, $makeRootFolder)

    $ErrorActionPreference = "Stop"
    $userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

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
        return ($safe -join "\")
    }

    function Format-ByteCount([int64]$n) {
        if ($n -ge 1MB) { return ("{0:N1} МБ" -f ($n / 1MB)) }
        if ($n -ge 1KB) { return ("{0:N0} КБ" -f ($n / 1KB)) }
        return "$n Б"
    }

    function Get-CurlPath {
        foreach ($candidate in @(
            (Join-Path $env:SystemRoot "System32\curl.exe"),
            (Join-Path $env:SystemRoot "Sysnative\curl.exe")
        )) {
            if ([System.IO.File]::Exists($candidate)) { return $candidate }
        }
        return $null
    }

    function ConvertTo-ErrorText([string]$body, [string]$fallback) {
        if ($body -match '"message"\s*:\s*"((?:\\.|[^"\\])*)"') {
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

    function Invoke-CurlRequest([string]$Url, [string]$OutFile, [int]$MaxSeconds) {
        # The URL is written to a curl config file. On Windows a public link in the
        # command line is rewritten, and Yandex answers "Ресурс не найден."
        $curl = Get-CurlPath
        if (-not $curl) { throw "NO_CURL" }
        $config = [System.IO.Path]::GetTempFileName()
        $downloadPath = $OutFile
        $staging = $null
        foreach ($ch in $OutFile.ToCharArray()) {
            if ([int]$ch -gt 127) { $staging = [System.IO.Path]::GetTempFileName(); break }
        }
        if ($staging) { $downloadPath = $staging }
        $curlPath = $downloadPath.Replace("\", "/")
        $safeUrl = $Url.Replace('"', "")
        $agent = $userAgent.Replace('"', "")
        $lines = @(
            "silent",
            "show-error",
            "location",
            "path-as-is",
            "connect-timeout = 25",
            ("max-time = " + $MaxSeconds),
            ("user-agent = `"" + $agent + "`""),
            ("output = `"" + $curlPath + "`""),
            'write-out = "%{http_code}"',
            ("url = `"" + $safeUrl + "`"")
        )
        [System.IO.File]::WriteAllLines($config, $lines, [System.Text.Encoding]::ASCII)
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $curl
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.Arguments = "--config `"$config`""
        $proc = New-Object System.Diagnostics.Process
        $proc.StartInfo = $psi
        [void]$proc.Start()
        $sync.Process = $proc
        try {
            $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
            $stderrTask = $proc.StandardError.ReadToEndAsync()
            while (-not $proc.WaitForExit(250)) {
                if ($sync.Cancel) {
                    try { $proc.Kill() } catch { }
                    throw "CANCELLED"
                }
            }
            $proc.WaitForExit() | Out-Null
            $codeText = [string]$stdoutTask.Result
            $errText = [string]$stderrTask.Result
            $code = 0
            if ($codeText -match '(\d{3})\s*$') { $code = [int]$Matches[1] }
            if ($proc.ExitCode -ne 0 -and $code -eq 0) {
                $reason = $errText.Trim()
                if ($reason.Length -gt 240) { $reason = $reason.Substring(0, 240) }
                throw ("Сеть оборвалась. " + $reason)
            }
            if ($staging -and [System.IO.File]::Exists($staging)) {
                $folder = [System.IO.Path]::GetDirectoryName($OutFile)
                if ($folder) { [void][System.IO.Directory]::CreateDirectory($folder) }
                if ([System.IO.File]::Exists($OutFile)) { [System.IO.File]::Delete($OutFile) }
                [System.IO.File]::Move($staging, $OutFile)
                $staging = $null
            }
            return $code
        } finally {
            $sync.Process = $null
            try { $proc.Dispose() } catch { }
            if ($config -and [System.IO.File]::Exists($config)) {
                try { [System.IO.File]::Delete($config) } catch { }
            }
            if ($staging -and [System.IO.File]::Exists($staging)) {
                try { [System.IO.File]::Delete($staging) } catch { }
            }
        }
    }

    function Receive-ApiText([string]$url) {
        $temp = [System.IO.Path]::GetTempFileName()
        try {
            if (Get-CurlPath) {
                $code = Invoke-CurlRequest $url $temp 60
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
            $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($url)
            $request.Method = "GET"
            $request.UserAgent = $userAgent
            $request.Accept = "application/json"
            $request.Timeout = 45000
            $request.ReadWriteTimeout = 45000
            $request.KeepAlive = $false
            $request.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
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
        for ($try = 1; $try -le 4; $try++) {
            Assert-Continue
            try {
                $result = Receive-ApiText $url
                if ($result.Code -ge 200 -and $result.Code -lt 300 -and $result.Body) {
                    return ($result.Body | ConvertFrom-Json)
                }
                $detail = ConvertTo-ErrorText ([string]$result.Body) ("HTTP " + $result.Code)
                if ([string]$result.Body -match 'DiskNotFoundError|FieldValidationError') { throw $detail }
                $lastError = $detail
                if ($try -eq 4) { throw $detail }
                Write-Log ("Повтор $try из 3. $detail")
                Start-Sleep -Seconds ([Math]::Pow(2, $try))
            } catch {
                if ($_.Exception.Message -eq "CANCELLED" -or $sync.Cancel) { throw "CANCELLED" }
                $detail = $_.Exception.Message
                if ($detail -match 'не открывается|обязательн|FieldValidation|DiskNotFound') { throw $detail }
                $lastError = $detail
                if ($try -eq 4) { throw $detail }
                Write-Log ("Повтор $try из 3. $detail")
                Start-Sleep -Seconds ([Math]::Pow(2, $try))
            }
        }
        throw $lastError
    }

    function Test-LooksLikeHtml([string]$path) {
        $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
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
        $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($href)
        $request.Method = "GET"
        $request.UserAgent = $userAgent
        $request.Referer = $publicUrl
        $request.Timeout = 60000
        $request.ReadWriteTimeout = 40000
        $request.AllowAutoRedirect = $true
        $request.KeepAlive = $false
        $sync.Request = $request
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
            $total = [int64]$response.ContentLength
            if ($total -lt 0 -and $expected -gt 0) { $total = $expected }
            while (($count = $body.Read($buffer, 0, $buffer.Length)) -gt 0) {
                if ($sync.Cancel) { throw "CANCELLED" }
                $file.Write($buffer, 0, $count)
                $got += $count
                if ($total -gt 0) {
                    $pct = [int](($got * 100) / $total)
                    if ($pct -gt 100) { $pct = 100 }
                    $sync.Status = "Скачивается файл $($sync.Current) из $($sync.Total) — $pct%"
                } else {
                    $sync.Status = "Скачивается файл $($sync.Current) из $($sync.Total) — $(Format-ByteCount $got)"
                }
            }
        } finally {
            if ($file) { $file.Close() }
            if ($body) { $body.Close() }
            if ($response) { $response.Close() }
            $sync.Request = $null
        }
    }

    function Receive-Curl([string]$href, [string]$part) {
        $curl = Join-Path $env:SystemRoot "System32\curl.exe"
        if (-not [System.IO.File]::Exists($curl)) { throw "curl.exe не найден" }
        $curlArgs = @(
            "-L", "--fail", "--retry", "2", "--retry-delay", "2",
            "--connect-timeout", "25", "--max-time", "600",
            "-A", $userAgent, "-e", $publicUrl,
            "-sS", "-o", $part, "--", $href
        )
        $curlOutput = & $curl @curlArgs 2>&1
        if ($LASTEXITCODE -ne 0) {
            $text = ($curlOutput | Out-String).Trim()
            if ($text.Length -gt 300) { $text = $text.Substring(0, 300) }
            throw "curl: $text"
        }
    }

    function Save-FullFile([string]$href, [string]$dest, [int64]$expected) {
        $part = $dest + ".part"
        $folder = [System.IO.Path]::GetDirectoryName($dest)
        [void][System.IO.Directory]::CreateDirectory($folder)
        for ($try = 1; $try -le 4; $try++) {
            Assert-Continue
            if ([System.IO.File]::Exists($part)) { [System.IO.File]::Delete($part) }
            try {
                $sync.PartFile = $part
                $sync.PartExpected = $expected
                try {
                    if (-not (Get-CurlPath)) { throw "NO_CURL" }
                    $httpCode = Invoke-CurlRequest $href $part 600
                    if ($httpCode -ne 200) {
                        throw ("Яндекс вернул код " + $httpCode)
                    }
                } catch {
                    if ($sync.Cancel -or $_.Exception.Message -eq "CANCELLED") { throw "CANCELLED" }
                    if ($_.Exception.Message -ne "NO_CURL") {
                        Write-Log ("Повтор загрузки другим способом. " + $_.Exception.Message)
                    }
                    if ([System.IO.File]::Exists($part)) { [System.IO.File]::Delete($part) }
                    Receive-Http $href $part $expected
                } finally {
                    $sync.PartFile = ""
                    $sync.PartExpected = 0
                }
                if (-not [System.IO.File]::Exists($part)) { throw "файл не сохранился" }
                $actual = [int64](New-Object System.IO.FileInfo $part).Length
                if (Test-LooksLikeHtml $part) { throw "вместо файла пришла страница" }
                if ($expected -gt 0 -and $actual -ne $expected) {
                    throw ("размер не совпал: скачано {0}, на диске {1}" -f $actual, $expected)
                }
                if ([System.IO.File]::Exists($dest)) { [System.IO.File]::Delete($dest) }
                [System.IO.File]::Move($part, $dest)
                return $actual
            } catch {
                if ($_.Exception.Message -eq "CANCELLED" -or $sync.Cancel) { throw "CANCELLED" }
                if ([System.IO.File]::Exists($part)) {
                    try { [System.IO.File]::Delete($part) } catch { }
                }
                if ($try -eq 4) { throw }
                Write-Log ("Не вышло (попытка $try из 4): " + $_.Exception.Message)
                Start-Sleep -Seconds ([Math]::Pow(2, $try))
            }
        }
        throw "не удалось скачать файл"
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
            $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($pageUrl)
            $request.Method = "GET"
            $request.UserAgent = $userAgent
            $request.Accept = "text/html"
            $request.Timeout = 45000
            $request.ReadWriteTimeout = 45000
            $request.AllowAutoRedirect = $true
            $request.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
            $sync.Request = $request
            $response = $request.GetResponse()
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
            $code = Invoke-CurlRequest $pageUrl $temp 60
            if ($code -lt 200 -or $code -ge 300) { throw ("Страница диска ответила кодом " + $code) }
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
            $size = [int64]0
            if ($node.meta) {
                if ($node.meta.original) { $href = [string]$node.meta.original }
                if ($node.meta.size) { $size = [int64]$node.meta.size }
            }
            [void]$files.Add([pscustomobject]@{
                name = $name
                path = ("/" + $relative)
                size = $size
                href = $href
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
            $outRoot = [System.IO.Path]::GetFullPath((Join-Path $destRoot $rootName))
        } else {
            $outRoot = [System.IO.Path]::GetFullPath($destRoot)
        }
        [void][System.IO.Directory]::CreateDirectory($outRoot)
        Write-Log ("Файлов: {0}. Папка: {1}" -f $files.Count, $outRoot)
        $sync.OpenPath = $outRoot

        $saved = 0
        $skipped = 0
        $failed = New-Object System.Collections.Generic.List[string]
        $index = 0
        foreach ($file in $files) {
            Assert-Continue
            $index++
            $sync.Current = $index
            $relative = Get-SafeRelative ([string]$file.path) ([string]$file.name)
            $dest = [System.IO.Path]::GetFullPath((Join-Path $outRoot $relative))
            $rootPrefix = $outRoot.TrimEnd("\") + "\"
            $destKey = $dest.ToLowerInvariant()
            $rootKey = $rootPrefix.ToLowerInvariant()
            if (-not $destKey.StartsWith($rootKey)) {
                Write-Log "Пропуск, странный путь: $relative"
                [void]$failed.Add($relative)
                continue
            }
            $expected = [int64]0
            if ($file.size) { $expected = [int64]$file.size }
            $sync.Status = "Файл $index из $($files.Count): $relative"

            if ([System.IO.File]::Exists($dest) -and $expected -gt 0) {
                $have = [int64](New-Object System.IO.FileInfo $dest).Length
                if ($have -eq $expected) {
                    $skipped++
                    Write-Log ("Уже есть: {0} ({1})" -f $relative, (Format-ByteCount $have))
                    continue
                }
            }

            Write-Log ("Скачиваю {0}/{1}: {2}" -f $index, $files.Count, $relative)
            try {
                $href = ""
                if ($file.href) { $href = [string]$file.href }
                if ([string]::IsNullOrWhiteSpace($href)) {
                    $meta = Invoke-Yandex "resources/download" @{
                        public_key = $publicUrl
                        path = [string]$file.path
                    }
                    if (-not $meta.href) { throw "Яндекс не дал ссылку на файл" }
                    $href = [string]$meta.href
                }
                # One file at full size. A folder zip is never requested.
                $size = Save-FullFile $href $dest $expected
                $saved++
                Write-Log ("Готово: {0} ({1})" -f $relative, (Format-ByteCount $size))
            } catch {
                if ($_.Exception.Message -eq "CANCELLED" -or $sync.Cancel) { throw "CANCELLED" }
                $failed.Add($relative) | Out-Null
                Write-Log ("Ошибка: {0} — {1}" -f $relative, $_.Exception.Message)
            }
            Start-Sleep -Milliseconds 400
        }

        $sync.Status = "Готово. Новых: $saved. Уже было: $skipped. Ошибок: $($failed.Count)."
        Write-Log $sync.Status
        Write-Log ("Папка: " + $outRoot)
        if ($failed.Count -gt 0) {
            Write-Log "Не скачались:"
            foreach ($name in $failed) { Write-Log ("  " + $name) }
        }
    } catch {
        if ($_.Exception.Message -eq "CANCELLED" -or $sync.Cancel) {
            $sync.Status = "Остановлено. Уже скачанные файлы лежат в папке."
            Write-Log $sync.Status
            return
        }
        $sync.Status = "Ошибка: " + $_.Exception.Message
        Write-Log $sync.Status
    } finally {
        $sync.Request = $null
        $sync.Done = $true
    }
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
$form.Text = "Яндекс Диск — полные файлы"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(680, 520)
$form.MinimumSize = New-Object System.Drawing.Size(560, 440)
$form.BackColor = $colorBg
$form.ForeColor = $colorText
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Полные файлы с Яндекс Диска"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $false
$title.Location = New-Object System.Drawing.Point(18, 14)
$title.Size = New-Object System.Drawing.Size(644, 32)
$title.Anchor = "Top, Left, Right"
$form.Controls.Add($title)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "Вставьте публичную ссылку. Программа обойдёт файлы и скачает каждый целиком, с теми же папками. Папку одним архивом не качает."
$hint.ForeColor = $colorMuted
$hint.AutoSize = $false
$hint.Location = New-Object System.Drawing.Point(18, 48)
$hint.Size = New-Object System.Drawing.Size(644, 40)
$hint.Anchor = "Top, Left, Right"
$form.Controls.Add($hint)

$linkLabel = New-Object System.Windows.Forms.Label
$linkLabel.Text = "Ссылка"
$linkLabel.Location = New-Object System.Drawing.Point(18, 96)
$linkLabel.Size = New-Object System.Drawing.Size(200, 20)
$form.Controls.Add($linkLabel)

$urlBox = New-Object System.Windows.Forms.TextBox
$urlBox.Location = New-Object System.Drawing.Point(18, 118)
$urlBox.Size = New-Object System.Drawing.Size(644, 28)
$urlBox.Anchor = "Top, Left, Right"
$urlBox.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.Controls.Add($urlBox)

$folderLabel = New-Object System.Windows.Forms.Label
$folderLabel.Text = "Куда сохранить"
$folderLabel.Location = New-Object System.Drawing.Point(18, 156)
$folderLabel.Size = New-Object System.Drawing.Size(200, 20)
$form.Controls.Add($folderLabel)

$destBox = New-Object System.Windows.Forms.TextBox
$destBox.Location = New-Object System.Drawing.Point(18, 178)
$destBox.Size = New-Object System.Drawing.Size(520, 28)
$destBox.Anchor = "Top, Left, Right"
$destBox.Text = [Environment]::GetFolderPath("Desktop")
$form.Controls.Add($destBox)

$browse = New-Object System.Windows.Forms.Button
$browse.Text = "Обзор"
$browse.Location = New-Object System.Drawing.Point(548, 176)
$browse.Size = New-Object System.Drawing.Size(114, 30)
$browse.Anchor = "Top, Right"
$browse.FlatStyle = "Flat"
$browse.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($browse)

$makeRoot = New-Object System.Windows.Forms.CheckBox
$makeRoot.Text = "Создать папку с именем диска"
$makeRoot.Checked = $true
$makeRoot.AutoSize = $true
$makeRoot.Location = New-Object System.Drawing.Point(18, 216)
$form.Controls.Add($makeRoot)

$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "Скачать"
$btnStart.Location = New-Object System.Drawing.Point(18, 248)
$btnStart.Size = New-Object System.Drawing.Size(150, 36)
$btnStart.FlatStyle = "Flat"
$btnStart.FlatAppearance.BorderSize = 0
$btnStart.BackColor = $colorGreen
$btnStart.ForeColor = [System.Drawing.Color]::White
$btnStart.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($btnStart)

$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = "Стоп"
$btnStop.Location = New-Object System.Drawing.Point(178, 248)
$btnStop.Size = New-Object System.Drawing.Size(110, 36)
$btnStop.FlatStyle = "Flat"
$btnStop.Enabled = $false
$btnStop.BackColor = [System.Drawing.Color]::White
$form.Controls.Add($btnStop)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(18, 298)
$bar.Size = New-Object System.Drawing.Size(644, 16)
$bar.Anchor = "Top, Left, Right"
$bar.Minimum = 0
$bar.Maximum = 1
$bar.Value = 0
$bar.Style = "Continuous"
$form.Controls.Add($bar)

$status = New-Object System.Windows.Forms.Label
$status.Text = $script:sync.Status
$status.ForeColor = $colorMuted
$status.AutoSize = $false
$status.Location = New-Object System.Drawing.Point(18, 320)
$status.Size = New-Object System.Drawing.Size(644, 22)
$status.Anchor = "Top, Left, Right"
$form.Controls.Add($status)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = "Vertical"
$log.WordWrap = $true
$log.BackColor = [System.Drawing.Color]::White
$log.Location = New-Object System.Drawing.Point(18, 348)
$log.Size = New-Object System.Drawing.Size(644, 154)
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
    $script:sync.Messages.Clear()
    $log.Clear()
    $bar.Value = 0
    $bar.Maximum = 1
    $status.Text = "Запускаю..."
    Set-Running $true

    $rs = [runspacefactory]::CreateRunspace()
    $rs.ApartmentState = "MTA"
    $rs.Open()
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript($worker).AddArgument($script:sync).AddArgument($url).AddArgument($folder).AddArgument([bool]$makeRoot.Checked)
    $handle = $ps.BeginInvoke()
    $script:job = @{ Ps = $ps; Runspace = $rs; Handle = $handle }
})

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
    $partFile = [string]$script:sync.PartFile
    if ($partFile -and [System.IO.File]::Exists($partFile)) {
        $got = [int64](New-Object System.IO.FileInfo $partFile).Length
        $need = [int64]$script:sync.PartExpected
        if ($need -gt 0) {
            $pct = [int](($got * 100) / $need)
            if ($pct -gt 100) { $pct = 100 }
            $status.Text = "Скачивается файл $($script:sync.Current) из $($script:sync.Total) — $pct%"
        } else {
            $status.Text = "Скачивается файл $($script:sync.Current) из $($script:sync.Total)"
        }
    } else {
        $status.Text = [string]$script:sync.Status
    }
    $total = [int]$script:sync.Total
    $current = [int]$script:sync.Current
    if ($total -gt 0) {
        if ($bar.Maximum -ne $total) { $bar.Maximum = $total }
        $value = $current
        if ($value -lt 0) { $value = 0 }
        if ($value -gt $bar.Maximum) { $value = $bar.Maximum }
        $bar.Value = $value
    }
    if ($script:sync.Done -and $script:job -and $script:job.Handle.IsCompleted) {
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
