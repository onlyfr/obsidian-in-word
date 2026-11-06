selectionLive.dispose();
let refused=false;try{await selectionFlow.ownership.claimSelected('must-not-own');}catch{refused=true;}
must(refused,'foreign/unsupported selection is never enrolled');
must(!selectionFlow.host.operations.some(op=>op.mode==='claim' && op.key==='must-not-own'),'refusal precedes native enrollment mutation');
return {refused,operations:selectionFlow.host.operations};
