Focus-NativeTestDocument
$control=@($doc.ContentControls|Where-Object{$_.Tag -eq 'owb-body:v1:input-a:source'})[0]
if(-not $control){throw 'Native source block missing.'}
$control.Range.Text='A 😀 **한글** / _기울임_ / ~~취소~~ / `code` 끝'
. (Join-Path $wordHarnessScripts 'cases\native-flow-outside.ps1')|Out-Null
@{Source=$control.Range.Text}
