Focus-NativeTestDocument
$script:checkFaultText=$doc.Content.Text
$script:checkFaultTag=(Get-NativeOwnedControl $checkKey).Tag
$script:checkFaultUndo=0
for($i=1;$i -le 8;$i++){
 if(-not $doc.Undo(1)){throw 'Word Undo failed after partial transition.'}
 $script:checkFaultUndo=$i
 if($doc.Content.Text -eq $checkEditedText){break}
}
if($doc.Content.Text -ne $checkEditedText){throw 'Undo did not restore rendered text.'}
@{Steps=$checkFaultUndo;Tag=(Get-NativeOwnedControl $checkKey).Tag;Text=$doc.Content.Text}
