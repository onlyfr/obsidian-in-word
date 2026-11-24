import {afterEach,expect,it,vi} from 'vitest';
import {downloadCommunityPlugin,fetchCommunityCatalog,parseCommunityCatalog,releaseManifest,searchCommunityPlugins} from '../src/plugins/community';
import {connectWindowsHost} from '../src/plugins/community-connection';

const item={id:'example',name:'Example',author:'Maker',description:'Math editor tools',repo:'maker/example'};
const release={tag_name:'1.2.3',draft:false,prerelease:false,assets:[{id:1,name:'manifest.json',size:100},{id:2,name:'main.js',size:100}]};
const json=(value:unknown)=>new Response(JSON.stringify(value));
afterEach(()=>{vi.unstubAllGlobals();document.querySelectorAll('meta[name=oiw-windows-host]').forEach(node=>node.remove());});
it('does not discover a Windows host from an ordinary web pane and refuses a forged marker origin',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);expect(await connectWindowsHost()).toBeNull();
 const marker=document.createElement('meta');marker.name='oiw-windows-host';marker.content='1';document.head.append(marker);
 await expect(connectWindowsHost()).rejects.toThrow('출처');expect(fetcher).not.toHaveBeenCalled();
});
it('bootstraps the bundled Windows pane only from its own origin without persisting credentials',async()=>{
 const marker=document.createElement('meta');marker.name='oiw-windows-host';marker.content='1';document.head.append(marker);
 vi.stubGlobal('location',{origin:'https://localhost:49175'});
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url)==='/host-session'?json({protocol:1,capabilities:{downloads:true},token:'b'.repeat(64)}):json({protocol:1}));
 vi.stubGlobal('fetch',fetcher);expect(await connectWindowsHost()).toBeTypeOf('function');
 expect(fetcher.mock.calls[0][0]).toBe('/host-session');
});
it('searches official catalog text with all terms and permits existing legacy IDs/repos',()=>{
 const items=parseCommunityCatalog([item,{...item,id:'legacy.id',repo:'maker/-legacy'}]);
 expect(searchCommunityPlugins(items,'MAKER math')).toHaveLength(2);expect(searchCommunityPlugins(items,'not-there')).toEqual([]);
 expect(()=>parseCommunityCatalog([item,{...item}])).toThrow();
 for(const repo of ['maker/../target','https://evil.test/a','maker/..','maker/repo?x'])expect(()=>parseCommunityCatalog([{...item,repo}])).toThrow();
});
it('downloads only the selected release assets and leaves code disabled without executing it',async()=>{
 const fetcher=vi.fn(async(_url:RequestInfo|URL)=>json(release));
 const reader=vi.fn(async(_id,_repo,id)=>id===1?JSON.stringify({id:'example',name:'Example',version:'1.2.3'}):'globalThis.unexpectedExecution=true;');
 const result=await downloadCommunityPlugin(item,fetcher,reader);
 expect(fetcher.mock.calls[0][0]).toBe('https://api.github.com/repos/maker/example/releases/latest');
 expect(reader.mock.calls.map(call=>call[2])).toEqual([1,2]);expect(result.enabled).toBe(false);
 expect(result.source?.tag).toBe('1.2.3');expect((globalThis as any).unexpectedExecution).toBeUndefined();
});
it('rejects wrong identity before downloading code, absent assets, oversized assets and prereleases',async()=>{
 const reader=vi.fn(async()=>JSON.stringify({id:'another',name:'Wrong',version:'1.2.3'}));
 await expect(downloadCommunityPlugin(item,async()=>json(release),reader)).rejects.toThrow('manifest');expect(reader).toHaveBeenCalledTimes(1);
 for(const metadata of [{...release,prerelease:true},{...release,assets:[]},{...release,assets:[{id:1,name:'manifest.json',size:1000000}]}])
   await expect(downloadCommunityPlugin(item,async()=>json(metadata),reader)).rejects.toThrow();
 expect(()=>releaseManifest({id:'example',name:'Example',version:'bad'},'example')).toThrow();
});
it('does not install a partially downloaded bundle or an unverified relay file',async()=>{
 const reader=async(_id:string,_repo:string,id:number)=>{if(id===2)throw new Error('offline');return JSON.stringify({id:'example',name:'Example',version:'1.2.3'});};
 await expect(downloadCommunityPlugin(item,async()=>json(release),reader)).rejects.toThrow('offline');
 await expect(downloadCommunityPlugin(item,async()=>json(release))).rejects.toThrow('검증값');
});
it('reports API limits and enforces streamed catalog size even without Content-Length',async()=>{
 await expect(fetchCommunityCatalog(async()=>new Response('',{status:403}))).rejects.toThrow('한도');
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1));controller.close();}});
 await expect(fetchCommunityCatalog(async()=>new Response(stream))).rejects.toThrow('크기');
});
it('uses the current Windows session for asset downloads',async()=>{
 const marker=document.createElement('meta');marker.name='oiw-windows-host';marker.content='1';document.head.append(marker);
 vi.stubGlobal('location',{origin:'https://localhost:49175'});
 const fetcher=vi.fn(async(url:string,_options:RequestInit)=>url==='/host-session'?json({protocol:1,capabilities:{downloads:true},token:'a'.repeat(64)}):url.endsWith('/status')?json({protocol:1}):new Response('bundle'));
 vi.stubGlobal('fetch',fetcher);
 const reader=await connectWindowsHost();
 expect(await reader!('example','maker/example',123,1024)).toBe('bundle');
 const [url,options]=fetcher.mock.calls[2];expect(url).toBe('https://localhost:49175/asset');
 expect(options.headers).toMatchObject({Authorization:'Bearer '+'a'.repeat(64)});
 expect(JSON.parse(options.body as string)).toEqual({id:'example',repo:'maker/example',assetId:123,maxBytes:1024});
});

it('rejects same-size altered bytes from the web relay before reading plugin code',async()=>{
 const original=new TextEncoder().encode(JSON.stringify({id:item.id,name:item.name,version:'1.2.3'}));
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',original));
 const digest='sha256:'+Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
 const altered=original.slice();altered[0]^=1;
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>String(url).endsWith('/latest')
   ?json({...release,assets:[{...release.assets[0],size:original.length,digest},release.assets[1]]})
   :new Response(altered));
 await expect(downloadCommunityPlugin(item,fetcher)).rejects.toThrow('검증값');
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls[1][0]).toBe('https://gh-proxy.com/https://github.com/maker/example/releases/download/1.2.3/manifest.json');
});
it('keeps the native deadline active until the asset body finishes',async()=>{
 const marker=document.createElement('meta');marker.name='oiw-windows-host';marker.content='1';document.head.append(marker);
 vi.stubGlobal('location',{origin:'https://localhost:49175'});
 vi.stubGlobal('fetch',async(url:string,options:RequestInit)=>{
   if(url==='/host-session')return json({protocol:1,capabilities:{downloads:true},token:'f'.repeat(64)});
   if(url.endsWith('/status'))return json({protocol:1});
   return new Response(new ReadableStream({start(controller){
     options.signal!.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true});
   }}));
 });
 vi.useFakeTimers();
 try{
   const read=await connectWindowsHost();
   const outcome=expect(read!('example','maker/example',1,100)).rejects.toThrow('시간이 초과');
   await vi.advanceTimersByTimeAsync(30000);await outcome;
 }finally{vi.useRealTimers();}
});
