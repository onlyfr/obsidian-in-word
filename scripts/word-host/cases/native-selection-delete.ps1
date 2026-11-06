Focus-NativeTestDocument
$script:deletedSelectionId=[string](Get-NativeOwnedControl 'owned-b').ID
(Get-NativeOwnedControl 'owned-b').Delete($false)
$true
