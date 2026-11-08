Focus-NativeTestDocument
$owners=@(Get-NativeOwners);if($owners.Count -ne 1){throw 'Expected one test owner.'}
$script:checkKey=$owners[0].key;$control=Get-NativeOwnedControl $checkKey
$script:checkOriginalText=$doc.Content.Text
$range=$control.Range.Duplicate;$range.SetRange($range.Start+1,$range.Start+1);$range.Text='X'
$script:checkEditedText=$doc.Content.Text
if($checkOriginalText -eq $checkEditedText){throw 'Test insertion did not change text.'}
if(-not $doc.Undo(1) -or $doc.Content.Text -ne $checkOriginalText){throw 'Word Undo did not restore text.'}
$control=Get-NativeOwnedControl $checkKey
$doc.Range($control.Range.Start+3,$control.Range.Start+3).Select()
@{Undo=$true;Text=$doc.Content.Text}
