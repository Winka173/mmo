import {describe,it,expect} from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {archiveEntries} from './zip-reader.js';
import {writeMediaArchive} from '@ttm/media';
import {tmpDir} from '../../storage/test/helpers.js';
describe('Streaming private media ZIP, no model or provider',()=>{
 it('writes interoperable ZIP STORE with UTF-8 data, exact file hashes and standard CRC32',async()=>{
  const dir=await tmpDir('acs-zip-'),file=path.join(dir,'owned.txt'),bytes=Buffer.from('123456789');await fs.writeFile(file,bytes);const output=path.join(dir,'package.zip'),sha=createHash('sha256').update(bytes).digest('hex'),result=await writeMediaArchive(output,dir,[{name:'owned.txt',file,sha256:sha},{name:'README.txt',data:Buffer.from('Bản nháp tiếng Việt, not approved.','utf8')}]);const entries=await archiveEntries(output);expect(entries['owned.txt'].bytes).toEqual(bytes);expect(entries['owned.txt'].crc32).toBe(0xcbf43926);expect(entries['README.txt'].bytes.toString('utf8')).toContain('Bản nháp');expect(result.sha256).toBe(createHash('sha256').update(await fs.readFile(output)).digest('hex'));
 });
 it('rejects traversal, duplicate names, external paths and changed input hashes',async()=>{
  const dir=await tmpDir('acs-zip-guards-'),outside=await tmpDir('acs-zip-outside-'),file=path.join(outside,'secret.txt');await fs.writeFile(file,'not permitted');
  await expect(writeMediaArchive(path.join(dir,'bad-name.zip'),dir,[{name:'../x',data:Buffer.from('x')}])).rejects.toThrow('Unsafe');
  await expect(writeMediaArchive(path.join(dir,'duplicate.zip'),dir,[{name:'same.txt',data:Buffer.from('a')},{name:'same.txt',data:Buffer.from('b')}])).rejects.toThrow('duplicate');
  await expect(writeMediaArchive(path.join(dir,'outside.zip'),dir,[{name:'secret.txt',file,sha256:'a'.repeat(64)}])).rejects.toThrow('escaped');
  const owned=path.join(dir,'owned.txt');await fs.writeFile(owned,'new bytes');await expect(writeMediaArchive(path.join(dir,'changed.zip'),dir,[{name:'owned.txt',file:owned,sha256:'a'.repeat(64)}])).rejects.toThrow('changed');
 });
});
