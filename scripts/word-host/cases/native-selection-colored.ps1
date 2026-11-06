Focus-NativeTestDocument
$range=$doc.Content.Duplicate;$range.Find.MatchWildcards=$false
if(-not $range.Find.Execute('Colored carrier.')){throw 'Colored target missing.'}
$doc.Range($range.Start+2,$range.Start+2).Select()
$true
