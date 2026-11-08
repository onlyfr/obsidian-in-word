/** CPU benchmark of actual old/new OOXML scanners, including paragraph capture. */
import {createServer} from 'vite';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
const revision=process.argv[2]??'9037419';
if(!/^[a-f0-9]{7,40}$/.test(revision))throw new Error('Expected a local git commit hash');
const repo=fileURLToPath(new URL('../../',import.meta.url));
const directory=path.join(repo,'test-docs','object-bench',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(directory,{recursive:true});
const source=execFileSync('git',['show',`${revision}:src/convert/equations.ts`],{cwd:repo,encoding:'utf8'})
 .replace(/from (["'])\.\/([^"']+)\1/g,(_all,quote,name)=>`from ${quote}/src/convert/${name}${quote}`);
await writeFile(path.join(directory,'before.ts'),source);
const server=await createServer({configFile:false,root:repo,server:{middlewareMode:true},appType:'custom'});
try{
 const before=await server.ssrLoadModule('/'+path.relative(repo,path.join(directory,'before.ts')).replaceAll('\\','/'));
 const after=await server.ssrLoadModule('/src/convert/equations.ts');
 const results=[];
 for(const count of [1000,3000]){
  const body='<w:body>'+Array.from({length:count},(_,i)=>`<w:p w14:paraId="${i}"><w:r><w:t>${'Plain text '.repeat(40)}</w:t></w:r><m:oMath><m:r><m:t>${i}</m:t></m:r></m:oMath></w:p>`).join('')+'</w:body>';
  const expected=before.scanOoxml(body),actual=after.scanOoxml(body);
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Scanner output changed');
  const oldRuns=[],newRuns=[];
  const run=module=>{const start=performance.now();module.scanOoxml(body);return performance.now()-start;};
  for(let i=0;i<5;i++){
   if(i%2){newRuns.push(run(after));oldRuns.push(run(before));}else{oldRuns.push(run(before));newRuns.push(run(after));}
  }
  const median=values=>[...values].sort((a,b)=>a-b)[2];
  results.push({count,characters:body.length,outputIdentical:true,beforeMs:median(oldRuns),afterMs:median(newRuns),oldRuns,newRuns});
 }
 const summary={revision,node:process.version,scope:'OOXML scanning and paragraph capture only',results};
 await writeFile(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));
 console.log(JSON.stringify({...summary,evidence:directory},null,2));
}finally{await server.close();}
