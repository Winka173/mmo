import * as fs from 'node:fs/promises';
import path from 'node:path';
import {clearBuildFolder} from '../desktop/build-folders.mjs';
const root=process.cwd();
await fs.mkdir(path.join(root,'dist/windows'),{recursive:true});
for(const [source,destination] of [['desktop/backend','dist/windows/backend'],['desktop/runtime','dist/windows/runtime'],['desktop/engines','dist/windows/engines']]){
 await fs.access(path.join(root,source));
 await clearBuildFolder(root,destination);
 await fs.cp(path.join(root,source),path.join(root,destination),{recursive:true,dereference:true});
}
await fs.rm(path.join(root,'dist/windows/resource-manifest.json'),{force:true});
