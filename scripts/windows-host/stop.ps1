param([Parameter(Mandatory=$true)][string]$RunDirectory)
$ErrorActionPreference='Stop'
$testToken = [IO.File]::ReadAllText((Join-Path $RunDirectory 'stop-token'))
Invoke-WebRequest -Method Post -Uri https://localhost:49175/acceptance/stop -Headers @{Authorization='Bearer '+$testToken} | Out-Null
