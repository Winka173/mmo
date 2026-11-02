import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';

/** Only generated, ACS-owned build folders; never data, models or arbitrary paths. */
export async function clearBuildFolder(root,relative){
 const allowed=['desktop/backend','desktop/backend/node_modules/.pnpm','desktop/engines','dist/windows/backend','dist/windows/runtime','dist/windows/engines'];
 assert.ok(allowed.includes(relative),'Unrecognized generated build folder');
 const workspace=await fs.realpath(root),target=path.resolve(root,...relative.split('/'));
 const canonical=value=>process.platform==='win32'?value.toLowerCase():value;
 const inside=value=>canonical(value).startsWith(canonical(workspace+path.sep));
 assert.ok(inside(target)&&target!==workspace,'Build target must remain inside the workspace');
 const parent=await fs.realpath(path.dirname(target));
 assert.ok(inside(parent),'Build folder parent resolves outside the workspace');
 const stat=await fs.lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(!stat)return;
 assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Build root must be a real directory, not a junction/link');
 assert.ok(inside(await fs.realpath(target)),'Resolved build target escapes the workspace');
 await fs.rm(target,{recursive:true,force:true});
}
