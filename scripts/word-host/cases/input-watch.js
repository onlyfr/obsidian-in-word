const {BodySelectionDriver}=await import('/src/body/selection-driver.ts');
globalThis.inputEvents={events:0,reads:0,errors:[]};
globalThis.inputDriver=new BodySelectionDriver(bodySession,async()=>{inputEvents.reads++;return bodyPort.selectedKey();},e=>inputEvents.errors.push(String(e)));
globalThis.inputHandler=()=>{inputEvents.events++;inputDriver.notify();};
await new Promise((resolve,reject)=>Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged,inputHandler,r=>r.status===Office.AsyncResultStatus.Succeeded?resolve():reject(r.error)));
return {defaultGate:inputDriver.state};
