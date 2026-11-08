import type { DataStore, PluginManifest } from "./host";

export interface StoredPlugin {
  manifest: PluginManifest;
  mainJs: string;
  stylesCss?: string;
  enabled: boolean;
  source?: {repo:string;tag:string;releaseUrl:string};
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
    return new Promise((resolve,reject) => {
      try {
        const tx=db.transaction("plugins",mode),req=fn(tx.objectStore("plugins"));
        tx.oncomplete=()=>resolve(req.result);
        tx.onabort=tx.onerror=()=>reject(new Error('플러그인 저장소 작업에 실패했습니다. 저장 공간을 확인하세요.'));
      } catch (error) {
        reject(error);
      }
    });
  }

  async list(): Promise<StoredPlugin[]> {
    const stored = (await this.tx("readonly", (s) => s.getAll() as IDBRequest<StoredPlugin[]>)) ?? [];
    return stored.length ? stored : [...this.mem.values()];
  }
  async save(p: StoredPlugin): Promise<'persistent'|'session'> {
    const persistent=!!(await this.open());
    await this.tx("readwrite", (s) => s.put(p, p.manifest.id));
    this.mem.set(p.manifest.id, p);
    return persistent?'persistent':'session';
  }
  async remove(id: string): Promise<void> {
    await this.tx("readwrite", (s) => s.delete(id));
    this.mem.delete(id);
  }
}
