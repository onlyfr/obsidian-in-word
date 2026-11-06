$anchor = $doc.Content.Duplicate
[void]$anchor.Find.Execute('Float anchor')
$shape = $doc.Shapes.AddShape(1,20,20,100,30,$anchor)
$shape.TextFrame.TextRange.Text = 'Floating preserved'
$shape.WrapFormat.Type = 0
$blank = $doc.Range(0,0)
$blank.InsertParagraphBefore()
$blank.InsertParagraphBefore()
$doc.Content.Select()
@{Paragraphs=$doc.Paragraphs.Count;Tables=$doc.Tables.Count;Shapes=$doc.Shapes.Count;Equations=$doc.OMaths.Count}
