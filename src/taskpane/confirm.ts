/**
 * Inline confirmation. Word's task pane (WebView2 / Office add-in sandbox) does not support window.confirm
 * ("Function window.confirm is not supported"), so ask with buttons inside the page instead.
 */
export function askConfirm(parent: HTMLElement, message: string, yes = "계속", no = "취소"): Promise<boolean> {
  const dialog=parent.closest('dialog');
  if(dialog && !dialog.open)return Promise.resolve(false);
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "inline-confirm";
    box.setAttribute("role", "alertdialog");
    const text = document.createElement("p");
    text.textContent = message; // never innerHTML
    const ok = document.createElement("button");
    ok.id = "inline-confirm-yes";
    ok.textContent = yes;
    const cancel = document.createElement("button");
    cancel.id = "inline-confirm-no";
    cancel.textContent = no;
    const done = (v: boolean) => {
      dialog?.removeEventListener('close',closed);
      box.remove();
      resolve(v);
    };
    const closed=()=>done(false);
    dialog?.addEventListener('close',closed,{once:true});
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    box.append(text, ok, cancel);
    parent.prepend(box);
  });
}
