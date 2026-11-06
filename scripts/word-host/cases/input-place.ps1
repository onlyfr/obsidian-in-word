$control=@($doc.ContentControls|Where-Object{$_.Tag -eq 'owb-body:v1:input-a:rendered'})[0]
$found=$doc.Content.Duplicate
$found.Find.MatchWildcards=$false
if(-not $found.Find.Execute('bold')){throw 'Bold word missing from test document.'}
$at=$found.Start+2
$doc.Range($at,$at).Select()
if($env:WORD_BODY_NATIVE_MODE -eq '1'){$script:nativeFlowBaseline=@($doc.Paragraphs|ForEach-Object{$_.Range.Text})}
@{Start=$wordTestApp.Selection.Start;End=$wordTestApp.Selection.End;Text=$control.Range.Text}
