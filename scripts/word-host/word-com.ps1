param([Parameter(Mandatory=$true)][string]$RunDirectory)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $RunDirectory).Path
if(Get-Process WINWORD -ErrorAction SilentlyContinue) { throw 'Close Word before running native acceptance tests.' }
$wordTestApp = New-Object -ComObject Word.Application
$doc = $null
$last = ''
try {
 $wordTestApp.Visible = $true
 $wordTestApp.DisplayAlerts = 0
 $doc = $wordTestApp.Documents.Open((Join-Path $root 'acceptance.docx'))
 $doc.Activate()
 Write-Output ('WORD_READY ' + $wordTestApp.Version)
 while ($true) {
  $path = Join-Path $root 'com-command.json'
  if (Test-Path -LiteralPath $path) {
   $job = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
   if ($job.id -ne $last) {
    $last = $job.id
    try {
     $value = & ([scriptblock]::Create($job.code))
     $result = @{ id=$job.id; ok=$true; value=$value }
    } catch { $result = @{ id=$job.id; ok=$false; error=$_.Exception.Message } }
    $line = $result | ConvertTo-Json -Depth 30 -Compress
    Add-Content -LiteralPath (Join-Path $root 'com-results.jsonl') -Value $line -Encoding UTF8
    Write-Output $line
    if ($job.id -eq 'close') { break }
   }
  }
  Start-Sleep -Milliseconds 250
 }
} finally {
 if($null -ne $doc){$doc.Close(0)}
 $discard = 0
 $wordTestApp.Quit([ref]$discard)
 if($null -ne $doc){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wordTestApp)
}
