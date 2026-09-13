<#
.SYNOPSIS
从本机 Codex 运行时抽出 Windows 底包，写成 dist\runtime-win-x64.tar.zst。

.DESCRIPTION
只需在换运行时（Codex / LibreOffice / artifact-tool）时跑一次。产物上传到
本仓库 tag=runtime 的 Release，之后 Actions 和 build.ps1 只下载这份。

LibreOffice 不在 Codex 的 Windows 运行时里，从官方 MSI 解包（msiexec /a）。
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Dependencies,
  [string]$LibreOffice,
  [string]$Out
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Platform = 'win-x64'
$LibreOfficeVersion = '26.2.5'
$LibreOfficeSha256 = 'f15ba07bfcb0186986cf3171063506f5d207c11f8cc051ba0d135209e9e915f9'
$LibreOfficeUrl = "https://download.documentfoundation.org/libreoffice/stable/$LibreOfficeVersion/win/x86_64/LibreOffice_${LibreOfficeVersion}_Win_x86-64.msi"

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Dist = Join-Path $Root 'dist'
$Cache = Join-Path $Dist '.cache'
if (-not $Out) { $Out = Join-Path $Dist "runtime-$Platform.tar.zst" }

function Step($m) { Write-Host "`n[$m]" -ForegroundColor Cyan }
function Log($m) { Write-Host $m }
function Fail($m) { Write-Host "`n错误: $m`n" -ForegroundColor Red; exit 1 }

if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
  Fail 'seed.ps1 只在 Windows 上抽 win-x64 运行时。macOS 用 node scripts/build.mjs --seed。'
}

function Find-First([string[]]$candidates, [string]$what, [string]$hint) {
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) { return (Resolve-Path -LiteralPath $c).Path }
  }
  Fail "找不到 $what。探过：`n  $($candidates -join "`n  ")`n$hint"
}

function Find-Exe([string]$root, [string]$name) {
  $hit = Get-ChildItem -LiteralPath $root -Filter $name -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object { $_.FullName.Length } | Select-Object -First 1
  if (-not $hit) { Fail "在 $root 下找不到 $name" }
  return $hit.FullName
}

function Get-ComponentRoot([string]$nativeRoot, [string]$exePath) {
  $target = $nativeRoot.TrimEnd('\')
  $cur = Split-Path -Parent $exePath
  while ($cur -and (Split-Path -Parent $cur).TrimEnd('\') -ine $target) {
    $parent = Split-Path -Parent $cur
    if (-not $parent -or $parent -eq $cur) { Fail "$exePath 不在 $nativeRoot 下面" }
    $cur = $parent
  }
  return $cur
}

function Copy-Tree($src, $dest) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
  $null = robocopy $src $dest /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
  if ($LASTEXITCODE -ge 8) { Fail "复制失败 ($LASTEXITCODE): $src -> $dest" }
  $global:LASTEXITCODE = 0
}

function Rel([string]$from, [string]$to) {
  $fromUri = [Uri]((Resolve-Path -LiteralPath $from).Path.TrimEnd('\') + '\')
  $toUri = [Uri](Resolve-Path -LiteralPath $to).Path
  return [Uri]::UnescapeDataString($fromUri.MakeRelativeUri($toUri).ToString()) -replace '/', '\'
}

function Write-Shim([string]$dir, [string]$name, [string]$targetAbs) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $rel = Rel $dir $targetAbs
  $relUnix = $rel -replace '\\', '/'
  $text = @"
#!/usr/bin/env bash
set -euo pipefail
DIR="`$(cd "`$(dirname "`${BASH_SOURCE[0]}")" && pwd)"
exec "`${DIR}/$relUnix" "`$@"
"@
  $path = Join-Path $dir $name
  [IO.File]::WriteAllText($path, $text.Replace("`r`n", "`n") + "`n")
}

if (-not $Dependencies) {
  $Dependencies = Find-First @(
    (Join-Path $env:LOCALAPPDATA 'codex-runtimes\codex-primary-runtime\dependencies'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'),
    (Join-Path $env:APPDATA 'codex-runtimes\codex-primary-runtime\dependencies')
  ) 'Codex 主运行时' '需要本机装过 Codex。也可用 -Dependencies 指路径。'
}

New-Item -ItemType Directory -Path $Dist, $Cache -Force | Out-Null
$Stage = Join-Path $Dist "runtime-$Platform"
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

Step 'Python'
Copy-Tree (Join-Path $Dependencies 'python') (Join-Path $Stage 'python')
foreach ($drop in @('artifact_tool_v2', 'pandas')) {
  Get-ChildItem -LiteralPath (Join-Path $Stage 'python') -Filter "$drop*" -Recurse -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq $drop -or $_.Name -like "$drop-*" } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}
Get-ChildItem -LiteralPath (Join-Path $Stage 'python') -Filter '__pycache__' -Recurse -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
$PythonExe = Find-Exe (Join-Path $Stage 'python') 'python.exe'
Log "  python"

Step 'Node 与 artifact-tool'
New-Item -ItemType Directory -Path (Join-Path $Stage 'node\node_modules\@oai') -Force | Out-Null
Copy-Item -LiteralPath (Find-Exe (Join-Path $Dependencies 'node') 'node.exe') -Destination (Join-Path $Stage 'node\node.exe')
Copy-Tree (Join-Path $Dependencies 'node\node_modules\@oai\artifact-tool') `
  (Join-Path $Stage 'node\node_modules\@oai\artifact-tool')
$NodeExe = Join-Path $Stage 'node\node.exe'
Log "  node"

Step 'Poppler'
$nativeSrc = Join-Path $Dependencies 'native'
$PopplerSrc = Get-ComponentRoot $nativeSrc (Find-Exe $nativeSrc 'pdftoppm.exe')
$PopplerRoot = Join-Path $Stage "native\$(Split-Path -Leaf $PopplerSrc)"
Copy-Tree $PopplerSrc $PopplerRoot
$PopplerBin = Split-Path -Parent (Find-Exe $PopplerRoot 'pdftoppm.exe')
Log "  poppler"

Step 'LibreOffice'
$LibreRoot = Join-Path $Stage 'native\libreoffice'
if ($LibreOffice) {
  Copy-Tree $LibreOffice $LibreRoot
} else {
  $msi = Join-Path $Cache "LibreOffice_$LibreOfficeVersion.msi"
  if (-not (Test-Path -LiteralPath $msi) -or ((Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $LibreOfficeSha256)) {
    Log "  下载 LibreOffice $LibreOfficeVersion …"
    Invoke-WebRequest -Uri $LibreOfficeUrl -OutFile $msi
    $got = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($got -ne $LibreOfficeSha256) { Fail "LibreOffice MSI sha256 对不上`n  期望 $LibreOfficeSha256`n  实际 $got" }
  }
  $extract = Join-Path $Cache "lo-$LibreOfficeVersion"
  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  New-Item -ItemType Directory -Path $extract -Force | Out-Null
  $p = Start-Process -FilePath msiexec.exe -ArgumentList @('/a', $msi, '/qn', "TARGETDIR=$extract") -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "msiexec /a 失败 ($($p.ExitCode))" }
  $program = Get-ChildItem -LiteralPath $extract -Recurse -Filter 'soffice.exe' -File |
    Where-Object { $_.FullName -match '\\program\\soffice\.exe$' } |
    Select-Object -First 1
  if (-not $program) { Fail '解包后找不到 program\soffice.exe' }
  $loSrc = Split-Path -Parent (Split-Path -Parent $program.FullName)
  Copy-Tree $loSrc $LibreRoot
  foreach ($rel in @(
      'share\extensions', 'program\resource', 'share\registry\res',
      'share\gallery', 'share\wizards', 'help'
    )) {
    $p = Join-Path $LibreRoot $rel
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
  }
}
$SofficeExe = Find-Exe $LibreRoot 'soffice.exe'
Log "  libreoffice"

Step 'shim'
$binDir = Join-Path $Stage 'bin\override'
$pathDir = Join-Path $Stage 'path'
$shims = [ordered]@{
  python   = $PythonExe
  python3  = $PythonExe
  node     = $NodeExe
  soffice  = $SofficeExe
  pdftoppm = (Join-Path $PopplerBin 'pdftoppm.exe')
  pdfinfo  = (Join-Path $PopplerBin 'pdfinfo.exe')
}
$onPath = @('soffice', 'pdftoppm', 'pdfinfo')
foreach ($name in $shims.Keys) {
  Write-Shim (Join-Path $Stage 'bin') $name $shims[$name]
  Write-Shim $binDir $name $shims[$name]
  if ($onPath -contains $name) { Write-Shim $pathDir $name $shims[$name] }
}
$manifest = [ordered]@{}
foreach ($name in $onPath) {
  $manifest[$name] = Rel $binDir $(if ($name -eq 'soffice') { $SofficeExe } else { $shims[$name] })
}
[IO.File]::WriteAllText((Join-Path $binDir 'native-executables.json'),
  (($manifest | ConvertTo-Json -Depth 3) + "`n"), (New-Object Text.UTF8Encoding $false))
Log "  bin/ + bin/override + path/"

Step '打包运行时'
$tar = Join-Path $Dist "runtime-$Platform.tar"
Remove-Item -LiteralPath $tar, $Out -Force -ErrorAction SilentlyContinue
& tar.exe -cf $tar -C $Dist (Split-Path -Leaf $Stage)
if ($LASTEXITCODE -ne 0) { Fail 'tar 失败' }
$node = Find-Exe $Stage 'node.exe'
& $node (Join-Path $Root 'scripts\zstd.mjs') $tar $Out 19
if ($LASTEXITCODE -ne 0) { Fail 'zstd 失败' }
Remove-Item -LiteralPath $tar -Force
Remove-Item -LiteralPath $Stage -Recurse -Force
Log "  $Out  $([math]::Round((Get-Item $Out).Length/1MB))MB"
Log "`n传到 Release：gh release upload runtime `"$Out`" --repo riot-org/plugin-doc-runtime --clobber"
