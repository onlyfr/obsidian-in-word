$helper=Join-Path $wordHarnessScripts 'native-input.cs'
if(-not ('WordInputProbe' -as [type])){Add-Type -Path $helper}
if($doc.FullName -ne (Join-Path $root 'acceptance.docx')){throw 'Unexpected active test document.'}
$doc.Activate()
$wordTestApp.ActiveWindow.ActivePane.Activate()
$handle=[IntPtr]$wordTestApp.ActiveWindow.Hwnd
$shell=New-Object -ComObject WScript.Shell
[void]$shell.AppActivate('acceptance.docx - Word')
[WordInputProbe]::Focus($handle)
$oldLayout=[WordInputProbe]::Layout($handle)
$oldIme=[WordInputProbe]::Observe($handle)
$layouts=@([WordInputProbe]::Layouts())
$english=@($layouts|Where-Object{($_ -band 65535) -eq 1033})
try{
 if($english.Count -gt 0){[WordInputProbe]::UseLayout($handle,$english[0])}
 else{[void][WordInputProbe]::NativeMode($handle,$false)}
 foreach($vk in @(81,87,69)){[WordInputProbe]::Key($handle,$vk);Start-Sleep -Milliseconds 100}
 Start-Sleep -Milliseconds 200
 @{VirtualKeys=@('Q','W','E');SelectionStart=$wordTestApp.Selection.Start;Text=$doc.Content.Text;Layouts=$layouts;Ime=[WordInputProbe]::Observe($handle)}
}finally{[WordInputProbe]::UseLayout($handle,$oldLayout);[WordInputProbe]::RestoreState($handle,$oldIme)}
