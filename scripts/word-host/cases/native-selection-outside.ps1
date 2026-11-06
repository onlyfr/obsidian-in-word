Focus-NativeTestDocument
$found=$doc.Content.Duplicate;$found.Find.MatchWildcards=$false
if(-not $found.Find.Execute('Outside plain.')){throw 'Outside target missing.'}
$doc.Range($found.Start+3,$found.Start+3).Select()
$true
