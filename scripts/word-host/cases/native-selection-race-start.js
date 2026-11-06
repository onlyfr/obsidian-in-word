globalThis.selectionRaceOriginal=selectionFlow.host.transition;
globalThis.selectionRaceWaiting=false;
selectionFlow.host.transition=async change=>{
 const result=await selectionRaceOriginal(change);
 if(change.mode==='rendered' && change.expected.key==='owned-b' && !selectionRaceWaiting){
  selectionRaceWaiting=true;
  await new Promise(resolve=>{globalThis.selectionRaceFinish=resolve;});
 }
 return result;
};
return {armed:true};
