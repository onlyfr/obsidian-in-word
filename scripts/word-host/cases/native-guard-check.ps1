$control=@($doc.ContentControls|Where-Object{$_.Tag -eq 'owb-body:v1:input-a:source'})[0]
if(-not $control){throw 'Owned source block missing.'}
$original=$control.Range.Text
$results=@{}
$handle=[IntPtr]$wordTestApp.ActiveWindow.Hwnd
$shell=New-Object -ComObject WScript.Shell
function Assert-WriteResult([string]$Name,[int]$Code,[int]$Expected) {
 if($Code -ne $Expected){throw "$Name returned $Code, expected $Expected"}
 $results[$Name]=$Code
}
$packet=New-NativeWritePacket $control 'SHOULD NOT APPEAR' -ExpectedText 'stale source'
Assert-WriteResult 'textConflict' (Invoke-NativeWritePacket $packet) 5
if($control.Range.Text -ne $original){throw 'Conflict mutated source.'}
$packet=New-NativeWritePacket $control 'SHOULD NOT APPEAR' -ControlId 'not-owned'
Assert-WriteResult 'identityConflict' (Invoke-NativeWritePacket $packet) 4
$packet=New-NativeWritePacket $control 'SHOULD NOT APPEAR'
Assert-WriteResult 'epochConflict' (Invoke-NativeWritePacket $packet 'wrong-run') 21
Start-Sleep -Milliseconds 1100
$packet=New-NativeWritePacket $control 'SHOULD NOT APPEAR' -Sequence 1
Assert-WriteResult 'staleObservation' (Invoke-NativeWritePacket $packet) 3
$packet=New-NativeWritePacket $control "first`nsecond"
Assert-WriteResult 'unsupportedMultiline' (Invoke-NativeWritePacket $packet) 22
$xml=$control.Range.WordOpenXML
$control.Range.Font.Italic=-1
$packet=New-NativeWritePacket $control 'SHOULD NOT APPEAR' -ExpectedXml $xml
Assert-WriteResult 'formatConflict' (Invoke-NativeWritePacket $packet) 5
$control.Range.Font.Italic=0
$doc.TrackRevisions=$true
try{
 $packet=New-NativeWritePacket $control 'SHOULD NOT APPEAR'
 Assert-WriteResult 'trackChangesEnabled' (Invoke-NativeWritePacket $packet) 6
}finally{$doc.TrackRevisions=$false}
if($control.Range.Text -ne $original){throw 'Rejected writes mutated source.'}
$packet=New-NativeWritePacket $control 'SHOULD NOT APPEAR'
$wordTestApp.Visible=$false
try{Assert-WriteResult 'unknownFocus' (Invoke-NativeWritePacket $packet -KeepUnfocused) 2}
finally{$wordTestApp.Visible=$true;$doc.Activate();$wordTestApp.ActiveWindow.ActivePane.Activate();[void]$shell.AppActivate('acceptance.docx - Word');[WordInputProbe]::Focus($handle)}
$replacement='Alpha **guarded source** tail'
$packet=New-NativeWritePacket $control $replacement
$code=Invoke-NativeWritePacket $packet
Assert-WriteResult 'idleWrite' $code 0
if($control.Range.Text -ne $replacement){throw 'Native source replacement was not applied.'}
@{Checks=$results;Original=$original;Replacement=$control.Range.Text;NativeWrite=$true}
