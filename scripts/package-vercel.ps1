$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $root 'release'
[IO.Directory]::CreateDirectory($release) | Out-Null
$staging = [IO.Path]::GetFullPath((Join-Path $release ('vercel-source-' + [guid]::NewGuid().ToString('N'))))
$archive = Join-Path $release ('acores-vercel-supabase-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
[IO.Directory]::CreateDirectory($staging) | Out-Null
try {
    foreach ($file in @('package.json','package-lock.json','index.html','vite.config.js','eslint.config.js','vercel.json','.gitignore','.env.example','README.md')) {
        Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $staging $file)
    }
    foreach ($directory in @('src','public','docs','scripts','tests','supabase','.github')) {
        Copy-Item -LiteralPath (Join-Path $root $directory) -Destination (Join-Path $staging $directory) -Recurse
    }
    [IO.Directory]::CreateDirectory((Join-Path $staging 'server')) | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $root 'server') -File -Filter '*.js' | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $staging 'server')
    }
    $privateFiles = Get-ChildItem -LiteralPath $staging -Recurse -Force -File | Where-Object {
        $_.Name -match '\.(sqlite|db|key|pem|log|enc)(-|$|\.)' -or
        ($_.Name -like '.env*' -and $_.Name -ne '.env.example')
    }
    if ($privateFiles) { throw 'Arquivo privado detectado; pacote cancelado.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($staging, $archive)
    Write-Output $archive
} finally {
    $expectedParent = [IO.Path]::GetFullPath($release)
    if ([IO.Path]::GetDirectoryName($staging) -ne $expectedParent) { throw 'Diretorio de limpeza invalido.' }
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
