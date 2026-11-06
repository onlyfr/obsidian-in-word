if(-not ('WordInputProbe' -as [type])){Add-Type -Path (Join-Path $wordHarnessScripts 'native-input.cs')}
Focus-NativeTestDocument
$found=$doc.Content.Duplicate;$found.Find.MatchWildcards=$false
if(-not $found.Find.Execute('bold')){throw 'First selection target missing.'}
$doc.Range($found.Start+2,$found.Start+2).Select()
$script:selectionParagraphCount=$doc.Paragraphs.Count
$true
