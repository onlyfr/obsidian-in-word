import {afterEach, expect, it, vi} from "vitest";
import {NativeImeConnection} from "../src/body/native-ime";
afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  const driver = {signal: vi.fn(async (_state: string) => {})};
  const error = vi.fn();
  const connection = new NativeImeConnection(driver, "run-a", error, 100);
  const frame = (seq: number, state = "idle", snapshot = false) => connection.receive({epoch: "run-a", seq, state, snapshot});
  return {driver, error, connection, frame};
}
it("requires an initial snapshot, then forwards real active/idle states", () => {
  const {driver, connection, frame} = setup();
  frame(7, "idle", true); frame(8, "active"); frame(9, "idle");
  expect(driver.signal.mock.calls.map(c => c[0])).toEqual(["idle", "active", "idle"]); connection.disconnect();
});
it("closes permanently on a sequence gap instead of applying an untrusted idle", () => {
  const {driver, frame} = setup(); frame(1, "active", true); frame(3); frame(4);
  expect(driver.signal.mock.calls.map(c => c[0])).toEqual(["active", "unknown"]);
});
it("rejects a different native instance and malformed frames", () => {
  for (const value of [null, {}, {epoch:"other",seq:1,state:"idle",snapshot:true}, {epoch:"run-a",seq:1,state:"ended",snapshot:true}]) {
    const {driver, connection} = setup(); connection.receive(value); expect(driver.signal).toHaveBeenCalledExactlyOnceWith("unknown");
  }
});
it("refuses an event stream without a current snapshot", () => {
  const {driver, frame} = setup(); frame(1); expect(driver.signal).toHaveBeenCalledExactlyOnceWith("unknown");
});
it("ignores duplicates and does not use them to extend native liveness", async () => {
  const {driver, frame, connection} = setup(); frame(1, "idle", true);
  await vi.advanceTimersByTimeAsync(75); frame(1); await vi.advanceTimersByTimeAsync(25);
  expect(driver.signal.mock.calls.map(c => c[0])).toEqual(["idle", "unknown"]); connection.disconnect();
});
it("accepts a fresh ordered snapshot after a health timeout", async () => {
  const {driver, frame, connection} = setup(); frame(1, "active", true); await vi.advanceTimersByTimeAsync(100); frame(2);
  expect(driver.signal.mock.calls.map(c => c[0])).toEqual(["active", "unknown", "idle"]); connection.disconnect();
});
it("disconnect closes immediately and ignores later transport frames", async () => {
  const {driver, frame, connection} = setup(); frame(1, "idle", true); connection.disconnect(); frame(2);
  await vi.advanceTimersByTimeAsync(200);
  expect(driver.signal.mock.calls.map(c => c[0])).toEqual(["idle", "unknown"]);
});
it("closes and reports a rejected host transition", async () => {
  const {driver, frame, error} = setup(); driver.signal.mockRejectedValueOnce(new Error("host failed")); frame(1, "idle", true);
  await Promise.resolve(); await Promise.resolve(); expect(driver.signal).toHaveBeenLastCalledWith("unknown"); expect(error).toHaveBeenCalledTimes(1);
});
it("notifies only changed native selection revisions, after forwarding the input gate", () => {
  vi.useFakeTimers();
  const order:string[]=[],driver={signal:vi.fn(async(state:string)=>{order.push(state);})};
  const connection=new NativeImeConnection(driver,"a",vi.fn(),100,()=>order.push("selection"));
  const frame=(seq:number,selection:number,state="idle")=>connection.receive({epoch:"a",seq,state,snapshot:seq===1,selection,selectionSupported:true});
  frame(1,0);frame(2,0);frame(3,1,"active");frame(4,1);
  expect(order).toEqual(["idle","selection","idle","active","selection","idle"]);
  connection.disconnect();
});
it("fails closed when native selection capability is absent or revisions regress", () => {
  for(const invalid of [{selectionSupported:false,selection:0},{selectionSupported:true,selection:-1},{selectionSupported:true,selection:0.5}]){
    const driver={signal:vi.fn(async()=>{})},notify=vi.fn(),error=vi.fn();
    new NativeImeConnection(driver,"a",error,100,notify).receive({epoch:"a",seq:1,state:"idle",snapshot:true,...invalid});
    expect(driver.signal).toHaveBeenCalledExactlyOnceWith("unknown");expect(notify).not.toHaveBeenCalled();expect(error).toHaveBeenCalledOnce();
  }
  const driver={signal:vi.fn(async()=>{})},error=vi.fn(),notify=vi.fn();
  const connection=new NativeImeConnection(driver,"a",error,100,notify);
  connection.receive({epoch:"a",seq:1,state:"idle",snapshot:true,selectionSupported:true,selection:2});
  connection.receive({epoch:"a",seq:2,state:"idle",selectionSupported:true,selection:1});
  expect(driver.signal).toHaveBeenLastCalledWith("unknown");expect(notify).toHaveBeenCalledOnce();expect(error).toHaveBeenCalledOnce();
});
