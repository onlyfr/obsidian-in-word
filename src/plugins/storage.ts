import type { DataStore, PluginManifest } from "./host";

export interface StoredPlugin {
  manifest: PluginManifest;
  mainJs: string;
  stylesCss?: string;
  enabled: boolean;
}

/** Plugin settings (data.json): synchronous, backed by localStorage when available. */
export class LocalDataStore implements DataStore {
  private readonly mem = new Map<string, unknown>();
  constructor(private readonly prefix = "oiw:data:") {}
  get(id: string) {
    if (this.mem.has(id)) return this.mem.get(id);
    try {
      const raw = localStorage.getItem(this.prefix + id);
      if (raw !== null) {
        const v = JSON.parse(raw);
        this.mem.set(id, v);
        return v;
      }
    } catch {
      /* storage unavailable: memory only */
    }
    return undefined;
  }
  set(id: string, data: unknown) {
    this.mem.set(id, data);
    try {
      localStorage.setItem(this.prefix + id, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }
}

/** Plugin bundles can be large, so keep them in IndexedDB; fall back to memory when it is unavailable. */
export class PluginLibrary {
  private readonly mem = new Map<string, StoredPlugin>();
  private db: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      try {
        const req = indexedDB.open("oiw-plugins", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("plugins");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    const db = await this.open();
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const req = fn(db.transaction("plugins", mode).objectStore("plugins"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async list(): Promise<StoredPlugin[]> {
    const stored = (await this.tx("readonly", (s) => s.getAll() as IDBRequest<StoredPlugin[]>)) ?? [];
    return stored.length ? stored : [...this.mem.values()];
  }
  async save(p: StoredPlugin): Promise<void> {
    this.mem.set(p.manifest.id, p);
    await this.tx("readwrite", (s) => s.put(p, p.manifest.id));
  }
  async remove(id: string): Promise<void> {
    this.mem.delete(id);
    await this.tx("readwrite", (s) => s.delete(id));
  }
}
