$ok=$doc.Undo(1)
if(-not $ok){throw 'Expected one native undo step.'}
@{Undo=$ok;Text=$doc.Content.Text;Tags=@($doc.ContentControls|ForEach-Object{$_.Tag})}
