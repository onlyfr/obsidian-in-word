Focus-NativeTestDocument
if(-not $doc.Redo(1) -or $doc.Content.Text -ne $checkEditedText){throw 'Read-only check lost Word Redo.'}
@{Redo=$true;Text=$doc.Content.Text}
