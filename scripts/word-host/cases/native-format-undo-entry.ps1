Focus-NativeTestDocument
$steps=@()
for($i=1;$i -le 8;$i++){
 if(-not $doc.Undo(1)){throw 'Word Undo failed.'}
 $control=Get-NativeOwnedControl 'format-a'
 if(-not $control){throw 'Undo removed registration before restoring rendered text.'}
 $steps+=@{Tag=$control.Tag;Text=$control.Range.Text}
 if($control.Range.Text.TrimEnd("`r") -eq "Start $formatRedText blueTail."){break}
}
if($i -gt 8){throw ('Word Undo did not restore the rendered paragraph: '+($steps|ConvertTo-Json -Compress))}
@{Count=$i;Steps=$steps}
