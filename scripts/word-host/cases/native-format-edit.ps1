Focus-NativeTestDocument
(Get-NativeOwnedControl 'format-a').Range.Text='Start **redWorks** blueTail.'
$script:formatRedText='redWorks'
. (Join-Path $wordHarnessScripts 'cases\native-selection-outside.ps1')|Out-Null
$true
