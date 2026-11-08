import type {CommunityAssetReader} from './community';

/** Explicit session connection. No localhost discovery, persistent token, credentials, or arbitrary proxy URL. */
export async function connectCommunityDownloader(connection:string):Promise<CommunityAssetReader>{
  let parsed:URL;
  try{parsed=new URL(connection.trim());}catch{throw new Error('도우미 창에서 복사한 연결 주소를 붙여넣으세요.');}
  if(parsed.protocol!=='http:' || parsed.hostname!=='127.0.0.1' || !parsed.port || parsed.pathname!=='/' ||
    parsed.search || parsed.username || parsed.password || !/^#[0-9a-f]{64}$/.test(parsed.hash))
    throw new Error('도우미 창에서 복사한 연결 주소를 붙여넣으세요.');
  const token=parsed.hash.slice(1),origin=parsed.origin;
  return connectAssetService(origin,token);
}

export async function connectWindowsHost():Promise<CommunityAssetReader|null>{
  if(!document.querySelector('meta[name="oiw-windows-host"][content="1"]'))return null;
  if(location.origin!=='https://localhost:49175')throw new Error('Windows 앱의 작업창 출처가 올바르지 않습니다.');
  const response=await fetch('/host-session',{credentials:'omit',headers:{'X-OIW-Host':'1'},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Windows 앱 연결을 확인할 수 없습니다. 앱을 다시 여세요.');
  const session=await response.json();
  if(session.protocol!==1 || !session.capabilities?.downloads || typeof session.token!=='string' || !/^[0-9a-f]{64}$/.test(session.token))throw new Error('지원하지 않는 Windows 앱입니다.');
  return connectAssetService(location.origin,session.token);
}

async function connectAssetService(origin:string,token:string):Promise<CommunityAssetReader>{
  const request=async(path:string,body:unknown)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(origin+path,{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal,
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw new Error(response.status===403?'도우미 연결 주소가 만료됐거나 출처가 허용되지 않습니다. 다시 연결하세요.':`도우미 다운로드 실패 (HTTP ${response.status})`);
      return response;
    }catch(error){
      if(controller.signal.aborted)throw new Error('도우미 응답 시간이 초과되었습니다.');
      if(error instanceof TypeError)throw new Error('도우미에 연결하지 못했습니다. 도우미 창과 로컬 네트워크 접근 허용 여부를 확인하세요.');
      throw error;
    }finally{clearTimeout(timer);}
  };
  const status=await(await request('/status',{})).json();
  if(status.protocol!==1)throw new Error('지원하지 않는 다운로드 도우미입니다.');
  return async(id,repo,assetId,max)=>{
    const response=await request('/asset',{id,repo,assetId,maxBytes:max});
    if(!response.body)throw new Error('도우미 응답 본문이 없습니다.');
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let length=0,text='';
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;
        if(length>max)throw new Error('파일이 지원 크기를 넘습니다.');text+=decoder.decode(value,{stream:true});}
      return text+decoder.decode();
    }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  };
}
