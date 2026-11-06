import {describe,expect,it} from 'vitest';
import {BodyEditSession,SelectionMoved,type BodyBlock,type BodyJournal,type BodyPort} from '../src/body/session';
import {inlineBodyCodec} from '../src/body/inline-codec';

class MemoryPort implements BodyPort {
  blocks = new Map<string,BodyBlock>(['a','b','c'].map(key=>[key,{key,mode:'rendered',text:key,html:`<p>${key} <strong>bold</strong></p>`,style:'Normal',revision:'v0'}]));
  records = new Map<string,BodyJournal>();
  calls: string[]=[];
  selected: string|null=null;
  fail: 'source'|'render'|'partial'|null=null;
  saveGate: Promise<void>|null=null;
  private revision=0;
  async read(key:string){const b=this.blocks.get(key);return b?{...b}:null;}
  async journals(){return [...this.records.values()].map(j=>({...j}));}
  async save(j:BodyJournal){if(this.saveGate){const gate=this.saveGate;this.saveGate=null;await gate;}this.records.set(j.key,{...j});this.calls.push('save:'+j.phase);}
  async source(expected:BodyBlock,markdown:string){
    if(this.selected!==expected.key)throw new SelectionMoved();
    const block=this.guard(expected);this.calls.push('source:'+expected.key);
    if(this.fail==='source')throw new Error('injected source failure');
    block.text=markdown;block.revision='v'+(++this.revision);
    if(this.fail==='partial')throw new Error('failure before mode tag');
    block.mode='source';
  }
  async render(expected:BodyBlock,html:string,style:string){
    const block=this.guard(expected);this.calls.push('render:'+expected.key);
    if(this.fail==='render')throw new Error('injected render failure');
    block.mode='rendered';block.html=html;block.text=new DOMParser().parseFromString(html,'text/html').querySelector('p')?.textContent??'';
    block.style=style;block.revision='v'+(++this.revision);
  }
  guard(expected:BodyBlock){const block=this.blocks.get(expected.key);if(!block||block.revision!==expected.revision)throw new Error('revision conflict');return block;}
}
function setup(){
 const port=new MemoryPort();const session=new BodyEditSession(port,inlineBodyCodec);
 const select=(key:string|null)=>{port.selected=key;return session.select(key);};
 return {port,session,select};
}
const tick=()=>new Promise(r=>setTimeout(r,0));

describe('experimental body editing sessions',()=>{
 it('preserves edits, style and identity when leaving one block for another',async()=>{
  const {port,session,select}=setup();await select('a');port.blocks.get('a')!.text='edited **bold**';
  await select('b');expect(port.blocks.get('a')!.text).toBe('edited bold');expect(port.blocks.get('a')!.style).toBe('Normal');
  expect(port.blocks.get('b')!.mode).toBe('source');expect(session.activeKey).toBe('b');
  await select(null);expect(session.activeKey).toBeNull();expect(port.records.get('b')!.phase).toBe('closed');
 });
 it('coalesces rapid moves and does not enter a stale target after persistence waits',async()=>{
  const {port,session,select}=setup();let release!:()=>void;port.saveGate=new Promise(r=>{release=r;});
  const a=select('a');await tick();const b=select('b');const c=select('c');release();await Promise.all([a,b,c]);
  expect(port.calls.filter(c=>c.startsWith('source:'))).toEqual(['source:c']);expect(session.activeKey).toBe('c');
  expect(await session.pendingRecovery()).toEqual(['c']);
  await select('a');expect(session.activeKey).toBe('a');
 });
 it('defers document mutations while composition is active and handles only the latest target afterwards',async()=>{
  const {port,session,select}=setup();await session.composition(true);await select('a');await select('b');
  expect(port.calls).toEqual([]);await session.composition(false);expect(session.activeKey).toBe('b');
  await session.composition(true);await select(null);expect(port.blocks.get('b')!.mode).toBe('source');
  await session.composition(false);expect(port.blocks.get('b')!.mode).toBe('rendered');
 });
 it('leaves an undo/redo change alone and pauses without metadata writes',async()=>{
  const {port,session,select}=setup();await select('a');const before=port.calls.length;
  port.blocks.get('a')!.mode='rendered';await select('b');
  expect(session.pausedReason).toBeTruthy();expect(port.calls).toHaveLength(before);expect(port.blocks.get('b')!.mode).toBe('rendered');
 });
 it('does not close a source after selection returned while its read was pending',async()=>{
  const {port,session,select}=setup();await select('a');let release!:()=>void;
  const read=port.read.bind(port);let wait=true;
  port.read=async key=>{const block=await read(key);if(wait){wait=false;await new Promise<void>(r=>{release=r;});}return block;};
  const leaving=select(null);await tick();const returning=select('a');release();await Promise.all([leaving,returning]);
  expect(port.calls.filter(c=>c==='render:a')).toHaveLength(0);expect(session.activeKey).toBe('a');
 });
 it('honors composition that began during an in-flight source read',async()=>{
  const {port,session,select}=setup();await select('a');let release!:()=>void;
  const read=port.read.bind(port);let wait=true;
  port.read=async key=>{const block=await read(key);if(wait){wait=false;await new Promise<void>(r=>{release=r;});}return block;};
  const leaving=select(null);await tick();const closing=session.composition(true);release();await Promise.all([leaving,closing]);
  expect(port.blocks.get('a')!.mode).toBe('source');await session.composition(false);expect(port.blocks.get('a')!.mode).toBe('rendered');
 });
 it('pauses on deletion and never recreates the missing block from a matching-text neighbor',async()=>{
  const {port,session,select}=setup();await select('a');port.blocks.delete('a');await session.reconcile();
  await expect(session.recover('a','original')).rejects.toThrow('찾을 수 없습니다');
  expect(port.blocks.has('a')).toBe(false);expect(port.records.has('a')).toBe(true);expect(port.blocks.get('b')!.text).toBe('b');
 });
 it('recovers the edited source with a fresh controller using document-persisted records',async()=>{
  const {port,select}=setup();await select('a');port.blocks.get('a')!.text='새 **내용**';
  const restarted=new BodyEditSession(port,inlineBodyCodec);
  expect(await restarted.pendingRecovery()).toEqual(['a']);await restarted.recover('a','current');
  expect(port.blocks.get('a')!.text).toBe('새 내용');expect(restarted.pausedReason).toBeTruthy();
 });
 it('preserves unsupported source for manual recovery and can explicitly restore the original',async()=>{
  const {port,session,select}=setup();await select('a');port.blocks.get('a')!.text='first\n\nsecond';
  await expect(select(null)).rejects.toThrow('일반 문단');expect(port.blocks.get('a')!.mode).toBe('source');
  await expect(session.resume()).rejects.toThrow('먼저 복구');
  await session.recover('a','original');expect(port.blocks.get('a')!.text).toBe('a bold');
 });
 it('does not retry a failed render and retains both current source and the original journal',async()=>{
  const {port,session,select}=setup();await select('a');port.blocks.get('a')!.text='edited';port.fail='render';
  await expect(select(null)).rejects.toThrow('injected');expect(port.calls.filter(c=>c==='render:a')).toHaveLength(1);
  expect(port.blocks.get('a')!.text).toBe('edited');expect(port.records.get('a')!.phase).toBe('closing');
  port.fail=null;await session.recover('a','current');expect(port.blocks.get('a')!.mode).toBe('rendered');
 });
 it('rejects ambiguous partial entry and allows an explicit original restore',async()=>{
  const {port,session,select}=setup();port.fail='partial';await expect(select('a')).rejects.toThrow('before mode tag');
  const restarted=new BodyEditSession(port,inlineBodyCodec);expect(await restarted.pendingRecovery()).toEqual(['a']);
  await expect(restarted.recover('a','current')).rejects.toThrow('판단할 수 없습니다');
  port.fail=null;await restarted.recover('a','original');expect(port.blocks.get('a')!.text).toBe('a bold');
 });
 it('protects a concurrent edit with the host revision guard',async()=>{
  const {port,session,select}=setup();let release!:()=>void;port.saveGate=new Promise(r=>{release=r;});
  const work=select('a');await tick();port.blocks.get('a')!.revision='external';port.blocks.get('a')!.text='remote';release();
  await expect(work).rejects.toThrow('revision conflict');expect(port.blocks.get('a')!.text).toBe('remote');expect(session.pausedReason).toBeTruthy();
 });
});

it.each(['# heading','| A | B |\n|---|---|','![image](https://example.test/x.png)','$x^2$','- item'])(
 'rejects content outside the single ordinary paragraph experiment: %s',source=>expect(()=>inlineBodyCodec.html(source)).toThrow());
