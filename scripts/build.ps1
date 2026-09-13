<#
.SYNOPSIS
用已有运行时底包 + 本仓库源码打 Windows 插件包。

.DESCRIPTION
运行时（Python / Node / LibreOffice / artifact-tool）不进 git。先在装过 Codex
的 Windows 机器上跑 seed.ps1，把 runtime-win-x64.tar.zst 传到 tag=runtime 的
Release。本脚本（以及 GitHub Actions）只下载那份底包，叠上 skills / plugin.json。

.PARAMETER Runtime
运行时 tar.zst。不传就取 dist\runtime-win-x64.tar.zst。

.PARAMETER Out
产物目录。不传就取 dist\win-x64。

.EXAMPLE
pwsh scripts/build.ps1
pwsh scripts/build.ps1 -Runtime D:\runtime-win-x64.tar.zst
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Runtime,
  [string]$Out,
  [switch]$StageOnly,
  [switch]$KeepStage
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackName = 'doc-runtime'
$Platform = 'win-x64'
$PluginRepoSlug = if ($env:GITHUB_REPOSITORY) { $env:GITHUB_REPOSITORY } else { 'riot-org/plugin-doc-runtime' }

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Dist = Join-Path $Root 'dist'
$Cache = Join-Path $Dist '.cache'
$ReleaseTag = $null

function Step($m) { Write-Host "`n[$m]" -ForegroundColor Cyan }
function Log($m) { Write-Host $m }
function Fail($m) { Write-Host "`n错误: $m`n" -ForegroundColor Red; exit 1 }

if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
  Fail '这个脚本只在 Windows 上产出 win-x64 包。macOS 请用 scripts/build.mjs。'
}

$sourcePluginPath = Join-Path $Root 'plugin.json'
if (-not (Test-Path -LiteralPath $sourcePluginPath)) { Fail "$Root 里没有 plugin.json" }
$sourcePlugin = Get-Content -LiteralPath $sourcePluginPath -Raw | ConvertFrom-Json
if ($sourcePlugin.name -ne $PackName) { Fail "plugin.json 的 name 是 $($sourcePlugin.name)" }
$Version = [string]$sourcePlugin.version
$PluginDescription = [string]$sourcePlugin.description
if (-not $Version -or -not $PluginDescription) { Fail 'plugin.json 缺 version 或 description' }
if (-not (Test-Path -LiteralPath (Join-Path $Root 'skills'))) { Fail '没有 skills/' }
if (-not (Test-Path -LiteralPath (Join-Path $Root 'mcp.json'))) { Fail '没有 mcp.json' }
$ReleaseTag = "$PackName-v$Version"

if (-not $Runtime) { $Runtime = Join-Path $Dist "runtime-$Platform.tar.zst" }
if (-not $Out) { $Out = Join-Path $Dist $Platform }
New-Item -ItemType Directory -Path $Dist, $Cache, $Out -Force | Out-Null

if (-not (Test-Path -LiteralPath $Runtime)) {
  Fail @"
找不到运行时包:
  $Runtime
在装过 Codex 的 Windows 上先跑:
  pwsh scripts/seed.ps1
再把 dist\runtime-win-x64.tar.zst 传到本仓库 tag=runtime 的 Release。
"@
}

function Find-Exe([string]$root, [string]$name) {
  $hit = Get-ChildItem -LiteralPath $root -Filter $name -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object { $_.FullName.Length } | Select-Object -First 1
  if (-not $hit) { Fail "在 $root 下找不到 $name" }
  return $hit.FullName
}

function Rel([string]$from, [string]$to) {
  $fromUri = [Uri]((Resolve-Path -LiteralPath $from).Path.TrimEnd('\') + '\')
  $toUri = [Uri](Resolve-Path -LiteralPath $to).Path
  return [Uri]::UnescapeDataString($fromUri.MakeRelativeUri($toUri).ToString()) -replace '/', '\'
}

function Size-Of($dir) {
  $sum = (Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue |
    Measure-Object -Property Length -Sum).Sum
  if (-not $sum) { return 0 }
  return [int64]$sum
}
function Mb($bytes) { '{0:N0}MB' -f ($bytes / 1MB) }

$Stage = Join-Path $Dist "$PackName-$Version-$Platform"
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

Step '展开运行时'
$tar = Join-Path $Cache "runtime-$Platform-$PID.tar"
$tmp = Join-Path $Cache "unpack-$PID"
Remove-Item -LiteralPath $tar, $tmp -Recurse -Force -ErrorAction SilentlyContinue
$nodeForZstd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeForZstd) { Fail '需要 Node 22.15+（解压 zstd）' }
& node (Join-Path $Root 'scripts\zstd.mjs') -d $Runtime $tar
if ($LASTEXITCODE -ne 0) { Fail '解压运行时失败' }
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
& tar.exe -xf $tar -C $tmp
if ($LASTEXITCODE -ne 0) { Fail '展开运行时 tar 失败' }
Remove-Item -LiteralPath $tar -Force
$kids = @(Get-ChildItem -LiteralPath $tmp -Directory)
if ($kids.Count -ne 1) { Fail "运行时包顶层该有一个目录，实际 $($kids.Count) 个" }
Get-ChildItem -LiteralPath $kids[0].FullName | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Stage $_.Name) -Recurse -Force
}
Remove-Item -LiteralPath $tmp -Recurse -Force
Log "  ← $Runtime"

Step '叠源码'
Copy-Item -LiteralPath (Join-Path $Root 'skills') -Destination (Join-Path $Stage 'skills') -Recurse -Force
$PythonExe = Find-Exe $Stage 'python.exe'
$NodeExe = Find-Exe $Stage 'node.exe'
$SofficeCom = $null
$sofficeComHit = Get-ChildItem -LiteralPath $Stage -Filter 'soffice.com' -Recurse -File -ErrorAction SilentlyContinue |
  Sort-Object { $_.FullName.Length } | Select-Object -First 1
if ($sofficeComHit) { $SofficeCom = $sofficeComHit.FullName }
else { $SofficeCom = Find-Exe $Stage 'soffice.exe' }
$Pdftoppm = Find-Exe $Stage 'pdftoppm.exe'

function RelToStage([string]$p) { './' + ((Rel $Stage $p) -replace '\\', '/') }

$pluginJson = [ordered]@{
  '$schema'   = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
  name        = $PackName
  version     = $Version
  description = $PluginDescription
  author      = [ordered]@{ name = 'Riot' }
  repository  = "https://github.com/$PluginRepoSlug"
  keywords    = @('documents', 'docx', 'xlsx', 'pptx', 'pdf')
  extensions  = [ordered]@{
    'dev.riot' = [ordered]@{
      platforms   = @($Platform)
      env         = [ordered]@{
        RUNTIME_NODE         = (RelToStage $NodeExe)
        RUNTIME_NODE_MODULES = './node/node_modules'
        RUNTIME_BIN_DIR      = if (Test-Path -LiteralPath (Join-Path $Stage 'bin\override')) { './bin/override' } else { './bin' }
      }
      pathPrepend = @('./path')
      selfCheck   = @(
        [ordered]@{ command = (RelToStage $PythonExe); args = @('-c', 'import docx, pptx, openpyxl, pdfplumber, reportlab') }
        [ordered]@{ command = (RelToStage $NodeExe); args = @('-v') }
        [ordered]@{ command = (RelToStage $SofficeCom); args = @('--version') }
        [ordered]@{ command = (RelToStage $Pdftoppm); args = @('-v') }
      )
      builtAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    }
  }
}
[IO.File]::WriteAllText((Join-Path $Stage 'plugin.json'),
  (($pluginJson | ConvertTo-Json -Depth 8) + "`n"), (New-Object Text.UTF8Encoding $false))

$mcpJson = Get-Content -LiteralPath (Join-Path $Root 'mcp.json') -Raw | ConvertFrom-Json
$mcpJson.mcpServers.'doc-artifact-tool'.command = RelToStage $NodeExe
[IO.File]::WriteAllText((Join-Path $Stage 'mcp.json'),
  (($mcpJson | ConvertTo-Json -Depth 6) + "`n"), (New-Object Text.UTF8Encoding $false))

$installedSize = Size-Of $Stage
Log "铺出完成: $(Mb $installedSize)"

if ($StageOnly) {
  Log "-StageOnly: $Stage"
  exit 0
}

Step '打包'
$tarOut = Join-Path $Dist "$PackName-$Version-$Platform.tar"
$tarball = Join-Path $Out "$PackName-$Version-$Platform.tar.zst"
Remove-Item -LiteralPath $tarOut, $tarball -Force -ErrorAction SilentlyContinue
& tar.exe -cf $tarOut -C $Dist (Split-Path -Leaf $Stage)
if ($LASTEXITCODE -ne 0) { Fail 'tar 打包失败' }
& node (Join-Path $Root 'scripts\zstd.mjs') $tarOut $tarball 19
if ($LASTEXITCODE -ne 0) { Fail 'zstd 压缩失败' }
Remove-Item -LiteralPath $tarOut -Force
$sha256 = (Get-FileHash -LiteralPath $tarball -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $tarball).Length
Log "  $(Split-Path -Leaf $tarball)  $(Mb $size)  sha256 $($sha256.Substring(0,16))…"

Step 'marketplace.json'
$manifestPath = Join-Path $Out 'marketplace.json'
$m = [PSCustomObject]@{ name = 'riot'; owner = [PSCustomObject]@{ name = 'Riot' }; plugins = @() }
$entry = [PSCustomObject]@{
  name        = $PackName
  description = $PluginDescription
  version     = $Version
  author      = [PSCustomObject]@{ name = 'Riot' }
  category    = 'documents'
  tags        = @('docx', 'xlsx', 'pptx', 'pdf')
  source      = [PSCustomObject]@{
    source     = 'archive'
    platforms  = [PSCustomObject]@{
      $Platform = [PSCustomObject]@{
        url           = "https://github.com/$PluginRepoSlug/releases/download/$ReleaseTag/$(Split-Path -Leaf $tarball)"
        sha256        = $sha256
        size          = $size
        installedSize = $installedSize
      }
    }
  }
}
$m.plugins = @($entry)
[IO.File]::WriteAllText($manifestPath, (($m | ConvertTo-Json -Depth 10) + "`n"), (New-Object Text.UTF8Encoding $false))
Log "  $manifestPath"

if (-not $KeepStage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
Log "`n完成。压缩 $(Mb $size)，安装后 $(Mb $installedSize)。"
Log "  $tarball"
