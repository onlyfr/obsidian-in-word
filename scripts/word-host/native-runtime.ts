import {NativeBodyPort, type NativeBodyHost, type NativeTransition} from "../../src/body/native-port";
import {BodyEditSession} from "../../src/body/session";
import {inlineBodyCodec} from "../../src/body/inline-codec";

export function createNativeHarness(token: string) {
  const host: NativeBodyHost & {failAt: number; operations: unknown[]} = {
    failAt: 0, operations: [],
    async read(key) {return request({op:"read",key});},
    async journals() {return request({op:"journals"});},
    async transition(change: NativeTransition) {
      host.operations.push({mode:change.mode,key:change.expected.key});
      return request({op:"transition",change,failAt:host.failAt});
    },
  };
  async function request(job: unknown) {
    const response = await fetch("/__test/native-body",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(job)});
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json(); if (!result.ok) throw new Error(result.error); return result.value;
  }
  const port = new NativeBodyPort(host), session = new BodyEditSession(port,inlineBodyCodec);
  return {host,port,session};
}
