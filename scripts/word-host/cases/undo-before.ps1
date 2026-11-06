$doc.UndoClear()
$global:undoBaselineText = $doc.Content.Text
$global:undoBaselineTables = $doc.Tables.Count
$global:undoBaselineShapes = $doc.Shapes.Count
$global:undoBaselineMath = $doc.OMaths.Count
@{Paragraphs=$doc.Paragraphs.Count;Tables=$undoBaselineTables;Shapes=$undoBaselineShapes;Equations=$undoBaselineMath;Text=$undoBaselineText}
