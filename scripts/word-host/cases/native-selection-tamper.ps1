Focus-NativeTestDocument
$script:tamperedOwner=@($doc.CustomXMLParts.SelectByNamespace($nativeOwnerNamespace)|Where-Object{$_.XML -match 'key="owned-a"'})[0]
$script:ownerIdentityNode=$tamperedOwner.DocumentElement.SelectSingleNode('@controlId')
$script:ownerOriginalId=$ownerIdentityNode.Text
$ownerIdentityNode.Text='wrong-control-id'
$control=$doc.SelectContentControlsByTag('owb-body:v1:owned-a:rendered').Item(1)
$range=$control.Range.Duplicate;if($range.Text.EndsWith("`r")){$range.End=$range.End-1}
@{key='owned-a';epoch=$nativeImeEpoch;mode='rendered';id=[string]$control.ID;text=$range.Text;style=$range.Paragraphs.Item(1).Style.NameLocal;xml=$range.WordOpenXML;start=$range.Start;selectionStart=$wordTestApp.Selection.Start;selectionEnd=$wordTestApp.Selection.End}
