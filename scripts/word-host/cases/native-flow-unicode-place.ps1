Focus-NativeTestDocument
$found=$doc.Content.Duplicate;$found.Find.MatchWildcards=$false
if(-not $found.Find.Execute('한글')){throw 'Native Korean text missing.'}
$doc.Range($found.Start+1,$found.Start+1).Select()
$true
