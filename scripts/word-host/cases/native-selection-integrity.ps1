$owners=@(Get-NativeOwners)
if($owners.Count -ne 2){throw "Unexpected ownership count: $($owners.Count)"}
if($doc.ContentControls.Count -ne 3){throw "Unexpected control count: $($doc.ContentControls.Count)"}
if($foreignSelectionControl.Tag -ne 'another-addin-owned' -or $foreignSelectionControl.Range.Text -ne 'Foreign carrier.'){throw 'Foreign control was changed.'}
if($doc.Paragraphs.Count -ne $selectionParagraphCount){throw 'Selection flow changed paragraph count.'}
@{Owners=$owners;Controls=$doc.ContentControls.Count;Paragraphs=$doc.Paragraphs.Count;ForeignId=$foreignSelectionControl.ID}
