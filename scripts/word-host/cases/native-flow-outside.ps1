Focus-NativeTestDocument
$found=$doc.Content.Duplicate;$found.Find.MatchWildcards=$false
if(-not $found.Find.Execute('Outside caret target.')){throw 'Outside paragraph missing.'}
$doc.Range($found.Start+4,$found.Start+4).Select()
$true
