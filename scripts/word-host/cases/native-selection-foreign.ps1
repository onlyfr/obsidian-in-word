Focus-NativeTestDocument
$range=$doc.Content.Duplicate;$range.Find.MatchWildcards=$false
if(-not $range.Find.Execute('Foreign carrier.')){throw 'Foreign target missing.'}
$script:foreignSelectionControl=$doc.ContentControls.Add(0,$range)
$foreignSelectionControl.Tag='another-addin-owned';$foreignSelectionControl.Title='Foreign control'
$doc.Range($foreignSelectionControl.Range.Start+2,$foreignSelectionControl.Range.Start+2).Select()
@{ForeignId=$foreignSelectionControl.ID;Text=$foreignSelectionControl.Range.Text}
