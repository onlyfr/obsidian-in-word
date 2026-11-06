export type SettingsTab="options"|"plugins";

/** Native dialog provides modal focus containment; tabs use roving keyboard focus. */
export function initSettingsDialog(){
  const dialog=document.getElementById("settings-dialog") as HTMLDialogElement;
  const opener=document.getElementById("open-settings") as HTMLButtonElement;
  const tabs:SettingsTab[]=["options","plugins"];
  let selected:SettingsTab="options";
  const button=(tab:SettingsTab)=>document.getElementById(`${tab}-tab`) as HTMLButtonElement;
  const panel=(tab:SettingsTab)=>document.getElementById(tab==="options"?"options-panel":"plugins")!;
  const select=(tab:SettingsTab)=>{
    selected=tab;
    for(const key of tabs){
      button(key).setAttribute("aria-selected",String(key===tab));
      button(key).tabIndex=key===tab?0:-1;
      panel(key).hidden=key!==tab;
    }
  };
  const open=(tab:SettingsTab=selected)=>{
    select(tab);
    if(!dialog.open)dialog.showModal();
    opener.setAttribute("aria-expanded","true");button(tab).focus();
  };
  opener.onclick=()=>open();
  document.getElementById("close-settings")!.onclick=()=>dialog.close();
  dialog.addEventListener("cancel",event=>{event.preventDefault();dialog.close();});
  dialog.addEventListener("close",()=>{opener.setAttribute("aria-expanded","false");opener.focus();});
  for(const tab of tabs){
    button(tab).onclick=()=>select(tab);
    button(tab).onkeydown=event=>{
      let next:SettingsTab;
      if(event.key==="ArrowRight" || event.key==="ArrowLeft")next=tabs[(tabs.indexOf(tab)+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length];
      else if(event.key==="Home")next=tabs[0];
      else if(event.key==="End")next=tabs[tabs.length-1];
      else return;
      event.preventDefault();select(next);button(next).focus();
    };
  }
  select(selected);
  return {open};
}
