param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if(-not (Test-Path -LiteralPath $vswhere)){throw 'Visual Studio C++ tools and Windows SDK are required.'}
$installation=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if(-not $installation){throw 'Visual Studio x64 C++ tools are required.'}
$vcvars=Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
$source=Join-Path $PSScriptRoot 'bridge.cpp'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output=(Resolve-Path -LiteralPath $OutputDirectory).Path
$build=Join-Path $output 'compile.cmd'
@"
@echo off
call "$vcvars" >nul
if errorlevel 1 exit /b 1
cl /nologo /W4 /WX /EHsc /std:c++17 /DIME_OBSERVER_DLL /LD "$source" /Fo:observer.obj /Fe:word-ime-observer.dll ole32.lib user32.lib uuid.lib
if errorlevel 1 exit /b 1
cl /nologo /W4 /WX /EHsc /std:c++17 "$source" /Fo:bridge.obj /Fe:word-ime-bridge.exe ole32.lib user32.lib uuid.lib
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $build -Encoding ascii
Push-Location -LiteralPath $output
try { & $env:ComSpec /c compile.cmd; if($LASTEXITCODE -ne 0){throw "Native bridge build failed ($LASTEXITCODE)"} }
finally { Pop-Location }
