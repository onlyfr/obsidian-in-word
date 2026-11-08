import { describe, expect, it } from "vitest";
import { askConfirm } from "../src/taskpane/confirm";

describe("askConfirm (window.confirm is unsupported in Word's task pane)", () => {
  it("resolves true on the yes button and removes itself", async () => {
    const host = document.createElement("div");
    const p = askConfirm(host, "run <b>this</b>?");
    expect(host.querySelector(".inline-confirm p")!.textContent).toBe("run <b>this</b>?");
    expect(host.querySelector("b")).toBeNull(); // text, not HTML
    (host.querySelector("#inline-confirm-yes") as HTMLButtonElement).click();
    expect(await p).toBe(true);
    expect(host.querySelector(".inline-confirm")).toBeNull();
  });
  it("resolves false on cancel", async () => {
    const host = document.createElement("div");
    const p = askConfirm(host, "x");
    (host.querySelector("#inline-confirm-no") as HTMLButtonElement).click();
    expect(await p).toBe(false);
  });
  it('cancels a pending plugin replacement when its settings dialog closes',async()=>{
    const dialog=document.createElement('dialog'),host=document.createElement('div');dialog.append(host);dialog.setAttribute('open','');
    const pending=askConfirm(host,'replace downloaded version?');dialog.removeAttribute('open');dialog.dispatchEvent(new Event('close'));
    expect(await pending).toBe(false);expect(host.querySelector('.inline-confirm')).toBeNull();
    expect(await askConfirm(host,'already closed')).toBe(false);expect(host.children).toHaveLength(0);
  });
});
