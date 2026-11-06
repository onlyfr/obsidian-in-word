$ok=$doc.Redo(1)
if(-not $ok){throw 'Redo stack was lost.'}
@{Redo=$ok;Text=$doc.Content.Text}
