Focus-NativeTestDocument
$steps=0
for($i=1;$i -le 8;$i++){
 if(-not $doc.Undo(1)){throw 'Word Undo failed after lost render reply.'}
 $control=Get-NativeOwnedControl 'format-a'
 if($control.Range.Text.TrimEnd("`r") -eq 'Start **redWorks** blueTail.'){$steps=$i;break}
}
if(-not $steps){throw 'Undo did not restore the edited Markdown.'}
if(-not $doc.Redo($steps)){throw 'Word Redo failed.'}
$control=Get-NativeOwnedControl 'format-a'
if($control.Tag -ne 'owb-body:v1:format-a:rendered' -or $control.Range.Text.TrimEnd("`r") -ne 'Start redWorks blueTail.'){throw 'Word Redo did not restore rendered content.'}
@{Count=$steps;Tag=$control.Tag;Text=$control.Range.Text}
