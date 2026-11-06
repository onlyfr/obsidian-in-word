const before=await bodyPort.read('session-b');must((await bodyPort.read('session-a'))===null,'deleted key stays missing');
const fresh=new BodyEditSession(new WordBodyPort(),inlineBodyCodec);let error='';
try{await fresh.recover('session-a','original');}catch(e){error=String(e);}
must(error.includes('찾을 수 없습니다'),'deleted block is not recreated');
must((await bodyPort.read('session-b')).revision===before.revision,'neighbor is untouched');
must((await bodyPort.journals()).some(j=>j.key==='session-a'),'orphan journal kept for inspection');
return {deletedNotRecreated:true,neighborText:before.text,orphanJournalKept:true};
