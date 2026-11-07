New-Item -ItemType File -Path $nativeImeStop -Force|Out-Null
if(-not $nativeImeBridge.WaitForExit(6000)){throw 'Native observer did not detach.'}
$true
