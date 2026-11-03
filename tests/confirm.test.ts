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
});
