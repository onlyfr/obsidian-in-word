Focus-NativeTestDocument
if(-not $doc.Redo($checkFaultUndo)){throw 'Status check destroyed partial-transition Redo.'}
if($doc.Content.Text -ne $checkFaultText -or (Get-NativeOwnedControl $checkKey).Tag -ne $checkFaultTag){throw 'Redo did not restore partial-transition state.'}
@{Redo=$true;Steps=$checkFaultUndo;Tag=$checkFaultTag}
