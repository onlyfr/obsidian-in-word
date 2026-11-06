Focus-NativeTestDocument
if(-not $doc.Redo($nativeUndoSteps)){throw 'Native transition redo failed.'}
$control=@($doc.ContentControls|Where-Object{$_.Tag -like 'owb-body:v1:input-a:*'})[0]
@{Tag=$control.Tag;Text=$control.Range.Text;Paragraphs=$doc.Paragraphs.Count}
