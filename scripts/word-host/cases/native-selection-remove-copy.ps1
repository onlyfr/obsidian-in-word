$copiedSelectionControl.Delete($false)
if((Get-NativeOwnedControl 'owned-a').Range.Text.TrimEnd("`r") -ne 'First bold end.'){throw 'Conflict test changed owned text.'}
if($doc.Content.Text -notmatch 'Copy carrier\.'){throw 'Removing the fixture control removed its text.'}
$true
