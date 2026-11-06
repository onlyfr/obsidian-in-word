if(-not ('WordInputProbe' -as [type])){Add-Type -Path (Join-Path $wordHarnessScripts 'native-input.cs')}
if($doc.FullName -ne (Join-Path $root 'acceptance.docx')){throw 'Unexpected test document.'}
$doc.Activate();$wordTestApp.ActiveWindow.ActivePane.Activate()
$handle=[IntPtr]$wordTestApp.ActiveWindow.Hwnd
$shell=New-Object -ComObject WScript.Shell
[void]$shell.AppActivate('acceptance.docx - Word')
[WordInputProbe]::Focus($handle)
$wordProcessId=[WordInputProbe]::ProcessId($handle)
$script:nativeImeStop=Join-Path $root ('native-ime-stop-'+[Guid]::NewGuid().ToString('N'))
$nativeImeLog=Join-Path $root 'native-ime.jsonl'
$script:nativeImeEpoch=(Split-Path $root -Leaf)+'-'+[Guid]::NewGuid().ToString('N')
$epoch=$nativeImeEpoch
$initialLogLength=if(Test-Path -LiteralPath $nativeImeLog){(Get-Item -LiteralPath $nativeImeLog).Length}else{0}
$startInfo=New-Object Diagnostics.ProcessStartInfo
$startInfo.FileName=$env:WORD_IME_BRIDGE_EXE
$startInfo.Arguments=(@($handle.ToInt64(),$wordProcessId,('"'+$nativeImeLog+'"'),('"'+$nativeImeStop+'"'),$epoch,('"'+$doc.FullName+'"')) -join ' ')
$startInfo.UseShellExecute=$false
$startInfo.CreateNoWindow=$true
$script:nativeImeBridge=[Diagnostics.Process]::Start($startInfo)
$deadline=[DateTime]::UtcNow.AddSeconds(5)
while(-not (Test-Path -LiteralPath $nativeImeLog) -or (Get-Item -LiteralPath $nativeImeLog).Length -le $initialLogLength){
 if($nativeImeBridge.HasExited){throw "Native IME bridge exited ($($nativeImeBridge.ExitCode))"}
 if([DateTime]::UtcNow -gt $deadline){throw 'Native IME bridge did not publish a state.'}
 Start-Sleep -Milliseconds 50
}
$sourceControl=@($doc.ContentControls|Where-Object{$_.Tag -eq 'owb-body:v1:input-a:source'})[0]
if($sourceControl){$script:nativeGuardPacket=New-NativeWritePacket $sourceControl 'SHOULD NOT APPEAR'}else{$script:nativeGuardPacket=$null}
@{Epoch=$epoch;Window=$handle.ToInt64();Process=$wordProcessId;Native=$true}
