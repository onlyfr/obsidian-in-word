Focus-NativeTestDocument
$range=$doc.Content.Duplicate;$range.Find.MatchWildcards=$false
if(-not $range.Find.Execute('Colored carrier.')){throw 'Colored target missing.'}
$range.HighlightColorIndex=7 # Highlight remains unsupported; concrete color is now preserved.
$doc.Range($range.Start+2,$range.Start+2).Select()
$true
