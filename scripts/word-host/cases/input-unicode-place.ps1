$find=$doc.Content.Duplicate
$find.Find.MatchWildcards=$false
if(-not $find.Find.Execute(([string][char]0xD55C)+([string][char]0xAE00))){throw 'Korean text missing.'}
$doc.Range($find.Start+1,$find.Start+1).Select()
@{Start=$wordTestApp.Selection.Start;End=$wordTestApp.Selection.End}
