$steps = @()
$restored = $false
for($i=1;$i -le 8;$i++){
 $undone = $doc.Undo(1)
 $restored = ($doc.Content.Text -ceq $undoBaselineText) -and ($doc.Tables.Count -eq $undoBaselineTables) -and ($doc.Shapes.Count -eq $undoBaselineShapes) -and ($doc.OMaths.Count -eq $undoBaselineMath)
 $steps += @{Step=$i;Undo=$undone;Paragraphs=$doc.Paragraphs.Count;Tables=$doc.Tables.Count;Shapes=$doc.Shapes.Count;Equations=$doc.OMaths.Count;Restored=$restored}
 if($restored -or -not $undone){break}
}
if(-not $restored){throw ('Undo failed to restore baseline: '+($steps|ConvertTo-Json -Compress))}
@{Steps=$steps;Restored=$restored}
