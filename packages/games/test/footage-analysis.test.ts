import {describe,it,expect} from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {tmpDir} from '../../storage/test/helpers.js';
import {runProcess,probeMedia} from '@ttm/media';
import {analyzeFootage} from '../src/footage.js';
const ffmpeg=path.resolve('.local/tools/ffmpeg.exe'),ffprobe=path.resolve('.local/tools/ffprobe.exe');
describe('Actual local footage signals on an owned synthetic video, not gameplay',()=>{
 it('uses configured tool paths, measures scene/black/motion, retains bytes and declares partial coverage',async()=>{
  const dir=await tmpDir('acs-footage-signals-'),file=path.join(dir,'owned synthetic.mp4');
  const rendered=await runProcess(ffmpeg,['-y','-f','lavfi','-i','testsrc2=s=320x180:r=10:d=3','-f','lavfi','-i','color=c=black:s=320x180:r=10:d=1','-f','lavfi','-i','testsrc2=s=320x180:r=10:d=3','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',file]);expect(rendered.code).toBe(0);
  const before=createHash('sha256').update(await fs.readFile(file)).digest('hex'),probe=await probeMedia(file,ffprobe);expect(probe.hasVideo).toBe(true);
  const full=await analyzeFootage('owned-fixture',file,{ffmpeg,ffprobe,ocrFrames:0});expect(full.coverage.fullClip).toBe(true);expect(full.blacks.some(i=>i.start>=2.9&&i.end>=3.9)).toBe(true);expect(full.scenes.length).toBeGreaterThan(0);expect(full.motion.length).toBeGreaterThan(0);expect(full.leak.method).toBe('unavailable');
  const partial=await analyzeFootage('owned-fixture',file,{ffmpeg,ffprobe,ocrFrames:0,maxAnalyzeSec:4});expect(partial.coverage).toMatchObject({scannedSeconds:4,fullClip:false});expect(partial.warnings.some(w=>w.startsWith('Partial scan'))).toBe(true);expect(partial.highlights.every(h=>h.out<=4)).toBe(true);expect(createHash('sha256').update(await fs.readFile(file)).digest('hex')).toBe(before);
  await expect(analyzeFootage('failing-process',file,{ffmpeg:process.execPath,ffprobe,ocrFrames:0})).rejects.toMatchObject({code:'FOOTAGE_DECODE_FAILED'});
  const audioFile=path.join(dir,'owned 16k tone.mkv');expect((await runProcess(ffmpeg,['-y','-i',file,'-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=7','-map','0:v','-map','1:a','-c:v','copy','-c:a','pcm_s16le',audioFile])).code).toBe(0);const audioMap=await analyzeFootage('16k-owned-tone',audioFile,{ffmpeg,ffprobe,ocrFrames:0});expect(audioMap.audioRms.length).toBeGreaterThanOrEqual(6);expect(audioMap.audioRms.length).toBeLessThanOrEqual(8);
 });
 it('refuses unreadable source instead of returning a fake successful highlight map',async()=>{
  const dir=await tmpDir('acs-footage-corrupt-'),file=path.join(dir,'corrupt.mp4');await fs.writeFile(file,'not media');await expect(analyzeFootage('corrupt',file,{ffmpeg,ffprobe,ocrFrames:0})).rejects.toThrow();
 });
});
