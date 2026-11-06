const {NativeImeConnection}=await import('/src/body/native-ime.ts');
globalThis.nativeImeEvents=[];
globalThis.nativeImeConnection=new NativeImeConnection(inputDriver,nativeEpoch,e=>inputEvents.errors.push(String(e)));
globalThis.nativeImeSource=new EventSource('/__test/ime');
nativeImeSource.onmessage=e=>{
 const frame=JSON.parse(e.data);nativeImeEvents.push({...frame,reads:inputEvents.reads});nativeImeConnection.receive(frame);
};
nativeImeSource.onerror=()=>nativeImeConnection.disconnect();
const deadline=Date.now()+5000;
while(!nativeImeEvents.length && Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
must(nativeImeEvents.length>0,'native snapshot received');
return {connected:true,first:nativeImeEvents[0]};
