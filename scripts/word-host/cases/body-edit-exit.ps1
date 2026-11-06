$source=$doc.Content.Duplicate
$source.Find.MatchWildcards=$false
$found=$source.Find.Execute('Probe target with **bold** text.')
if(-not $found){throw 'Expected markdown source was not found in Word body.'}
$source.Text='Probe **edited** and _more_.'
$doc.Paragraphs.Last.Range.Select()
@{Found=$found;Controls=$doc.SelectContentControlsByTag('owb-body-source-probe').Count}
