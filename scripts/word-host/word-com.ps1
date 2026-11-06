param([Parameter(Mandatory=$true)][string]$RunDirectory)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $RunDirectory).Path
$wordHarnessScripts = $PSScriptRoot
. (Join-Path $PSScriptRoot 'native-write.ps1')
if(Get-Process WINWORD -ErrorAction SilentlyContinue) { throw 'Close Word before running native acceptance tests.' }
$wordTestApp = New-Object -ComObject Word.Application
$doc = $null
$last = ''
function Invoke-WordSetup([scriptblock]$Action) {
 # Retry only idempotent startup/read operations when Word rejects COM while opening its task pane.
 # Document edits/undo and test commands are never replayed by this helper.
 for($attempt=0;$attempt -lt 30;$attempt++) {
  try { return & $Action }
  catch {
   if($_.Exception.ToString() -notmatch '80010001|8001010A|RPC_E_CALL_REJECTED|RPC_E_SERVERCALL_RETRYLATER' -or $attempt -eq 29){throw}
   Start-Sleep -Milliseconds 200
  }
 }
}
try {
 Invoke-WordSetup {$wordTestApp.Visible = $true}
 Invoke-WordSetup {$wordTestApp.DisplayAlerts = 0}
 $targetDocument=Join-Path $root 'acceptance.docx'
 $doc = Invoke-WordSetup {
  $existing=@($wordTestApp.Documents|Where-Object{$_.FullName -eq $targetDocument})
  if($existing.Count -gt 1){throw 'Duplicate test documents during startup.'}
  if($existing.Count -eq 1){return $existing[0]}
  $wordTestApp.Documents.Open($targetDocument)
 }
 Invoke-WordSetup {$doc.Activate()}
 Write-Output ('WORD_READY ' + (Invoke-WordSetup {$wordTestApp.Version}))
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
 if($null -ne $nativeImeBridge){
  New-Item -ItemType File -Path $nativeImeStop -Force | Out-Null
  [void]$nativeImeBridge.WaitForExit(5000)
 }
 if($null -ne $doc){$doc.Close(0)}
 $discard = 0
 $wordTestApp.Quit([ref]$discard)
 if($null -ne $doc){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)}
 [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wordTestApp)
}
