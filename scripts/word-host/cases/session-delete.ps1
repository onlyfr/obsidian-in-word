$a=@($doc.ContentControls|Where-Object{$_.Tag -like 'owb-body:v1:session-a:*'})
if($a.Count -ne 1){throw 'Expected one owned test control.'}
$a[0].Delete($true)
@{Controls=$doc.ContentControls.Count;Text=$doc.Content.Text}
