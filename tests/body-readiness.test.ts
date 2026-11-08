import {expect,it,vi} from 'vitest';
import {inspectBodyReadiness} from '../src/body/readiness';
import {nativeParagraph} from '../src/body/native-port';
function fixture(){
 const record={version:1 as const,key:'other',phase:'closed' as const,originalMarkdown:'Alpha',originalRevision:'revision',originalStyle:'Normal'};
 const host={selectedKey:vi.fn(async():Promise<string|null>=>'selected'),journals:vi.fn(async()=>[record]),read:vi.fn(async(key:string)=>({key,epoch:'e',id:key,text:'Alpha',xml:nativeParagraph('Alpha'),style:'Normal',mode:'rendered' as const,start:0,selectionStart:1,selectionEnd:1}))};
 return {host,record};
}
it('checks selected and journalled paragraphs without exposing any write operation',async()=>{
 const {host}=fixture();expect(await inspectBodyReadiness(host,'e')).toEqual({key:'selected'});
 expect(host.read.mock.calls.map(call=>call[0])).toEqual(['other','selected','selected']);
});
it('reports unregistered selection without requesting a candidate or claiming it',async()=>{
 const {host}=fixture();host.selectedKey.mockResolvedValue(null);host.journals.mockResolvedValue([]);
 expect(await inspectBodyReadiness(host,'e')).toEqual({key:null});expect(host.read).not.toHaveBeenCalled();
});
it('refuses incomplete journals elsewhere even when the selected paragraph is healthy',async()=>{
 const {host,record}=fixture();host.journals.mockResolvedValue([{...record,phase:'editing'} as any]);
 await expect(inspectBodyReadiness(host,'e')).rejects.toThrow('중단된');expect(host.read).not.toHaveBeenCalled();
});
it.each(['source','missing','wrong-epoch'])('refuses a journalled paragraph after Undo: %s',async condition=>{
 const {host}=fixture(),read=host.read.getMockImplementation()!;
 host.read.mockImplementation(async key=>key==='other'?(condition==='missing'?null:{...await read(key),mode:condition==='source'?'source':'rendered',epoch:condition==='wrong-epoch'?'old':'e'}) as any:read(key));
 await expect(inspectBodyReadiness(host,'e')).rejects.toThrow('Ctrl+Z');
});
it.each(['duplicate','malformed','stage'])('rejects untrustworthy records: %s',async condition=>{
 const {host,record}=fixture();host.journals.mockResolvedValue(condition==='duplicate'?[record,record]:[{...record,...(condition==='malformed'?{version:2}:{nativeStage:'tagged'})}] as any);
 await expect(inspectBodyReadiness(host,'e')).rejects.toThrow('Ctrl+Z');
});
it('rejects a selection change during inspection',async()=>{
 const {host}=fixture();host.selectedKey.mockResolvedValueOnce('selected').mockResolvedValue('elsewhere');
 await expect(inspectBodyReadiness(host,'e')).rejects.toThrow('선택');
});
it('rejects text and journal changes during inspection',async()=>{
 const {host,record}=fixture();const read=host.read.getMockImplementation()!;let reads=0;
 host.read.mockImplementation(async key=>{const changed=key==='selected' && ++reads>1;return {...await read(key),text:changed?'Changed':'Alpha',xml:nativeParagraph(changed?'Changed':'Alpha')};});
 await expect(inspectBodyReadiness(host,'e')).rejects.toThrow();
 const other=fixture();other.host.journals.mockResolvedValueOnce([record]).mockResolvedValue([]);
 await expect(inspectBodyReadiness(other.host,'e')).rejects.toThrow('기록이 바뀌');
});
