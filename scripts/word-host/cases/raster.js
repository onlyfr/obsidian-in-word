const {createRasterizer}=await import('/src/convert/mathraster.ts');
const current=await createRasterizer();
const reference=globalThis.rasterBaselineUrl?await(await import(globalThis.rasterBaselineUrl)).createRasterizer():null;
const corpus=[String.raw`\boxed{E=mc^2}`,String.raw`A\xrightarrow[g]{f+h}B`,String.raw`\cancel{x}+\bcancel{abc}`,
 String.raw`\begin{pmatrix}1&0\\0&1\end{pmatrix}`,String.raw`\sum_{i=1}^{n}\frac{x_i}{\sqrt{y}}`,String.raw`\text{<img src=x onerror=alert(1)>}`,
 String.raw`\begin{aligned}a&=b+c\\longname&=d\end{aligned}`,
 String.raw`\begin{align}a&=b+c\\longname&=d\end{align}`,
 String.raw`\begin{alignedat}{2}a&=b+c&\qquad u&=v\\longname&=d&w&=z+q\end{alignedat}`];
const samples=[];
let beforeMs=0,afterMs=0;
for(const latex of corpus)for(const display of [false,true]){
 const startBefore=performance.now();
 const before=reference?await reference.render(latex,display):null;
 beforeMs+=performance.now()-startBefore;
 const startAfter=performance.now();
 const result=await current.render(latex,display);
 afterMs+=performance.now()-startAfter;
 must(result.w>0 && result.h>0 && Number.isFinite(result.baseline),'nonempty raster');
 must(result.png.startsWith('iVBOR'),'PNG signature');
 if(before){
  must(result.w===before.w && result.h===before.h && result.baseline===before.baseline,'dimensions/baseline preserved '+latex);
  must(result.png===before.png,'PNG bytes preserved '+latex);
 }
 samples.push({latex,display,w:result.w,h:result.h,baseline:result.baseline,pngLength:result.png.length,identical:before?true:null});
}
must(!document.querySelector('img[src="x"],[onerror]'),'text stays text');
return {count:samples.length,compared:!!reference,beforeMs:reference?beforeMs:null,afterMs,samples};
