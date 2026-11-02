import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {analyzeFootage} from '@ttm/games';
import {FactoryError} from '@ttm/core';
import {hash,type StudioRun} from '@ttm/automation';
import {writeJsonAtomic} from '@ttm/storage';
async function sha(file:string){const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');}
/** Suggestions only: pixel/audio activity cannot identify a boss, feature or factual event. */
export async function inspectStudioFootage(run:StudioRun,dir:string){
 const sources=run.sources.filter(s=>/\.(mp4|mov|webm|mkv)$/i.test(s.file));if(run.snapshot.family!=='game'||!sources.length)return null;
 const key=hash({version:1,sources:sources.map(s=>s.sha256),ffmpeg:run.config.ffmpeg,ffprobe:run.config.ffprobe,maxFiles:4,maxSeconds:300,OCR:false});
 for(const source of sources)if(await sha(source.file)!==source.sha256)throw new FactoryError('SOURCE_CHANGED','HUMAN_REQUIRED','Pinned footage changed; analysis and output cannot use these bytes');
 const file=path.join(dir,'source-analysis.json'),cached=await fs.readFile(file,'utf8').then(JSON.parse,()=>null);if(cached?.key===key)return cached;
 const results=[];
 for(const [index,source]of sources.entries()){
  if(index>=4){results.push({file:source.file,sha256:source.sha256,status:'NOT_ANALYZED',reason:'Four-video scan budget; remaining footage requires review'});continue;}
  const analysis=await analyzeFootage(source.sha256,source.file,{ffmpeg:run.config.ffmpeg,ffprobe:run.config.ffprobe,ocrFrames:0,maxAnalyzeSec:300});
  if(await sha(source.file)!==source.sha256)throw new FactoryError('SOURCE_CHANGED','HUMAN_REQUIRED','Footage changed during analysis; results were not accepted');
  results.push({file:source.file,sha256:source.sha256,status:'MEASURED_LOCAL_HEURISTICS',analysis});
 }
 const report={schemaVersion:1,key,at:new Date().toISOString(),method:'Existing local FFmpeg scene/black/freeze/audio signals and sampled frame statistics',semanticReview:'UNKNOWN',rightsReview:'REQUIRED',authenticGameplay:'OWNER_SOURCE_REQUIRES_REVIEW',OCR:'DISABLED_NOT_VERIFIED',automaticShotReplacement:false,results};
 await writeJsonAtomic(file,report);return report;
}
