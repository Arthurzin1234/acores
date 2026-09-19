param([switch]$Install, [switch]$Uninstall, [switch]$NoBrowser, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$data = Join-Path $root 'data'
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Acores.lnk'
$shellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$scriptPath = Join-Path $PSScriptRoot 'start-acores.ps1'
if ($Uninstall) {
    if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
    Write-Output 'Inicio automatico do Acores removido. Dados preservados.'
    exit 0
}
if ($Install) {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $shellPath
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -NoBrowser'
    $shortcut.WorkingDirectory = $root
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Iniciar Acores ao entrar no Windows'
    $shortcut.Save()
    Write-Output 'Acores configurado para iniciar ao entrar no Windows, sem abrir janelas.'
    exit 0
}
$node = (Get-Command node -ErrorAction Stop).Source
if (!(Test-Path -LiteralPath (Join-Path $root 'dist\index.html'))) { throw 'Compile o site com npm run build antes de iniciar.' }
if (!(Test-Path -LiteralPath (Join-Path $root 'node_modules\vite\bin\vite.js'))) { throw 'Dependencias ausentes. Execute npm install.' }
if ($DryRun) { Write-Output 'Node, compilacao e dependencias encontrados. Nenhum processo iniciado.'; exit 0 }
[IO.Directory]::CreateDirectory($data) | Out-Null
$hasher = [Security.Cryptography.SHA256]::Create()
$rootHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($root))).Replace('-','').Substring(0,16)
$hasher.Dispose()
$mutex = New-Object Threading.Mutex($false, ('Local\AcoresStartup-' + $rootHash))
$locked = $false
function Is-AcoresReady([int]$port) {
    try { $result = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 3; return ($result.ok -eq $true -and $result.service -eq 'acores') }
    catch { return $false }
}
function Port-InUse([int]$port) { return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
function Start-Worker([string]$script, [string]$name) {
    $process = Start-Process -FilePath $node -ArgumentList $script -WorkingDirectory $root -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $data "$name.log") -RedirectStandardError (Join-Path $data "$name-error.log")
    return $process.Id
}
try {
    try { $locked = $mutex.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'Outra inicializacao do Acores esta em andamento.' }
    if (!(Is-AcoresReady 3333)) {
        if (Port-InUse 3333) { throw 'A porta 3333 esta ocupada ou a API requer verificacao. Nenhum processo foi encerrado.' }
        Start-Worker 'scripts/supervise.mjs' 'startup-api' | Out-Null
        for ($attempt = 0; $attempt -lt 15 -and !(Is-AcoresReady 3333); $attempt++) { Start-Sleep -Seconds 1 }
        if (!(Is-AcoresReady 3333)) { throw 'A API nao iniciou. Confira data/startup-api-error.log.' }
    }
    if (!(Is-AcoresReady 5173)) {
        if (Port-InUse 5173) { throw 'A porta 5173 esta ocupada por outro servico. Nenhum processo foi encerrado.' }
        Start-Worker 'scripts/supervise-web.mjs' 'startup-web' | Out-Null
        for ($attempt = 0; $attempt -lt 15 -and !(Is-AcoresReady 5173); $attempt++) { Start-Sleep -Seconds 1 }
        if (!(Is-AcoresReady 5173)) { throw 'O site nao iniciou. Confira data/startup-web-error.log.' }
    }
    $url = 'http://127.0.0.1:5173/'
    if (!$NoBrowser) { Start-Process $url }
    Write-Output ('Acores disponivel em ' + $url)
} catch {
    [IO.File]::AppendAllText((Join-Path $data 'startup-status.log'), ((Get-Date -Format o) + ' ' + $_.Exception.Message + [Environment]::NewLine))
    Write-Error $_.Exception.Message
    exit 1
} finally { if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
