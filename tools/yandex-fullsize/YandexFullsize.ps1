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
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
[System.Net.ServicePointManager]::Expect100Continue = $false
[System.Net.ServicePointManager]::DefaultConnectionLimit = 8

$script:sync = [hashtable]::Synchronized(@{
    Cancel = $false
    Done = $false
    Current = 0
    Total = 0
    Status = "Вставьте публичную ссылку на папку Яндекс Диска."
    OpenPath = ""
    Request = $null
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

    function Invoke-Yandex([string]$endpoint, [hashtable]$query) {
        $pairs = New-Object System.Collections.Generic.List[string]
        foreach ($key in $query.Keys) {
            $value = $query[$key]
            if ($null -eq $value) { continue }
            $text = [string]$value
            if ($text -eq "") { continue }
            [void]$pairs.Add(("{0}={1}" -f [uri]::EscapeDataString($key), [uri]::EscapeDataString($text)))
        }
        $url = "https://cloud-api.yandex.net/v1/disk/public/$endpoint?" + ($pairs -join "&")
        $lastError = $null
        for ($try = 1; $try -le 4; $try++) {
            Assert-Continue
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
                try {
                    $json = $reader.ReadToEnd()
                } finally {
                    $reader.Close()
                }
                return ($json | ConvertFrom-Json)
            } catch {
                if ($sync.Cancel) { throw "CANCELLED" }
                $detail = $_.Exception.Message
                $web = $_.Exception
                if ($web -isnot [System.Net.WebException] -and $_.Exception.InnerException) {
                    $web = $_.Exception.InnerException
                }
                if ($web -is [System.Net.WebException] -and $web.Response) {
                    try {
                        $errReader = New-Object System.IO.StreamReader($web.Response.GetResponseStream(), [System.Text.Encoding]::UTF8)
                        $body = $errReader.ReadToEnd()
                        $errReader.Close()
                        if ($body -match '"description"\s*:\s*"([^"]+)"') { $detail = $Matches[1] }
                        elseif ($body) { $detail = $body }
                    } catch {
                    }
                }
                $lastError = $detail
                if ($try -eq 4) { throw $detail }
                Write-Log ("Яндекс не ответил, повтор $try из 3. $detail")
                Start-Sleep -Seconds ([Math]::Pow(2, $try))
            } finally {
                $sync.Request = $null
                if ($response) { $response.Close() }
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
                try {
                    Receive-Http $href $part $expected
                } catch {
                    if ($sync.Cancel -or $_.Exception.Message -eq "CANCELLED") { throw "CANCELLED" }
                    Write-Log ("Прямая загрузка оборвалась, повтор через curl. " + $_.Exception.Message)
                    if ([System.IO.File]::Exists($part)) { [System.IO.File]::Delete($part) }
                    Receive-Curl $href $part
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

    function Get-DiskFiles([string]$url) {
        $root = Invoke-Yandex "resources" @{ public_key = $url }
        $files = New-Object System.Collections.Generic.List[object]
        if ($root.type -eq "file") {
            [void]$files.Add($root)
            return @{ Name = $root.name; Files = $files }
        }

        $seen = @{}
        $fileSeen = @{}
        function Walk([string]$path) {
            if ($seen.ContainsKey($path)) { return }
            $seen[$path] = $true
            $offset = 0
            do {
                Assert-Continue
                $sync.Status = "Смотрю папки на диске..."
                $page = Invoke-Yandex "resources" @{
                    public_key = $url
                    path = $path
                    limit = 100
                    offset = $offset
                }
                $batch = @()
                if ($page._embedded -and $page._embedded.items) {
                    $batch = @($page._embedded.items)
                }
                $total = 0
                if ($page._embedded -and $null -ne $page._embedded.total) {
                    $total = [int]$page._embedded.total
                }
                foreach ($item in $batch) {
                    if ($null -eq $item) { continue }
                    if ($item.type -eq "dir") {
                        Walk ([string]$item.path)
                    } elseif ($item.type -eq "file") {
                        $filePath = [string]$item.path
                        if ($fileSeen.ContainsKey($filePath)) { continue }
                        $fileSeen[$filePath] = $true
                        [void]$files.Add($item)
                        $sync.Status = "Нашёл файлов: $($files.Count)"
                    }
                }
                if ($batch.Count -eq 0) { break }
                $offset += $batch.Count
            } while ($offset -lt $total)
        }

        Walk "/"
        $name = [string]$root.name
        if ([string]::IsNullOrWhiteSpace($name)) { $name = "Яндекс Диск" }
        return @{ Name = $name; Files = $files }
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
                $meta = Invoke-Yandex "resources/download" @{
                    public_key = $publicUrl
                    path = [string]$file.path
                }
                if (-not $meta.href) { throw "Яндекс не дал ссылку на файл" }
                # Only this file. Never the folder: a folder link returns a zip and stalls.
                $size = Save-FullFile ([string]$meta.href) $dest $expected
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
    $status.Text = [string]$script:sync.Status
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
    $timer.Stop()
})

[void]$form.ShowDialog()
$timer.Stop()
