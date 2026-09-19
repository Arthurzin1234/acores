$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($relative in @('data', 'server/auth')) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $workspace $relative))
  if (-not $target.StartsWith($workspace + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Destino fora do projeto.' }
  if (Test-Path -LiteralPath $target) {
    & icacls $target /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' /Q
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger a pasta.' }
    & icacls (Join-Path $target '*') /inheritance:e /T /Q
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao proteger os arquivos.' }
  }
}
Write-Output 'Pastas privadas limitadas ao usuário atual e SYSTEM. Configure a conta do serviço antes de mudar o executor.'
