import {BodyEditSession} from '../../src/body/session';
import {WordBodyPort,bodyTag,BODY_NAMESPACE} from '../../src/body/word-port';
import {inlineBodyCodec} from '../../src/body/inline-codec';

/** Reinitialize after an actual document close/reopen; nothing from the old JS controller is retained. */
export function initializeBodyHarness() {
  const port=new WordBodyPort();
  Object.assign(globalThis,{BodyEditSession,WordBodyPort,bodyTag,BODY_NAMESPACE,inlineBodyCodec,
    bodyPort:port,bodySession:new BodyEditSession(port,inlineBodyCodec),
    moveBody:async(key:string|null)=>Word.run(async c=>{
      const controls=c.document.contentControls;controls.load('items/tag');await c.sync();
      const cc=key?controls.items.find(cc=>cc.tag.startsWith('owb-body:v1:'+key+':')):undefined;
      if(key && !cc)throw new Error('Missing test block '+key);
      (cc?cc.getRange('Content').getRange('Start'):c.document.body.paragraphs.getLast().getRange('Start')).select();await c.sync();
    }),
    editBody:async(key:string,text:string)=>Word.run(async c=>{
      const controls=c.document.contentControls;controls.load('items/tag');await c.sync();
      const cc=controls.items.find(cc=>cc.tag.startsWith('owb-body:v1:'+key+':'));
      if(!cc)throw new Error('Missing edit block '+key);
      cc.insertText(text,'Replace');await c.sync();
    }),
  });
}
