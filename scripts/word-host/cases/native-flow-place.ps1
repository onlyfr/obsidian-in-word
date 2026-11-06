Focus-NativeTestDocument
$control=@($doc.ContentControls|Where-Object{$_.Tag -eq 'owb-body:v1:input-a:rendered'})[0]
if(-not $control){throw 'Rendered native block missing.'}
$range=$control.Range.Duplicate;$range.Find.MatchWildcards=$false
if(-not $range.Find.Execute('edited')){throw 'Edited text missing.'}
$doc.Range($range.Start+1,$range.Start+4).Select()
@{Text=$wordTestApp.Selection.Text;Start=$wordTestApp.Selection.Start;End=$wordTestApp.Selection.End}
