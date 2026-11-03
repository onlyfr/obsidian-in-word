/**
 * Facade for Obsidian's `loadMathJax()` / `renderMath()`. The real implementation (Temml + sanitizer + cache) lives
 * in `math-impl` and is only fetched on demand (dynamic import), so the main bundle stays small. Until it is ready,
 * or if it cannot be loaded, the LaTeX source is shown as text. Never throws.
 */
import type { MathRenderer, MathStatus } from "./math-impl";

export class MathFacade {
  status: MathStatus = "idle";
  error?: string;
  private impl: MathRenderer | null = null;
  private loading: Promise<boolean> | null = null;
  /** Overridable for tests. */
  importImpl: () => Promise<typeof import("./math-impl")> = () => import("./math-impl");

  load(): Promise<boolean> {
    if (this.status === "ready") return Promise.resolve(true);
    this.loading ??= (async () => {
      this.status = "loading";
      try {
        const { MathRenderer } = await this.importImpl();
        this.impl ??= new MathRenderer();
        const ok = await this.impl.load();
        this.status = ok ? "ready" : "fallback";
        this.error = ok ? undefined : this.impl.error;
        if (!ok) this.loading = null;
        return ok;
      } catch (e) {
        this.status = "fallback";
        this.error = (e as Error)?.message ?? String(e);
        this.loading = null; // allow a later retry
        return false;
      }
    })();
    return this.loading;
  }

  render(source: string, display: boolean): HTMLElement {
    if (this.impl && this.status === "ready") return this.impl.render(source, display);
    const el = document.createElement(display ? "div" : "span");
    el.className = `math ${display ? "math-block" : "math-inline"}`;
    el.textContent = source;
    void this.load(); // later renders get real math
    return el;
  }
}

export const mathRenderer = new MathFacade();
