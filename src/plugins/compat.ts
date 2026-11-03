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
 * `window.i18next.createInstance()`, `init({lng, fallbackLng})`, `addResourceBundle(lng, ns, resources)` and then
 * `getFixedT(null, ns)(key)`. A small stand-in with the parts of i18next that does: resource store, nested keys
 * (`a.b.c`), `ns:key`, fallback language, `{{interpolation}}`, `defaultValue`; unknown keys come back as written.
 */
export function createI18nextShim() {
  type Res = Record<string, unknown>;
  const make = (): Record<string, unknown> => {
    const store: Record<string, Record<string, Res>> = {};
    let fallback = "en";
    let defaultNS = "translation";
    const inst: Record<string, any> = { language: "en", languages: ["en"], isInitialized: false };
    const lookup = (lng: string, ns: string, key: string): string | undefined => {
      let cur: unknown = store[lng]?.[ns];
      if (cur && typeof cur === "object" && key in (cur as Res) && typeof (cur as Res)[key] === "string") return (cur as Res)[key] as string;
      for (const part of key.split(".")) {
        if (cur && typeof cur === "object" && part in (cur as Res)) cur = (cur as Res)[part];
        else return undefined;
      }
      return typeof cur === "string" ? cur : undefined;
    };
    const translate = (key: string | string[], opts: Record<string, any> = {}, fixedNs?: string, fixedLng?: string, prefix?: string) => {
      let k = Array.isArray(key) ? key[0] : String(key);
      let ns = opts.ns ?? fixedNs ?? defaultNS;
      const i = k.indexOf(":");
      if (i > 0) {
        ns = k.slice(0, i);
        k = k.slice(i + 1);
      }
      if (prefix) k = `${prefix}.${k}`;
      const lng = opts.lng ?? fixedLng ?? inst.language;
      let val = lookup(lng, ns, k) ?? lookup(fallback, ns, k);
      if (val === undefined) return opts.defaultValue ?? k;
      val = val.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, name: string) => (name in opts ? String(opts[name]) : `{{${name}}}`));
      return val;
    };
    const addBundle = (lng: string, ns: string, res: Res) => {
      ((store[lng] ??= {})[ns] ??= {});
      Object.assign(store[lng][ns], res);
      return inst;
    };
    inst.t = (key: string | string[], opts?: Record<string, any>) => translate(key, opts);
    inst.init = (o: Record<string, any> = {}) => {
      if (o.lng) inst.language = o.lng;
      if (typeof o.fallbackLng === "string") fallback = o.fallbackLng;
      if (o.defaultNS) defaultNS = o.defaultNS;
      for (const [lng, nss] of Object.entries((o.resources ?? {}) as Record<string, Record<string, Res>>))
        for (const [ns, res] of Object.entries(nss)) addBundle(lng, ns, res);
      inst.isInitialized = true;
      return Promise.resolve(inst.t);
    };
    inst.getFixedT = (lng: string | null, ns?: string, keyPrefix?: string) => (key: string | string[], opts?: Record<string, any>) =>
      translate(key, opts, ns ?? undefined, lng ?? undefined, keyPrefix);
    inst.exists = (key: string, opts?: Record<string, any>) => translate(key, { ...opts, defaultValue: "\u0000" }) !== "\u0000";
    inst.changeLanguage = (lng: string) => {
      inst.language = lng;
      return Promise.resolve(inst.t);
    };
    inst.addResourceBundle = (lng: string, ns: string, res: Res) => addBundle(lng, ns, res);
    inst.addResources = (lng: string, ns: string, res: Res) => addBundle(lng, ns, res);
    inst.addResource = (lng: string, ns: string, key: string, value: string) => addBundle(lng, ns, { [key]: value });
    inst.hasResourceBundle = (lng: string, ns: string) => !!store[lng]?.[ns];
    inst.on = () => inst;
    inst.off = () => inst;
    inst.createInstance = () => make();
    return inst;
  };
  return make();
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
