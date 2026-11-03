import { describe, expect, it } from "vitest";
import { MathRenderer, sanitizeMathML } from "../src/plugins/math";
import { PluginHost, MATH_FALLBACK_WARNING } from "../src/plugins/host";
import * as realTemml from "temml";

const real = { temml: async () => (realTemml as any).default, css: async () => "math{font-family:serif}@font-face{font-family:'Temml';src:url('Temml.woff2')}" };
const ready = async (max?: number) => {
  const r = new MathRenderer(real, max);
  expect(await r.load()).toBe(true);
  return r;
};

describe("renderMath contract", () => {
  it("inline: span.math.math-inline.is-loaded containing <math>", async () => {
    const r = await ready();
    const el = r.render("x^2", false);
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("math math-inline is-loaded");
    expect(el.querySelector("math")).not.toBeNull();
    expect(el.querySelector("msup")).not.toBeNull();
  });

  it("display: div.math.math-block with display=block", async () => {
    const r = await ready();
    const el = r.render(String.raw`\sum_{i=1}^n x`, true);
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains("math-block")).toBe(true);
    expect(el.querySelector("math")!.getAttribute("display")).toBe("block");
    expect(el.querySelector("munderover")).not.toBeNull();
  });

  it("renders fractions, matrices, text, roots, delimiters, environments", async () => {
    const r = await ready();
    const q = (s: string, sel: string) => expect(r.render(s, false).querySelector(sel), s).not.toBeNull();
    q(String.raw`\frac{a}{b}`, "mfrac");
    q(String.raw`\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}`, "mtable");
    q(String.raw`\text{if } x`, "mtext");
    q(String.raw`\sqrt[3]{x}`, "mroot");
    q(String.raw`\left( \frac{a}{b} \right)`, "mfrac");
    q(String.raw`\begin{cases} x & x>0 \\ -x & x\le 0 \end{cases}`, "mtable");
    q(String.raw`\begin{aligned} a &= b \\ c &= d \end{aligned}`, "mtable");
  });

  it("supports the \\class marker plugins use for cursor/highlight, and nothing else untrusted", async () => {
    const r = await ready();
    const el = r.render(String.raw`a \class{mjx-cursor}{} b`, false);
    expect(el.querySelector(".mjx-cursor")).not.toBeNull();
    for (const bad of [String.raw`\href{javascript:alert(1)}{x}`, String.raw`\class{a b"onload=x}{y}`, String.raw`\includegraphics{x}`]) {
      const e = r.render(bad, false);
      expect(e.classList.contains("math-error"), bad).toBe(true);
      expect(e.querySelector("a, script, img")).toBeNull();
    }
  });

  it("never throws: a parse error renders the source with math-error and the message as title", async () => {
    const r = await ready();
    const el = r.render(String.raw`\frac{a`, false);
    expect(el.classList.contains("math-error")).toBe(true);
    expect(el.textContent).toBe(String.raw`\frac{a`);
    expect(el.title.length).toBeGreaterThan(0);
    expect(r.render("", false)).toBeInstanceOf(HTMLElement);
  });

  it("is safe: output only has MathML elements/attributes", async () => {
    const r = await ready();
    const el = r.render(String.raw`\text{<img src=x onerror=alert(1)>} \unicode{x}`, false);
    expect(el.querySelector("img")).toBeNull();
    expect(el.innerHTML).not.toMatch(/onerror=(?!.*&)/);
    const dirty = sanitizeMathML(`<math onclick="x()"><mi style="color:red;background:url(javascript:x)">a</mi><script>alert(1)</script><mtext><a href="javascript:x">l</a></mtext></math><img src=x>`);
    expect(dirty).not.toMatch(/script|onclick|url\(|<a |<img/i);
    expect(dirty).toContain("color:red");
  });

  it("caches by source+display, bounded", async () => {
    const r = await ready(3);
    r.render("a", false);
    r.render("a", false);
    expect(r.cacheSize).toBe(1);
    r.render("a", true);
    expect(r.cacheSize).toBe(2);
    for (const s of ["b", "c", "d", "e"]) r.render(s, false);
    expect(r.cacheSize).toBe(3);
    // every call returns a fresh element even when cached
    expect(r.render("e", false)).not.toBe(r.render("e", false));
  });

  it("injects the stylesheet once, without the font fetch", async () => {
    await ready();
    await ready();
    const styles = document.querySelectorAll("#owb-temml-css");
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain("font-family:serif");
    expect(styles[0].textContent).not.toContain("woff2");
  });
});

describe("lazy-load failure falls back to source text", () => {
  const failing = { temml: async () => { throw new Error("chunk blocked"); }, css: async () => "" };

  it("shows the source as text and reports the status", async () => {
    const r = new MathRenderer(failing);
    const before = r.render("x^2", false); // not loaded yet: text
    expect(before.textContent).toBe("x^2");
    expect(await r.load()).toBe(false);
    expect(r.status).toBe("fallback");
    expect(r.error).toBe("chunk blocked");
    const el = r.render("x^2", false);
    expect(el.textContent).toBe("x^2");
    expect(el.classList.contains("is-loaded")).toBe(false);
  });

  it("can retry after a failure", async () => {
    let fail = true;
    const r = new MathRenderer({ temml: async () => { if (fail) throw new Error("x"); return (realTemml as any).default; }, css: async () => "" });
    expect(await r.load()).toBe(false);
    fail = false;
    expect(await r.load()).toBe(true);
    expect(r.render("x", false).classList.contains("is-loaded")).toBe(true);
  });

  it("a plugin calling loadMathJax gets a compat-report warning when the renderer is unavailable", async () => {
    const { mathRenderer } = await import("../src/plugins/math");
    const saved = (mathRenderer as any).importer;
    (mathRenderer as any).importer = failing;
    mathRenderer.status = "idle";
    (mathRenderer as any).loading = null;
    try {
      const host = new PluginHost();
      await host.load({ id: "m", name: "M" } as any, `module.exports = class extends require("obsidian").Plugin { async onload() { await require("obsidian").loadMathJax(); } };`);
      expect(host.reports.get("m")!.warnings).toEqual([MATH_FALLBACK_WARNING]);
      expect(host.reports.get("m")!.loaded).toBe(true);
    } finally {
      (mathRenderer as any).importer = saved;
      mathRenderer.status = "idle";
      (mathRenderer as any).loading = null;
    }
  });
});
