/** Compare actual sanitized SVG output and CPU time against a pinned local git revision. Node >=22.18. */
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {JSDOM} from 'jsdom';

const revision=process.argv[2]??'83a9d87';
if(!/^[a-f0-9]{7,40}$/.test(revision))throw new Error('Expected a local git commit hash');
const repo=fileURLToPath(new URL('../../',import.meta.url));
const directory=path.join(repo,'test-docs','math-bench',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(directory,{recursive:true});
const baseline=execFileSync('git',['show',`${revision}:src/convert/math-svg.ts`],{cwd:repo,encoding:'utf8'});
const baselinePath=path.join(directory,'baseline.ts');await writeFile(baselinePath,baseline);
const window=new JSDOM('').window;
Object.assign(globalThis,{document:window.document,DOMParser:window.DOMParser,XMLSerializer:window.XMLSerializer});
const before=await import(pathToFileURL(baselinePath).href);
const after=await import(new URL('../../src/convert/math-svg.ts',import.meta.url));
const corpus=[
 String.raw`x^2+\frac{1}{n}`,String.raw`\begin{aligned}a&=b+c\\longname&=d\end{aligned}`,
 String.raw`\left(\sum_{i=1}^{n}\frac{x_i}{\sqrt{y_i}}\right)`,String.raw`\boxed{E=mc^2}`,
 String.raw`\cancel{x}+\bcancel{abc}`,String.raw`A\xrightarrow[g]{f+h}B`,
 String.raw`\begin{pmatrix}1&0\\0&1\end{pmatrix}`,String.raw`\mathbb{R}+\boldsymbol{\alpha}+\text{hello}`,
];
const cases=Array.from({length:80},(_,i)=>({latex:corpus[i%corpus.length]+`+${i}`,display:i%2===0}));
const serialize=node=>new XMLSerializer().serializeToString(node);
for(const item of cases){
 if(serialize(before.renderMathSvg(item.latex,item.display))!==serialize(after.renderMathSvg(item.latex,item.display)))throw new Error('SVG output changed: '+item.latex);
}
const run=renderer=>{
 const start=performance.now();let bytes=0;
 for(const item of cases)bytes+=serialize(renderer.renderMathSvg(item.latex,item.display)).length;
 return {ms:performance.now()-start,bytes};
};
const oldRuns=[],newRuns=[];
for(let i=0;i<5;i++){
 if(i%2){newRuns.push(run(after));oldRuns.push(run(before));}
 else{oldRuns.push(run(before));newRuns.push(run(after));}
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const beforeMs=median(oldRuns.map(r=>r.ms)),afterMs=median(newRuns.map(r=>r.ms));
const result={revision,node:process.version,cases:cases.length,rounds:5,svgIdentical:true,beforeMs,afterMs,speedup:beforeMs/afterMs,oldRuns,newRuns};
await writeFile(path.join(directory,'summary.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,evidence:directory},null,2));
window.close();
