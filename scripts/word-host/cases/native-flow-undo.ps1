Focus-NativeTestDocument
$steps=@()
for($i=1;$i -le 8;$i++){
 if(-not $doc.Undo(1)){throw 'Native transition undo failed.'}
 $control=@($doc.ContentControls|Where-Object{$_.Tag -like 'owb-body:v1:input-a:*'})[0]
 if(-not $control){throw 'Undo deleted the owned control before restoring source.'}
 $steps+=@{Tag=$control.Tag;Text=$control.Range.Text}
 if($control.Range.Text.TrimEnd("`r") -eq 'Alpha **edited** / _more_ / ~~strike~~ tail'){$script:nativeUndoSteps=$i;break}
}
if(-not $nativeUndoSteps){throw 'Undo did not restore the source within eight steps.'}
@{Steps=$steps;Count=$nativeUndoSteps;Tag=$control.Tag;Text=$control.Range.Text;Paragraphs=$doc.Paragraphs.Count}
