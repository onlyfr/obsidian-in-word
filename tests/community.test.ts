import {afterEach,expect,it,vi} from 'vitest';
import {downloadCommunityPlugin,fetchCommunityCatalog,parseCommunityCatalog,releaseManifest,searchCommunityPlugins} from '../src/plugins/community';
import {connectCommunityDownloader} from '../src/plugins/community-connection';

const item={id:'example',name:'Example',author:'Maker',description:'Math editor tools',repo:'maker/example'};
const release={tag_name:'1.2.3',draft:false,prerelease:false,assets:[{id:1,name:'manifest.json',size:100},{id:2,name:'main.js',size:100}]};
const json=(value:unknown)=>new Response(JSON.stringify(value));
afterEach(()=>vi.unstubAllGlobals());
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
it('does not install a partially downloaded bundle and requires a native asset reader',async()=>{
 const reader=async(_id:string,_repo:string,id:number)=>{if(id===2)throw new Error('offline');return JSON.stringify({id:'example',name:'Example',version:'1.2.3'});};
 await expect(downloadCommunityPlugin(item,async()=>json(release),reader)).rejects.toThrow('offline');
 await expect(downloadCommunityPlugin(item,async()=>json(release))).rejects.toThrow('도우미');
});
it('reports API limits and enforces streamed catalog size even without Content-Length',async()=>{
 await expect(fetchCommunityCatalog(async()=>new Response('',{status:403}))).rejects.toThrow('한도');
 const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024+1));controller.close();}});
 await expect(fetchCommunityCatalog(async()=>new Response(stream))).rejects.toThrow('크기');
});
it('accepts only explicit loopback connection codes and uses session authorization',async()=>{
 const fetcher=vi.fn(async(url:string,options:RequestInit)=>url.endsWith('/status')?json({protocol:1}):new Response('bundle'));
 vi.stubGlobal('fetch',fetcher);
 for(const value of ['https://evil.test/#'+ 'a'.repeat(64),'http://127.0.0.1:3000/path#'+'a'.repeat(64),'http://user@127.0.0.1:3000/#'+'a'.repeat(64)])
   await expect(connectCommunityDownloader(value)).rejects.toThrow();
 expect(fetcher).not.toHaveBeenCalled();
 const reader=await connectCommunityDownloader('http://127.0.0.1:12345/#'+'a'.repeat(64));
 expect(await reader('example','maker/example',123,1024)).toBe('bundle');
 const [,options]=fetcher.mock.calls[1];expect(options.credentials).toBe('omit');
 expect(JSON.parse(options.body as string)).toEqual({id:'example',repo:'maker/example',assetId:123,maxBytes:1024});
});
