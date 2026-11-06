$find=$doc.Content.Duplicate
$find.Find.MatchWildcards=$false
if(-not $find.Find.Execute('bo')){throw 'Typed bold span missing.'}
$doc.Range($find.Start+1,$find.Start+2).Select()
@{Text=$wordTestApp.Selection.Text;Start=$wordTestApp.Selection.Start;End=$wordTestApp.Selection.End}
