import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {versionAssets} from '../scripts/version-assets.mjs';
test('deployment versions module entrypoints, imports and styles so an older cached app cannot hide a fix',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'ev-version-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'js'));
 await writeFile(path.join(root,'index.html'),'<script src="./config.js"></script><script type="module" src="./js/app.js"></script><link href="./css/app.css"><a href="./data-status.html">Status</a>');
 await writeFile(path.join(root,'js/app.js'),"import {a} from './data.js';\nconst demo=()=>import('./demo.js');\nconst remote=()=>import('https://example.test/a.js');");
 await versionAssets(root,'revision123');
 const html=await readFile(path.join(root,'index.html'),'utf8');
 assert.match(html,/app.js\?v=revision123/);assert.match(html,/config.js\?v=revision123/);assert.match(html,/app.css\?v=revision123/);
 assert.match(html,/href=".\/data-status.html"/);
 const js=await readFile(path.join(root,'js/app.js'),'utf8');
 assert.match(js,/from '.\/data.js\?v=revision123'/);assert.match(js,/import\('.\/demo.js\?v=revision123'\)/);
 assert.match(js,/import\('https:\/\/example.test\/a.js'\)/);
});
