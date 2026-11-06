$control=$doc.SelectContentControlsByTag('owb-body-source-probe').Item(1)
$position=$control.Range.Start+3
$doc.Range($position,$position).Select()
@{Id=$control.ID;Text=$control.Range.Text;Start=$control.Range.Start;End=$control.Range.End}
