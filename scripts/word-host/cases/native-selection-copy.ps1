$ownerIdentityNode.Text=$ownerOriginalId
Focus-NativeTestDocument
$range=$doc.Content.Duplicate;$range.Find.MatchWildcards=$false
if(-not $range.Find.Execute('Copy carrier.')){throw 'Copy target missing.'}
$script:copiedSelectionControl=$doc.ContentControls.Add(0,$range)
$copiedSelectionControl.Tag='owb-body:v1:owned-a:rendered'
$true
