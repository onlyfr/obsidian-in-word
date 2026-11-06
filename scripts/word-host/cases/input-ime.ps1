if(-not ('WordInputProbe' -as [type])){Add-Type -Path (Join-Path $wordHarnessScripts 'native-input.cs')}
$doc.Activate();$wordTestApp.ActiveWindow.ActivePane.Activate()
$handle=[IntPtr]$wordTestApp.ActiveWindow.Hwnd
$shell=New-Object -ComObject WScript.Shell
[void]$shell.AppActivate('acceptance.docx - Word')
[WordInputProbe]::Focus($handle)
$oldLayout=[WordInputProbe]::Layout($handle)
$oldIme=[WordInputProbe]::Observe($handle)
$korean=@([WordInputProbe]::Layouts()|Where-Object{($_ -band 65535) -eq 1042})
if($korean.Count -eq 0){return @{Available=$false;Reason='No existing Korean keyboard layout';ActualCompositionVerified=$false}}
$trace=@()
try{
 [WordInputProbe]::UseLayout($handle,$korean[0])
 $nativeModeRequested=[WordInputProbe]::NativeMode($handle,$true)
 try{
  foreach($vk in @(82,75,83,75,69,75)){
   [WordInputProbe]::Key($handle,$vk);Start-Sleep -Milliseconds 120
   $trace+=[WordInputProbe]::Observe($handle)
   if($nativeGuardPacket -and $trace.Count -eq 2){
    $guardCode=Invoke-NativeWritePacket $nativeGuardPacket -KeepUnfocused
    if($guardCode -ne 1){throw "Active TSF composition write guard returned $guardCode, expected 1"}
   }
  }
 }catch{@{Trace=$trace;FailedKey=$vk;Text=$doc.Content.Text;Error=$_.Exception.Message}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $root 'input-failure.json') -Encoding UTF8;throw}
 [WordInputProbe]::Key($handle,32);Start-Sleep -Milliseconds 200
 @{Available=$true;NativeModeRequested=$nativeModeRequested;Trace=$trace;CommittedText=$doc.Content.Text;ActualCompositionVerified=(@($trace|Where-Object{$_.CompositionBytes -gt 0}).Count -gt 0);NativeGuardBlockedActive=($guardCode -eq 1)}
}finally{
 [WordInputProbe]::UseLayout($handle,$oldLayout)
 [WordInputProbe]::RestoreState($handle,$oldIme)
}
