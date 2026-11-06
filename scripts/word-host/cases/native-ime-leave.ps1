$found=$doc.Content.Duplicate
$found.Find.MatchWildcards=$false
if(-not $found.Find.Execute('Outside caret target.')){throw 'Outside paragraph missing.'}
$at=$found.Start+4
$doc.Range($at,$at).Select()
@{Start=$wordTestApp.Selection.Start;End=$wordTestApp.Selection.End}
