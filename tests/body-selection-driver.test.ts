import {afterEach,expect,it,vi} from 'vitest';
import {BodySelectionDriver} from '../src/body/selection-driver';
afterEach(()=>vi.useRealTimers());
function setup(target=vi.fn(async()=> 'a' as string|null)){
 const session={select:vi.fn(async(_key:string|null)=>{}),composition:vi.fn(async(_active:boolean)=>{}),pause:vi.fn()};
 const error=vi.fn();const driver=new BodySelectionDriver(session,target,error,100);
 return {session,target,error,driver};
}
it('defaults to unknown and does not query Word or convert on events',async()=>{
 vi.useFakeTimers();const {driver,session,target}=setup();driver.notify();driver.notify();await vi.advanceTimersByTimeAsync(500);
 expect(target).not.toHaveBeenCalled();expect(session.select).not.toHaveBeenCalled();expect(session.composition).toHaveBeenCalledWith(true);driver.dispose();
});
it('reads the latest target before opening the composition gate',async()=>{
 const {driver,session}=setup();await driver.signal('idle');
 expect(session.select).toHaveBeenCalledWith('a');expect(session.select.mock.invocationCallOrder[0]).toBeLessThan(session.composition.mock.invocationCallOrder[2]);driver.dispose();
});
it('coalesces events while idle and ignores stale selection reads',async()=>{
 vi.useFakeTimers();const {driver,session,target}=setup();await driver.signal('idle');session.select.mockClear();
 driver.notify();driver.notify();driver.notify();await vi.advanceTimersByTimeAsync(99);expect(session.select).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(session.select).toHaveBeenCalledTimes(1);expect(target).toHaveBeenCalledTimes(2);driver.dispose();
});
it('re-samples a selection that changed while idle release was waiting',async()=>{
 let release!:(value:string|null)=>void;
 const target=vi.fn(async()=> 'b' as string|null).mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 const {driver,session}=setup(target);const work=driver.signal('idle');await Promise.resolve();await Promise.resolve();
 driver.notify();release('a');await work;expect(session.select).toHaveBeenCalledWith('b');expect(session.select).not.toHaveBeenCalledWith('a');driver.dispose();
});
it('does not release after a newer active composition signal arrives',async()=>{
 let release!:(value:string|null)=>void;const target=vi.fn(()=>new Promise<string|null>(r=>{release=r;}));
 const {driver,session}=setup(target);const work=driver.signal('idle');await Promise.resolve();await Promise.resolve();
 await driver.signal('active');release('a');await work;expect(session.select).not.toHaveBeenCalled();expect(session.composition).not.toHaveBeenCalledWith(false);driver.dispose();
});
it('closes the gate and pauses when selection reads fail',async()=>{
 vi.useFakeTimers();const {driver,session,target,error}=setup();await driver.signal('idle');target.mockRejectedValueOnce(new Error('read failed'));
 driver.notify();await vi.advanceTimersByTimeAsync(100);expect(driver.state).toBe('unknown');expect(session.pause).toHaveBeenCalled();expect(error).toHaveBeenCalled();driver.dispose();
});
it('disposal invalidates pending work and keeps the session paused',async()=>{
 vi.useFakeTimers();const {driver,session,target}=setup();await driver.signal('idle');target.mockClear();driver.notify();driver.dispose();
 await vi.advanceTimersByTimeAsync(500);expect(target).not.toHaveBeenCalled();expect(session.pause).toHaveBeenCalled();
});
it('repeated idle health frames do not query Word again',async()=>{
 const {driver,target,session}=setup();await driver.signal('idle');target.mockClear();session.composition.mockClear();
 await driver.signal('idle');await driver.signal('idle');expect(target).not.toHaveBeenCalled();expect(session.composition).not.toHaveBeenCalled();driver.dispose();
});
it('does not fan out selection reads while an earlier read is pending',async()=>{
 vi.useFakeTimers();const {driver,target,session}=setup();await driver.signal('idle');session.select.mockClear();
 let release!:(value:string|null)=>void;target.mockImplementationOnce(()=>new Promise(r=>{release=r;}));
 driver.notify();await vi.advanceTimersByTimeAsync(100);driver.notify();await vi.advanceTimersByTimeAsync(100);
 expect(target).toHaveBeenCalledTimes(2);release('stale');await vi.advanceTimersByTimeAsync(0);
 expect(session.select).toHaveBeenCalledExactlyOnceWith('a');expect(target).toHaveBeenCalledTimes(3);driver.dispose();
});
it('keeps a newer selection notified while a conversion outlasts the debounce',async()=>{
 vi.useFakeTimers();const {driver,target,session}=setup();await driver.signal('idle');session.select.mockClear();
 let finish!:()=>void;session.select.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
 target.mockResolvedValueOnce('a').mockResolvedValueOnce('b');
 driver.notify();await vi.advanceTimersByTimeAsync(100);
 driver.notify();await vi.advanceTimersByTimeAsync(100);
 finish();await vi.advanceTimersByTimeAsync(0);
 expect(session.select.mock.calls.map(c=>c[0])).toEqual(['a','b']);driver.dispose();
});
it('keeps a selection notified while opening the input gate runs a transition',async()=>{
 const {driver,session,target}=setup();let finish!:()=>void;
 session.composition.mockImplementation(async active=>{if(!active)await new Promise<void>(r=>{finish=r;});});
 target.mockResolvedValueOnce('a').mockResolvedValueOnce('b');
 const work=driver.signal('idle');for(let i=0;i<8;i++)await Promise.resolve();
 session.composition.mockResolvedValue();driver.notify();finish();await work;
 expect(session.select.mock.calls.map(c=>c[0])).toEqual(['a','b']);expect(target).toHaveBeenCalledTimes(2);driver.dispose();
});
it('does not reopen the gate after composition starts during a pending transition',async()=>{
 const {driver,session,target}=setup();let finish!:()=>void;
 session.composition.mockImplementation(async active=>{if(!active)await new Promise<void>(r=>{finish=r;});});
 const work=driver.signal('idle');for(let i=0;i<8;i++)await Promise.resolve();
 await driver.signal('active');driver.notify();finish();await work;
 expect(driver.state).toBe('active');expect(target).toHaveBeenCalledTimes(1);
 expect(session.composition.mock.calls.filter(c=>!c[0])).toHaveLength(1);driver.dispose();
});
