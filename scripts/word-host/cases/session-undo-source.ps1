$steps=@()
for($i=0;$i -lt 1;$i++){$ok=$doc.Undo(1);if(-not $ok){throw 'Undo could not return to source.'};$steps+=@{Step=$i+1;Text=$doc.Content.Text;Tags=@($doc.ContentControls|ForEach-Object{$_.Tag})}}
$steps
