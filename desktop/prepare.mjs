import * as fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { clearBuildFolder } from './build-folders.mjs';
const root=process.cwd(), standalone=path.join(root,'apps/web/.next/standalone');
await fs.access(path.join(standalone,'apps/web/server.js'));
await fs.mkdir('desktop',{recursive:true});
await clearBuildFolder(root,'desktop/backend');
await fs.mkdir('desktop/backend',{recursive:true});
await fs.cp(standalone,'desktop/backend',{recursive:true,dereference:true});
await fs.cp('apps/web/.next/static','desktop/backend/apps/web/.next/static',{recursive:true});
// Dereferencing pnpm links relocates aliases away from their sibling dependencies.
// Flatten the traced production dependency graph into the bundle's ancestor node_modules.
const pnpmRoot=path.join(root,'desktop/backend/node_modules/.pnpm');
for(const entry of await fs.readdir(pnpmRoot,{withFileTypes:true})){
 if(!entry.isDirectory())continue;
 const modules=path.join(pnpmRoot,entry.name,'node_modules');
 for(const item of await fs.readdir(modules,{withFileTypes:true}).catch(()=>[])){
   if(item.name.startsWith('.'))continue;
   const src=path.join(modules,item.name),dest=path.join(root,'desktop/backend/node_modules',item.name);
   if(item.name.startsWith('@')){
     await fs.mkdir(dest,{recursive:true});
     for(const name of await fs.readdir(src)){
       const target=path.join(dest,name);if(!(await fs.stat(target).catch(()=>null)))await fs.cp(path.join(src,name),target,{recursive:true,dereference:true});
     }
   }else if(!(await fs.stat(dest).catch(()=>null)))await fs.cp(src,dest,{recursive:true,dereference:true});
 }
}
// All links were dereferenced and sibling packages flattened above. Retaining
// the duplicate pnpm store creates installer paths over Windows' 260-char limit.
await clearBuildFolder(root,'desktop/backend/node_modules/.pnpm');
await fs.mkdir('desktop/runtime',{recursive:true});
await fs.copyFile(process.execPath,'desktop/runtime/node.exe');
const uv=process.env.ACS_UV_BINARY||path.join(process.env.LOCALAPPDATA||'','Programs/Python/Python311/Scripts/uv.exe');
await fs.copyFile(uv,'desktop/runtime/uv.exe');
// Freeze engine code before NSIS reads resources. Source edits during a long
// native compilation must not produce different installer/portable inventories.
await clearBuildFolder(root,'desktop/engines');
await fs.cp('engines','desktop/engines',{recursive:true,dereference:true,filter:file=>!file.split(path.sep).includes('__pycache__')&&!file.endsWith('.pyc')});
await build({entryPoints:['apps/worker/src/main.ts'],outfile:'desktop/backend/apps/web/worker.mjs',bundle:true,platform:'node',format:'esm',target:'node20',external:['sharp','yauzl'],banner:{js:"import { createRequire as __acsCreateRequire } from 'node:module'; const require = __acsCreateRequire(import.meta.url);"}});
await build({entryPoints:['apps/worker/src/maintenance.ts'],outfile:'desktop/backend/apps/web/maintenance.mjs',bundle:true,platform:'node',format:'esm',target:'node20',external:['sharp','yauzl'],banner:{js:"import { createRequire as __acsCreateRequire } from 'node:module'; const require = __acsCreateRequire(import.meta.url);"}});
// Ensure native dependencies resolve for the bundled worker even if Next's tracing changes.
for(const dep of ['sharp','yauzl']){
 const local=await fs.realpath(path.join(root,'apps/web/node_modules',dep));
 await fs.mkdir('desktop/backend/apps/web/node_modules',{recursive:true});
 await fs.cp(local,path.join(root,'desktop/backend/apps/web/node_modules',dep),{recursive:true,dereference:true});
}
console.log('Next SSR, Node runtime and TypeScript worker prepared. AI weights remain external.');
