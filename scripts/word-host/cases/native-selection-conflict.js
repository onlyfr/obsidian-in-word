const before=await selectionFlow.host.journals();
const result=await selectionFlow.host.transition(selectionConflictChange);
must(result.code===selectionConflictCode,'native UI-thread ownership check refuses mismatched or duplicate identities: '+result.code);
must(JSON.stringify(await selectionFlow.host.journals())===JSON.stringify(before),'ownership rejection writes no journal');
return {code:result.code};
