import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
export async function versionAssets(root, version) {
  if (!/^[A-Za-z0-9-]+$/.test(version)) throw new Error('Invalid asset version');
  const js = path.join(root,'js');
  for (const name of await readdir(js)) {
    if (!name.endsWith('.js')) continue;
    const file=path.join(js,name);
    const source=await readFile(file,'utf8');
    await writeFile(file,source.replace(/((?:from\s*|import\s*\(\s*|import\s*)['"])(\.{1,2}\/[^'"?]+\.js)(['"])/g,`$1$2?v=${version}$3`));
  }
  for (const name of await readdir(root)) {
    if (!name.endsWith('.html')) continue;
    const file=path.join(root,name);
    await writeFile(file,(await readFile(file,'utf8')).replace(/((?:src|href)=["'])(\.\/[^"'?]+\.(?:js|css))(["'])/g,`$1$2?v=${version}$3`));
  }
}
