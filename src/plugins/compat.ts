/** Obsidian API version this shim claims (for `requireApiVersion`). */
export const API_VERSION = "1.8.0";

const parts = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);

/** Obsidian's `requireApiVersion("x.y.z")`: true if the running API version is at least that. */
export function requireApiVersion(required: string, current = API_VERSION): boolean {
  const a = parts(current);
  const b = parts(required);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return true;
}

/**
 * Obsidian exposes its i18next instance as `window.i18next`; plugins that localize their UI do
 * `window.i18next.createInstance()` at load. A minimal stand-in: no translations, keys come back as written
 * (or the `defaultValue` option).
 */
export function createI18nextShim() {
  const t = (key: string | string[], opts?: { defaultValue?: string }) =>
    opts?.defaultValue ?? (Array.isArray(key) ? key[0] : key);
  const instance: Record<string, unknown> = {
    language: "en",
    languages: ["en"],
    t,
    init: () => Promise.resolve(t),
    getFixedT: () => t,
    exists: () => false,
    changeLanguage: () => Promise.resolve(t),
    addResourceBundle: () => instance,
    on: () => instance,
    off: () => instance,
  };
  instance.createInstance = () => ({ ...instance });
  return instance;
}

/**
 * Obsidian extends built-in prototypes (`String#contains`, `Array#first`, ...) and plugins rely on them.
 * Installed once, non-enumerable, and only where missing.
 */
export function installPrototypeExtensions(): void {
  const def = (proto: object, name: string, fn: (...a: any[]) => unknown) => {
    if (!(name in proto)) Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true, enumerable: false });
  };
  def(String.prototype, "contains", function (this: string, s: string) {
    return this.includes(s);
  });
  def(Array.prototype, "contains", function (this: unknown[], x: unknown) {
    return this.includes(x);
  });
  def(Array.prototype, "first", function (this: unknown[]) {
    return this[0];
  });
  def(Array.prototype, "last", function (this: unknown[]) {
    return this[this.length - 1];
  });
  def(Array.prototype, "unique", function (this: unknown[]) {
    return [...new Set(this)];
  });
  def(Array.prototype, "remove", function (this: unknown[], x: unknown) {
    const i = this.indexOf(x);
    if (i >= 0) this.splice(i, 1);
  });
}
