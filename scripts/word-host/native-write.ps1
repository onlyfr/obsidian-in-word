function New-NativeWritePacket($Control,[string]$Replacement,$ExpectedText=$null,$ExpectedXml=$null,[string]$ControlId=$null,[int]$Sequence=0) {
 if($null -eq $ExpectedText){$ExpectedText=$Control.Range.Text}
 if($null -eq $ExpectedXml){$ExpectedXml=$Control.Range.WordOpenXML}
 if(-not $ControlId){$ControlId=$Control.ID}
 $path=Join-Path $root ('write-'+[Guid]::NewGuid().ToString('N')+'.bin')
 $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew)
 $writer=New-Object IO.BinaryWriter($stream)
 try{
  $writer.Write([int]$Sequence);$writer.Write([int]0)
  foreach($field in @(@($Control.Tag,128),@($ControlId,32),@($ExpectedText,4001),@($Replacement,4001),@($ExpectedXml,262144))){
   $value=[string]$field[0];$size=[int]$field[1]
   if($value.Length -ge $size){throw 'Native source request exceeds the fixed protocol limit.'}
   $bytes=New-Object byte[] ($size*2)
   [Text.Encoding]::Unicode.GetBytes($value).CopyTo($bytes,0)
   $writer.Write($bytes)
  }
 }finally{$writer.Dispose();$stream.Dispose()}
 return $path
}
function Invoke-NativeWritePacket([string]$Packet,[string]$Epoch=(Split-Path $root -Leaf),[switch]$KeepUnfocused) {
 $handle=[IntPtr]$wordTestApp.ActiveWindow.Hwnd
 if(-not $KeepUnfocused){
  $doc.Activate();$wordTestApp.ActiveWindow.ActivePane.Activate()
  $focusShell=New-Object -ComObject WScript.Shell
  [void]$focusShell.AppActivate('acceptance.docx - Word')
  [WordInputProbe]::Focus($handle)
 }
 $wordProcessId=[WordInputProbe]::ProcessId($handle)
 $start=New-Object Diagnostics.ProcessStartInfo
 $start.FileName=$env:WORD_IME_BRIDGE_EXE
 $start.Arguments='--write-source '+$wordProcessId+' '+$Epoch+' "'+$Packet+'"'
 $start.UseShellExecute=$false;$start.CreateNoWindow=$true
 $process=[Diagnostics.Process]::Start($start)
 if(-not $process.WaitForExit(5000)){throw 'Native source write outcome unknown; do not retry.'}
 return $process.ExitCode
}
