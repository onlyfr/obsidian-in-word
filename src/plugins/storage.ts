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
  refresh(id:string):void { this.mem.delete(id); }
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
    this.db ??= new Promise((resolve,reject) => {
      try {
        let blocked=false;
        const req = indexedDB.open("oiw-plugins", 2);
        req.onupgradeneeded = () => {
          if(!req.result.objectStoreNames.contains('plugins'))req.result.createObjectStore('plugins');
          if(!req.result.objectStoreNames.contains('transfers'))req.result.createObjectStore('transfers');
        };
        req.onsuccess = () => {
          if(blocked){req.result.close();return;}
          req.result.onversionchange=()=>{req.result.close();this.db=null;};resolve(req.result);
        };
        req.onblocked=()=>{blocked=true;reject(new Error('다른 Word 작업창이 저장소 갱신을 막고 있습니다. 다른 작업창을 닫고 다시 여세요.'));};
        req.onerror = () => req.error?.name==='VersionError'?reject(new Error('더 최신 저장소가 있습니다. 앱을 업데이트하세요.')):resolve(null);
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
    const stored = await this.tx("readonly", (s) => s.getAll() as IDBRequest<StoredPlugin[]>);
    return stored ?? [...this.mem.values()];
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
  async transferCommitted(id:string):Promise<boolean>{
    const db=await this.open();if(!db)throw new Error('이관에는 영구 저장소가 필요합니다. IndexedDB를 사용할 수 없습니다.');
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('transfers','readonly'),request=tx.objectStore('transfers').get('last');
      tx.oncomplete=()=>resolve(request.result===id);tx.onabort=tx.onerror=()=>reject(new Error('이관 저장 기록을 확인하지 못했습니다.'));
    });
  }
  /** add() refuses concurrent conflicts; all bundles and the commit marker share one transaction. */
  async commitTransfer(id:string,plugins:StoredPlugin[]):Promise<void>{
    const db=await this.open();if(!db)throw new Error('이관에는 영구 저장소가 필요합니다.');
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['plugins','transfers'],'readwrite');
      tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error('이관 저장에 실패했습니다. 설치 중복이나 저장 공간을 확인하세요.'));
      try{for(const plugin of plugins)tx.objectStore('plugins').add(plugin,plugin.manifest.id);tx.objectStore('transfers').put(id,'last');}
      catch(error){tx.abort();reject(error);}
    });
    for(const plugin of plugins)this.mem.set(plugin.manifest.id,plugin);
  }
}
