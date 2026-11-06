Focus-NativeTestDocument
$first=@($doc.ContentControls|Where-Object{$_.Tag -like 'owb-body:v1:owned-a:*'})[0]
$second=@($doc.ContentControls|Where-Object{$_.Tag -like 'owb-body:v1:owned-b:*'})[0]
foreach($target in @($first,$second,$first,$second)){$doc.Range($target.Range.Start+1,$target.Range.Start+1).Select()}
@{Final=$wordTestApp.Selection.Start}
