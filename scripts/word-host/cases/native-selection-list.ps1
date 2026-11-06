Focus-NativeTestDocument
$range=$doc.Content.Duplicate;$range.Find.MatchWildcards=$false
if(-not $range.Find.Execute('List carrier.')){throw 'List target missing.'}
$range.ListFormat.ApplyBulletDefault()
if($range.ListFormat.ListType -eq 0){throw 'List fixture did not acquire bullets.'}
$doc.Range($range.Start+2,$range.Start+2).Select()
$true
