$control=@($doc.ContentControls|Where-Object{$_.Tag -eq 'owb-body:v1:input-a:rendered'})[0]
$found=$doc.Content.Duplicate
$found.Find.MatchWildcards=$false
if(-not $found.Find.Execute('bold')){throw 'Bold word missing from test document.'}
$at=$found.Start+2
$doc.Range($at,$at).Select()
@{Start=$wordTestApp.Selection.Start;End=$wordTestApp.Selection.End;Text=$control.Range.Text}
