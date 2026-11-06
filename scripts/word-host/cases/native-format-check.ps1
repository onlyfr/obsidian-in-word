foreach($name in @('Start','redWord','blueTail')){
 $target=if($name -eq 'redWord'){$formatRedText}else{$name}
 $actual=Get-FormatProbe $target;$expected=$formatBaseline[$name]
 foreach($property in $expected.Keys){if($actual[$property] -ne $expected[$property]){throw "Typography mismatch for $target / ${property}: expected=$($expected[$property]) actual=$($actual[$property])"}}
}
if($doc.Paragraphs.Count -ne $formatParagraphCount -or $doc.Paragraphs.Item(2).Range.Text.TrimEnd("`r") -ne 'Outside plain.'){throw 'Typography transition changed neighbors/paragraph count.'}
@{Red=Get-FormatProbe $formatRedText;Blue=Get-FormatProbe 'blueTail';Paragraphs=$doc.Paragraphs.Count}
