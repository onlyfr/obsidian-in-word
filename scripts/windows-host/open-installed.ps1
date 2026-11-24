param([Parameter(Mandatory)][long]$WindowHandle,[switch]$CheckEditor)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$root=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
function Named($root,$name) {
    $condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)
    $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
}
if($CheckEditor){
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    do {
        $pane=Named $root 'Obsidian in Word (Windows)' | Where-Object {!$_.Current.IsOffscreen}
        if($pane -and (Named $root '작업창 옵션')){return}
        Start-Sleep -Milliseconds 250
    } while([DateTime]::UtcNow -lt $deadline)
    throw 'The installed Word task pane was not visible.'
}
function Open-Ribbon {
    foreach($button in (Named $root 'Obsidian in Word')){
        $invoke=$null
        if($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){
            $invoke.Invoke()
            return $true
        }
    }
    return $false
}
if(Open-Ribbon){return}
# Word exposes locally sideloaded web commands after the add-in is selected in this document.
$menu=$root.FindFirst(4,[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,'OfficeExtensionsShowAddinFlyout'))
$toggle=$menu.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
if($toggle.Current.ToggleState -ne 'On'){$toggle.Toggle()}
$deadline=[DateTime]::UtcNow.AddSeconds(12)
do {
    $entry=Named ([System.Windows.Automation.AutomationElement]::RootElement) 'Obsidian in Word (Windows)' |
        Where-Object {$_.Current.ProcessId -eq $root.Current.ProcessId -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem} | Select-Object -First 1
    if($entry){break}
    Start-Sleep -Milliseconds 150
} while([DateTime]::UtcNow -lt $deadline)
if(!$entry){throw 'Windows add-in was not listed in this document.'}
$entry.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
$entry.SetFocus()
if(![System.Windows.Automation.Automation]::Compare([System.Windows.Automation.AutomationElement]::FocusedElement,$entry)){throw 'Selection moved before opening the add-in.'}
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
$deadline=[DateTime]::UtcNow.AddSeconds(15)
do {
    Start-Sleep -Milliseconds 200
    if(Open-Ribbon){return}
} while([DateTime]::UtcNow -lt $deadline)
throw 'Home command did not appear after adding the task pane.'
