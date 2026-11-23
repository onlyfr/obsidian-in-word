if(-not $doc.Undo(1)){throw 'Undo unavailable'}
if(-not $doc.Content.Text.Contains('Start fixture') -or $doc.Content.Text.Contains('Edited fixture')){throw 'One Undo did not restore original paragraph'}
if($doc.Tables.Count -ne 1 -or $doc.Shapes.Count -ne 1 -or $doc.Tables.Item(1).Range.InlineShapes.Count -lt 1){throw 'Missing preserved object'}
@{UndoSteps=1; Tables=$doc.Tables.Count; Shapes=$doc.Shapes.Count}
