import {describe,it,expect,vi} from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const fake=vi.hoisted(()=>({audio:Buffer.alloc(0),operations:[] as string[]}));
vi.mock('../src/local-engine.js',()=>({invokeLocalEngine:async(_ctx:unknown,_config:unknown,request:any)=>{fake.operations.push(request.op);if(request.op.endsWith('environment'))return{fingerprint:'mock-sine-not-voice'};if(request.op==='tts'){await fs.writeFile(request.output,fake.audio);return{engine:'MOCK_TTS_NOT_SPEECH'};}throw new Error(`Unexpected AI operation ${request.op}`);}}));
import {StudioStore,StudioReviewStore} from '@ttm/automation';
import {runProcess} from '@ttm/media';
import {buildContext} from '../src/context.js';
import {executeStudio} from '../src/studio.js';
import {inspectStudioFootage} from '../src/studio-footage.js';
import {tmpDir} from '../../../packages/storage/test/helpers.js';
describe('Game-source analysis export integration (synthetic video, mock AI, actual FFmpeg)',()=>{
 it('exports real scene signals, preserves them in deterministic children and refuses changed pinned source bytes',async()=>{
  const ctx=await buildContext({dataDir:await tmpDir('acs-source-analysis-pipeline-')}),studio=new StudioStore(ctx.store),source=ctx.store.p('owned-test-pattern');await fs.mkdir(source,{recursive:true});const ffmpeg=path.resolve('.local/tools/ffmpeg.exe'),ffprobe=path.resolve('.local/tools/ffprobe.exe');
  expect((await runProcess(ffmpeg,['-y','-f','lavfi','-i','testsrc2=s=320x180:r=10:d=4','-c:v','libx264',path.join(source,'owned-test-not-gameplay.mp4')])).code).toBe(0);
  const wav=Buffer.alloc(44+24000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(48000,40);for(let i=0;i<24000;i++)wav.writeInt16LE(Math.round(1200*Math.sin(i/24000*2*Math.PI*220)),44+2*i);fake.audio=wav;
  await studio.saveConfig({ffmpeg,ffprobe});const now=new Date().toISOString(),pilot=await studio.saveAutopilot({id:randomUUID(),family:'game',name:'Source analysis protocol, not real gameplay',sourceFolder:source,scriptText:'Internal owned moving test pattern.',brief:'Synthetic test card protocol; no game feature claim or posting permission.',rights:'AUTHORIZED_REUSE',rightsEvidence:'Owner-authored generated moving test pattern and sine fixture; no actual gameplay or human narration.',createdAt:now,updatedAt:now}),{id}=await studio.enqueue(pilot,'en-US',randomUUID());await executeStudio(ctx,id);const run=(await studio.run(id))!,dir=ctx.store.p('studio','artifacts',id),before=await fs.readFile(path.join(dir,'source-analysis.json'),'utf8');
  expect(run.state).toBe('ready');expect(run.outputs).toContain('source-analysis.json');const report=JSON.parse(before);expect(report.semanticReview).toBe('UNKNOWN');expect(report.automaticShotReplacement).toBe(false);expect(report.results[0].analysis.motion.length).toBeGreaterThan(0);expect((await new StudioReviewStore(ctx.store).context(id)).contentApproved).toBe(false);
  expect((await inspectStudioFootage(run,dir)).at).toBe(report.at);
  const calls=[...fake.operations],child=await studio.cut(id,.2,.4);await executeStudio(ctx,child.id);expect((await studio.run(child.id))?.outputs).toContain('source-analysis.json');expect(await fs.readFile(ctx.store.p('studio','artifacts',child.id,'source-analysis.json'),'utf8')).toBe(before);expect(fake.operations).toEqual(calls);
  await fs.appendFile(run.sources[0].file,'changed pinned source');await expect(inspectStudioFootage(run,dir)).rejects.toThrow('Pinned footage changed');
 });
});
