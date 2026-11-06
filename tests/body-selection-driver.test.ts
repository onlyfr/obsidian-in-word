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
