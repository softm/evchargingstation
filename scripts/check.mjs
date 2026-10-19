import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
async function walk(dir) {
  const files=[];
  for(const item of await readdir(dir,{withFileTypes:true})) {
    if(['node_modules','.git','.cache','.runtime','dist','__pycache__','.openai'].includes(item.name)) continue;
    const name=path.join(dir,item.name);
    if(item.isDirectory()) files.push(...await walk(name)); else files.push(name);
  }
  return files;
}
let checked=0;
for(const file of await walk(root)) {
  if(/\.(?:js|mjs)$/.test(file)) {
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    if(result.status!==0) throw new Error(result.stderr);
    checked++;
  }
  if(/\.json$/.test(file)) JSON.parse(await readFile(file,'utf8'));
}
const html=await readFile(path.join(root,'public/index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
  const src=match[1];
  if(!src || /^(?:https?:|tel:|mailto:|#|data:)/.test(src)) continue;
  const clean=src.split(/[?#]/)[0];
  if(!clean) continue;
  await access(path.join(root,'public',clean));
}
const manifest=JSON.parse(await readFile(path.join(root,'public/data/manifest.json'),'utf8'));
if(!['unconfigured','snapshot','live','demo'].includes(manifest.mode)) throw new Error('Unrecognized data mode');
if(manifest.mode==='unconfigured' && (manifest.totalStations!==0 || manifest.regions.length)) throw new Error('Unconfigured production manifest must contain no sample stations');
console.log(`Checked ${checked} JS modules, JSON files, local HTML resources and the data mode.`);
