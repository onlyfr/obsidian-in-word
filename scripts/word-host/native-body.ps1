# Fixed development host operations only. This worker never executes request-supplied PowerShell or performs body writes itself.
$nativeBodyNamespace='urn:obsidian-in-word:body-edit:v1'
function Focus-NativeTestDocument {
 # Explicit test setup only. RPC requests never activate a window or steal user focus.
 $doc.Activate();$wordTestApp.ActiveWindow.ActivePane.Activate()
 $focusShell=New-Object -ComObject WScript.Shell
 [void]$focusShell.AppActivate('acceptance.docx - Word')
 [WordInputProbe]::Focus([IntPtr]$wordTestApp.ActiveWindow.Hwnd)
}
function Assert-NativeBodyKey([string]$Key) {
 if($Key -notmatch '^[a-zA-Z0-9-]{1,64}$'){throw 'Invalid native body key.'}
}
function Get-NativeBodySnapshot([string]$Key) {
 Assert-NativeBodyKey $Key
 $controls=@($doc.ContentControls|Where-Object{$_.Tag -eq "owb-body:v1:${Key}:source" -or $_.Tag -eq "owb-body:v1:${Key}:rendered"})
 if($controls.Count -gt 1){throw 'Duplicate native body key.'}
 if($controls.Count -eq 0){return $null}
 $control=$controls[0];$range=$control.Range.Duplicate
 if($range.Text.EndsWith("`r")){$range.End=$range.End-1}
 if($range.StoryType -ne 1 -or $range.Paragraphs.Count -ne 1){throw 'Native host supports one main-story paragraph.'}
 $selection=$wordTestApp.Selection.Range
 if($selection.StoryType -ne 1){throw 'Selection is outside the main story.'}
 @{key=$Key;epoch=$nativeImeEpoch;mode=($control.Tag -split ':')[-1];id=[string]$control.ID;text=$range.Text;style=$range.Paragraphs.Item(1).Style.NameLocal;xml=$range.WordOpenXML;start=$range.Start;selectionStart=$selection.Start;selectionEnd=$selection.End}
}
function Get-NativeJournalParts {
 $seen=@{}
 foreach($part in $doc.CustomXMLParts.SelectByNamespace($nativeBodyNamespace)){
  $xml=New-Object Xml.XmlDocument;$xml.XmlResolver=$null;$xml.LoadXml($part.XML)
  $rootNode=$xml.DocumentElement
  if($rootNode.LocalName -ne 'bodyEdit' -or $rootNode.NamespaceURI -ne $nativeBodyNamespace){throw 'Invalid body journal root.'}
  $data=[Uri]::UnescapeDataString($rootNode.InnerText)|ConvertFrom-Json
  Assert-NativeBodyKey $data.key
  if($data.version -ne 1 -or $data.phase -notin @('opening','editing','closing','closed') -or $data.originalMarkdown -isnot [string] -or $data.originalRevision -isnot [string] -or $data.originalStyle -isnot [string]){throw 'Invalid body journal.'}
  if($data.originalMarkdown.Length -gt 4000 -or ($data.nativeStage -and $data.nativeStage -notin @('prepared','content','tagged'))){throw 'Invalid native journal payload.'}
  if($seen.ContainsKey($data.key)){throw 'Duplicate body journal.'};$seen[$data.key]=$true
  $keyAttribute=$rootNode.GetAttribute('key')
  if($keyAttribute -and $keyAttribute -ne $data.key){throw 'Body journal key mismatch.'}
  $stage=$rootNode.GetAttribute('nativeStage')
  if($stage){if($stage -notin @('prepared','content','tagged')){throw 'Invalid native journal stage.'};$data|Add-Member -NotePropertyName nativeStage -NotePropertyValue $stage -Force}
  @{id=$part.Id;xml=$part.XML;data=$data}
 }
}
function Write-NativeFixedString($Writer,[string]$Value,[int]$Size) {
 if($Value.Length -ge $Size){throw 'Native transition exceeds protocol buffer.'}
 $bytes=New-Object byte[] ($Size*2);[Text.Encoding]::Unicode.GetBytes($Value).CopyTo($bytes,0);$Writer.Write($bytes)
}
function Invoke-NativeBodyRequest($Job) {
 if($doc.FullName -ne (Join-Path $root 'acceptance.docx')){throw 'Native host document identity changed.'}
 switch($Job.op){
  'read' {return Get-NativeBodySnapshot $Job.key}
  'journals' {return ,@(Get-NativeJournalParts|ForEach-Object{$_.data})}
  'transition' {
   $change=$Job.change;$expected=$change.expected;Assert-NativeBodyKey $expected.key
   if($expected.epoch -ne $nativeImeEpoch){return @{code=21}}
   if($expected.mode -notin @('source','rendered') -or $change.mode -notin @('source','rendered','journal')){throw 'Invalid transition mode.'}
   $record=@(Get-NativeJournalParts|Where-Object{$_.data.key -eq $expected.key})
   $partId='';$previous='';if($record.Count){$partId=$record[0].id;$previous=$record[0].xml}
   $packet=Join-Path $root ('transition-'+[Guid]::NewGuid().ToString('N')+'.bin')
   $stream=[IO.File]::Open($packet,[IO.FileMode]::CreateNew);$writer=New-Object IO.BinaryWriter($stream)
   try{
    $writer.Write([int]0);$writer.Write([int]0)
    Write-NativeFixedString $writer "owb-body:v1:$($expected.key):$($expected.mode)" 128
    Write-NativeFixedString $writer $expected.id 32
    Write-NativeFixedString $writer $expected.text 4001
    Write-NativeFixedString $writer $change.text 4001
    Write-NativeFixedString $writer $expected.xml 262144
    $mode=@{source=1;rendered=2;journal=3}[$change.mode]
    foreach($number in @(1,$mode,$expected.selectionStart,$expected.selectionEnd,$change.caretStart,$change.caretEnd,$Job.failAt)){$writer.Write([int]$number)}
    Write-NativeFixedString $writer $change.style 256
    Write-NativeFixedString $writer $partId 128
    Write-NativeFixedString $writer $previous 262144
    Write-NativeFixedString $writer $change.pending 262144
    Write-NativeFixedString $writer $change.complete 262144
    Write-NativeFixedString $writer $change.xml 262144
   }finally{$writer.Dispose();$stream.Dispose()}
   return @{code=(Invoke-NativeWritePacket $packet -Epoch $expected.epoch -KeepUnfocused -BodyTransition)}
  }
  default {throw 'Unsupported native body operation.'}
 }
}
