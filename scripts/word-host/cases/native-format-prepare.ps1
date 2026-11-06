if(-not ('WordInputProbe' -as [type])){Add-Type -Path (Join-Path $wordHarnessScripts 'native-input.cs')}
Focus-NativeTestDocument
$range=$doc.Paragraphs.Item(1).Range.Duplicate;$range.End=$range.End-1
$range.Font.NameAscii='Cambria';$range.Font.NameOther='Cambria';$range.Font.NameFarEast='맑은 고딕';$range.Font.NameBi='Arial'
$range.Font.Size=12.5;$range.Font.SizeBi=13
$red=$range.Duplicate;if(-not $red.Find.Execute('redWord')){throw 'Red target missing.'}
$red.Font.Bold=-1;$red.Font.Color=255;$red.Font.Size=16
$blue=$range.Duplicate;if(-not $blue.Find.Execute('blueTail')){throw 'Blue target missing.'}
$blue.Font.Color=16711680
$script:formatParagraphCount=$doc.Paragraphs.Count
$script:formatRedText='redWord'
$script:formatBaseline=@{}
function script:Get-FormatProbe([string]$Text){
 $probe=$doc.Content.Duplicate;$probe.Find.MatchWildcards=$false
 if(-not $probe.Find.Execute($Text)){throw "Format target missing: $Text"}
 $font=$probe.Font
 @{Ascii=$font.NameAscii;HAnsi=$font.NameOther;EastAsia=$font.NameFarEast;Cs=$font.NameBi;Size=$font.Size;SizeCs=$font.SizeBi;Color=$font.Color;Bold=$font.Bold}
}
foreach($text in @('Start','redWord','blueTail')){$formatBaseline[$text]=Get-FormatProbe $text}
$doc.Range($red.Start+2,$red.Start+2).Select()
@{Baseline=$formatBaseline;Paragraphs=$formatParagraphCount}
