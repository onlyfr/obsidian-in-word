import {nativeBodyBlock,type NativeBodyHost,type NativeBodySnapshot} from './native-port';
import type {NativeOwnershipHost} from './native-ownership';

export type BodyReadHost=Pick<NativeBodyHost,'read'|'journals'> & Pick<NativeOwnershipHost,'selectedKey'>;
const guidance=' Word의 Ctrl+Z / Ctrl+Y로 문서를 확인하세요.';
const keyPattern=/^[a-zA-Z0-9-]{1,64}$/;

/** Point-in-time, read-only inspection. Does not register, repair, write journals or resume editing. */
export async function inspectBodyReadiness(host:BodyReadHost,epoch:string,expectedKey?:string):Promise<{key:string|null}>{
  const selected=await host.selectedKey();
  if(selected!==null && (typeof selected!=='string' || !keyPattern.test(selected)))throw new Error('문단 식별자를 확인할 수 없습니다.'+guidance);
  if(expectedKey && selected!==expectedKey)throw new Error('선택한 문단이 바뀌었습니다. 다시 상태를 확인하세요.');
  const records=await host.journals();
  if(!Array.isArray(records))throw new Error('전환 기록을 읽을 수 없습니다.'+guidance);
  const keys=new Set<string>();
  for(const record of records){
    if(!record || typeof record.key!=='string' || !keyPattern.test(record.key) || keys.has(record.key)
      || record.version!==1 || !['opening','editing','closing','closed'].includes(record.phase)
      || typeof record.originalMarkdown!=='string' || typeof record.originalRevision!=='string' || typeof record.originalStyle!=='string')throw new Error('전환 기록이 불완전하거나 중복됩니다.'+guidance);
    keys.add(record.key);
    if(record.phase!=='closed' || record.nativeStage!==undefined)throw new Error('중단된 전환 기록이 있습니다.'+guidance);
  }
  if(selected)keys.add(selected);
  const fingerprint=JSON.stringify(records);
  let selectedSnapshot:NativeBodySnapshot|undefined;
  for(const key of keys){
    const block=await host.read(key);
    verify(block,key,epoch);
    if(key===selected)selectedSnapshot={...block!};
  }
  if(selectedSnapshot){
    const latest=await host.read(selected!);verify(latest,selected!,epoch);
    if(latest!.id!==selectedSnapshot.id || nativeBodyBlock(latest!).revision!==nativeBodyBlock(selectedSnapshot).revision)throw new Error('상태 확인 중 문단이 바뀌었습니다. 다시 확인하세요.');
  }
  const after=await host.journals();
  if(JSON.stringify(after)!==fingerprint)throw new Error('상태 확인 중 전환 기록이 바뀌었습니다. 다시 확인하세요.');
  if(await host.selectedKey()!==selected)throw new Error('상태 확인 중 선택이 바뀌었습니다. 다시 확인하세요.');
  return {key:selected};
}
function verify(block:NativeBodySnapshot|null,key:string,epoch:string):void{
  if(!block || block.key!==key || block.epoch!==epoch || typeof block.id!=='string' || !block.id || typeof block.style!=='string' || block.mode!=='rendered')throw new Error('문단이 없거나 원본 모드·소유권 상태를 확인할 수 없습니다.'+guidance);
  nativeBodyBlock(block);
}
