Focus-NativeTestDocument
$control=@($doc.ContentControls|Where-Object{$_.Tag -eq 'owb-body:v1:input-a:source'})[0]
if(-not $control){throw 'Native source block missing.'}
$control.Range.Text='Alpha **edited** / _more_ / ~~strike~~ tail'
$found=$doc.Content.Duplicate;$found.Find.MatchWildcards=$false
if(-not $found.Find.Execute('Outside caret target.')){throw 'Outside paragraph missing.'}
$doc.Range($found.Start+4,$found.Start+4).Select()
@{Source=$control.Range.Text;Start=$wordTestApp.Selection.Start}
