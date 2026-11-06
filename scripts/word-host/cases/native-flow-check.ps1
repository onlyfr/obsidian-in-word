$control=@($doc.ContentControls|Where-Object{$_.Tag -eq 'owb-body:v1:input-a:rendered'})[0]
if(-not $control -or $control.Range.Paragraphs.Count -ne 1){throw 'Native render changed control/paragraph ownership.'}
if($doc.Paragraphs.Count -ne $nativeFlowBaseline.Count){throw "Native render changed paragraph count: $($nativeFlowBaseline.Count) -> $($doc.Paragraphs.Count)"}
$outside=$doc.Content.Duplicate;$outside.Find.MatchWildcards=$false
if(-not $outside.Find.Execute('Outside caret target.')){throw 'Outside paragraph missing.'}
for($i=1;$i -lt $nativeFlowBaseline.Count;$i++){if($doc.Paragraphs.Item($i+1).Range.Text -ne $nativeFlowBaseline[$i]){throw 'Native transition changed a neighboring paragraph.'}}
$relative=$wordTestApp.Selection.Start-$outside.Start
if($relative -ne 4 -or $wordTestApp.Selection.End -ne $wordTestApp.Selection.Start){throw "Native render moved outside cursor: $relative"}
@{Paragraphs=$doc.Paragraphs.Count;Caret=$relative;Tables=$doc.Tables.Count;Controls=$doc.ContentControls.Count}
