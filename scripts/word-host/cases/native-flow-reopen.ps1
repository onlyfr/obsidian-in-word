New-Item -ItemType File -Path $nativeImeStop -Force|Out-Null
if(-not $nativeImeBridge.WaitForExit(6000)){throw 'Native observer did not detach before document reopen.'}
$path=$doc.FullName
$doc.Save();$doc.Close(0)
$script:doc=Invoke-WordSetup {$wordTestApp.Documents.Open($path)}
Invoke-WordSetup {$doc.Activate()}
. (Join-Path $wordHarnessScripts 'cases\native-ime-start.ps1')|Out-Null
@{Reopened=$doc.FullName;Controls=$doc.ContentControls.Count;NativeReattached=$true}
