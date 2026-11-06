$path=$doc.FullName
$doc.Save()
$doc.Close(0)
$script:doc=Invoke-WordSetup {
 $existing=@($wordTestApp.Documents|Where-Object{$_.FullName -eq $path})
 if($existing.Count -eq 1){return $existing[0]}
 $wordTestApp.Documents.Open($path)
}
Invoke-WordSetup {$doc.Activate()}
@{Reopened=$doc.FullName;Controls=$doc.ContentControls.Count}
