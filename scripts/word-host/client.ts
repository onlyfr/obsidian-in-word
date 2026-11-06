// Development-only test entry point. It is not referenced by the production task pane or build.
import * as word from '../../src/taskpane/word';
import * as equations from '../../src/convert/equations';
import * as sidecar from '../../src/convert/sidecar';
import * as obsidian from '../../src/convert/obsidian';
import * as mathimg from '../../src/convert/mathimg';

Object.assign(globalThis, {word, equations, sidecar, obsidian, mathimg});
const status = document.getElementById('status')!;
async function send(value: unknown) {
  await fetch('/__test/result', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});
}
Object.assign(globalThis, {
  snapshot: async () => Word.run(async c => {
    const b = c.document.body;
    b.paragraphs.load('items/text,items/style'); b.tables.load('items'); b.inlinePictures.load('items');
    const xml = b.getOoxml(); const sel = c.document.getSelection(); sel.load('isEmpty');
    const parts = c.document.customXmlParts.getByNamespace(sidecar.SIDECAR_NAMESPACE); parts.load('items');
    await c.sync(); const stored = parts.items.map(p => p.getXml()); await c.sync();
    const scan = equations.scanOoxml(xml.value);
    return {
      paragraphs: b.paragraphs.items.map(p => ({text: p.text, style: p.style})),
      tables: b.tables.items.length, pictures: b.inlinePictures.items.length,
      equations: scan.equations, mathImages: scan.mathImages,
      markers: (xml.value.match(/OWB(?:EQ|TBL|FLOAT|BLANK)/g) || []), isEmpty: sel.isEmpty,
      sidecars: stored.map(p => p.value), xml: xml.value,
    };
  }),
  selectAll: async () => Word.run(async c => { c.document.body.getRange('Whole').select(); await c.sync(); }),
  reset: async (html: string) => Word.run(async c => {
    c.document.body.insertHtml(html, Word.InsertLocation.replace);
    c.document.body.getRange('Whole').select(); await c.sync();
  }),
});
Office.onReady(async info => {
  status.textContent = 'Office ready: ' + info.host;
  await send({id: 'ready', info, ua: navigator.userAgent});
  let last = '';
  for (;;) {
    try {
      const job = await (await fetch('/__test/command', {cache: 'no-store'})).json();
      if (job && job.id !== last) {
        last = job.id; status.textContent = 'Running ' + job.id;
        const started = performance.now();
        try {
          // Local test files, executed inside the actual Word add-in runtime (never a mock Office host).
          const value = await new Function('return (async()=>{' + job.code + '})()')();
          await send({id: job.id, ok: true, ms: performance.now() - started, value});
          status.textContent = 'Completed ' + job.id;
        } catch (e) {
          await send({id: job.id, ok: false, ms: performance.now() - started, error: String(e), debug: (e as any).debugInfo});
          status.textContent = 'Failed ' + job.id + ': ' + e;
        }
      }
    } catch (e) { status.textContent = String(e); }
    await new Promise(r => setTimeout(r, 500));
  }
});
