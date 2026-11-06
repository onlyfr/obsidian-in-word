globalThis.selectionExpected=await selectionFlow.host.read('owned-a');
const record=(await selectionFlow.host.journals()).find(r=>r.key==='owned-a');
must(record?.phase==='closed','ownership conflict fixture starts from a closed journal');
const xml=`<bodyEdit xmlns="urn:obsidian-in-word:body-edit:v1" key="owned-a">${encodeURIComponent(JSON.stringify(record))}</bodyEdit>`;
globalThis.selectionConflictChange={expected:selectionExpected,mode:'journal',text:selectionExpected.text,xml:'',style:selectionExpected.style,caretStart:0,caretEnd:0,pending:xml,complete:xml};
return {id:selectionExpected.id};
