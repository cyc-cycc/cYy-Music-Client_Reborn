# set-version.ps1
# 替换 frontend/package.json、package-lock.json、index.html 中的版本号
# 用法: powershell -File set-version.ps1 -Version 8.2.0

param(
    [Parameter(Mandatory=$true)][string]$Version
)

$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding $false

# 定位脚本所在目录作为根
$Root = $PSScriptRoot
if (-not $Root) {
    $Root = Split-Path -Parent $MyInvocation.MyCommand.Path
}

function Update-File {
    param(
        [string]$Path,
        [string]$Pattern,
        [string]$Replacement
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Host "  skip: $Path"
        return 0
    }
    $content = [IO.File]::ReadAllText($Path, $enc)
    $newContent = [regex]::Replace($content, $Pattern, $Replacement)
    if ($newContent -eq $content) {
        Write-Host "  no change: $Path"
        return 0
    }
    [IO.File]::WriteAllText($Path, $newContent, $enc)
    Write-Host "  updated: $Path"
    return 1
}

# 顶层 version（2 空格缩进）—— 匹配 package.json / package-lock.json 顶层
$patternTop = '(?m)^(  "version"\s*:\s*")[^"]*(")'
# packages[""] 里的 version（6 空格缩进）
$patternPkg = '(?m)^(      "version"\s*:\s*")[^"]*(")'
# index.html 里的 "版本 x.y.z"（\u7248\u672C 由 .NET 正则解析为中文"版本"）
$patternHtml = '(\u7248\u672C\s+)[0-9A-Za-z._-]+'

$replacement     = '${1}' + $Version + '${2}'
$replacementHtml = '${1}' + $Version

$pkgPath  = Join-Path $Root 'frontend\package.json'
$lockPath = Join-Path $Root 'frontend\package-lock.json'
$htmlPath = Join-Path $Root 'frontend\index.html'

$count = 0
$count += Update-File $pkgPath  $patternTop  $replacement
$count += Update-File $lockPath $patternTop  $replacement
$count += Update-File $lockPath $patternPkg  $replacement
$count += Update-File $htmlPath $patternHtml $replacementHtml

Write-Host ''
Write-Host "Done. $count replacement(s)."
exit 0