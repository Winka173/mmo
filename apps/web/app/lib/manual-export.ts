import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {StudioReviewStore,hash} from '@ttm/automation';
import {DataStore,readJson,writeJsonAtomic,withLock} from '@ttm/storage';
import {writeMediaArchive,type ArchiveEntry} from '@ttm/media';
import {inspectStudioMedia} from '@ttm/quality';
export const ManualExport=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),runId:z.string().uuid(),fingerprint:z.string(),state:z.enum(['building','ready','failed']),tempName:z.string().nullable().default(null),sha256:z.string().nullable(),bytes:z.number(),files:z.array(z.object({name:z.string(),sha256:z.string(),bytes:z.number()})),createdAt:z.string(),error:z.string().nullable(),publicationAuthorized:z.literal(false)});
export async function exportFileHash(file:string){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
export async function createManualExport(store:DataStore,runId:string){
 z.string().uuid().parse(runId);
 return withLock(store.p('locks',`manual-export-${runId}.lock`),async()=>{
  const reviews=new StudioReviewStore(store),context=await reviews.context(runId),run=context.run;
  if(run.state!=='ready'||!context.videoHash||!context.qa?.technical)throw new Error('Manual package requires a completed technically valid video');
  const dir=store.p('studio','artifacts',runId),files=[];
  const root=await fs.realpath(store.root),actualDir=await fs.realpath(dir);if(!actualDir.startsWith(root+path.sep))throw new Error('Export artifact folder escaped the data directory');
  for(const name of ['final.mp4','captions.srt','captions.ass','thumbnail.jpg','citations.md','product-publication-description.txt'])if(run.outputs.includes(name)){
   const file=path.join(dir,name),info=await fs.lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new Error('Export artifact is not a regular file');files.push({name,file,bytes:info.size,sha256:await exportFileHash(file)});
  }
  if(files.find(f=>f.name==='final.mp4')?.sha256!==context.videoHash)throw new Error('Final video changed during export preflight');
  const total=files.reduce((n,f)=>n+f.bytes,0);if(total>1.9*1024**3||files.some(f=>f.bytes>1024**3))throw new Error('Manual package supports files up to 1 GiB and total media up to 1.9 GiB');
  const decisionIds=context.gates.map(g=>g.decision?.id??null),id=hash({version:1,runId,fingerprint:context.fingerprint,files:files.map(({name,bytes,sha256})=>({name,bytes,sha256})),decisionIds});
  const recordFile=store.p('studio','exports',`${id}.json`),output=store.p('studio','export-files',`${id}.zip`);await fs.mkdir(path.dirname(output),{recursive:true});
  if(!(await fs.realpath(path.dirname(output))).startsWith(root+path.sep))throw new Error('Export destination escaped the data directory');
  await fs.mkdir(path.dirname(recordFile),{recursive:true});if(!(await fs.realpath(path.dirname(recordFile))).startsWith(root+path.sep))throw new Error("Export metadata folder escaped the data directory");
  let record=await readJson(recordFile,ManualExport);
  if(record&&(record.id!==id||record.runId!==runId||record.fingerprint!==context.fingerprint))throw new Error('Export checkpoint identity changed');
  if(record?.sha256&&await exportFileHash(output).catch(()=>null)===record.sha256){if(record.state!=='ready'){record={...record,state:'ready',error:null,tempName:null};await writeJsonAtomic(recordFile,record);}return record;}
  if(await fs.access(output).then(()=>true,()=>false))throw new Error('Existing export integrity failed; keep the archive for diagnosis and create a repaired version');
  if(record?.tempName){
   if(!/^[a-f0-9]{64}\.zip\.[a-f0-9-]{36}\.tmp$/.test(record.tempName)||!record.tempName.startsWith(id+'.zip.'))throw new Error('Unexpected export temporary filename');
   const previous=path.resolve(path.dirname(output),record.tempName);if(path.dirname(previous)!==path.dirname(output))throw new Error('Export temporary file escaped its folder');
   const info=await fs.lstat(previous).catch(()=>null);if(info?.isSymbolicLink())throw new Error('Export temporary file is a symbolic link');
   if(info?.isFile()&&record.sha256&&await exportFileHash(previous)===record.sha256){await fs.rename(previous,output);record={...record,state:'ready',error:null,tempName:null};await writeJsonAtomic(recordFile,record);return record;}
   if(info?.isFile())await fs.unlink(previous);
  }
  const settings=await store.getSettings(),space=await fs.statfs(path.dirname(output));if(space.bavail*space.bsize<total+settings.minFreeDiskGb*1024**3)throw new Error('Insufficient disk space for a private manual package');
  const validation=context.qa.videoSha256===context.videoHash?{technical:true,method:'QA_BOUND_TO_EXACT_VIDEO_SHA256'}:await inspectStudioMedia(path.join(dir,'final.mp4'),run.config);
  if(!validation.technical||await exportFileHash(path.join(dir,'final.mp4'))!==context.videoHash)throw new Error('Current video bytes did not pass technical export validation');
  const now=new Date().toISOString();record=ManualExport.parse({id,runId,fingerprint:context.fingerprint,state:'building',sha256:null,bytes:0,files:[],createdAt:now,error:null,publicationAuthorized:false});await writeJsonAtomic(recordFile,record);
  const manifest={schemaVersion:1,product:'AUTONOMOUS CREATIVE STUDIO',packageStatus:'MANUAL_DRAFT_NOT_PUBLICATION_AUTHORITY',runId,parentId:run.parentId,snapshotHash:run.snapshotHash,language:run.language,title:context.research?.draft?.title??run.title,format:run.snapshot.format,videoSha256:context.videoHash,createdAt:now,files:files.map(({name,bytes,sha256})=>({name,bytes,sha256})),technicalQA:validation.technical,technicalValidation:{videoSha256:context.videoHash,method:"method"in validation?validation.method:"ACTUAL_FULL_DECODE_AT_EXPORT"},scopedReviewsAtExport:context.gates.map(g=>({category:g.category,status:g.status,decisionId:g.decision?.id??null})),sourceHashes:run.sources.map(s=>({sha256:s.sha256,size:s.size})),sourceUrls:context.research?.documents?.map((d:any)=>({url:d.url,fetchedAt:d.fetchedAt,sha256:d.sha256}))??[],rights:{state:run.snapshot.rights,evidence:run.snapshot.rightsEvidence},productInvalidated:await fs.access(path.join(dir,'product-invalidation.json')).then(()=>true,()=>false),publicationAuthorized:false};
  const metadata={title:manifest.title,language:run.language,format:run.snapshot.format,description:context.productPublicationDescription||'',audienceDesignation:'REQUIRES_OWNER_REVIEW',syntheticMediaDisclosure:'REQUIRES_PLATFORM_REVIEW',publicationAuthorized:false};
  const readme='AUTONOMOUS CREATIVE STUDIO — PRIVATE MANUAL DRAFT\n\nThis package is not permission to publish. Review facts, footage, captions, voice, rights, disclosures, destination and account/platform policy before posting. Review statuses are a snapshot at export time and do not override later revocation or product invalidation. Do not upload the entire archive to a social platform; select the reviewed media and metadata yourself.\n\nBản nháp xuất thủ công — chưa cấp quyền đăng. Kiểm tra nội dung, phụ đề, giọng, quyền nguồn và công bố trước khi đăng. Không tải cả ZIP lên nền tảng.\n\nNo credentials, engine logs, models or source media are included. Source/settings hashes identify the retained private workspace version.\n';
  const entries:ArchiveEntry[]=[...files.map(({name,file,sha256})=>({name,file,sha256})),{name:'README.txt',data:Buffer.from(readme,'utf8')},{name:'package-manifest.json',data:Buffer.from(JSON.stringify(manifest,null,2),'utf8')},{name:'publish-draft.json',data:Buffer.from(JSON.stringify(metadata,null,2),'utf8')}],temp=output+`.${randomUUID()}.tmp`;
  record={...record,tempName:path.basename(temp)};await writeJsonAtomic(recordFile,record);
  try{const packed=await writeMediaArchive(temp,dir,entries,new Date(run.createdAt));if((await reviews.context(runId)).fingerprint!==context.fingerprint)throw new Error('Output or evidence changed during export; archive was not accepted');record={...record,sha256:packed.sha256,bytes:packed.bytes,files:packed.files};await writeJsonAtomic(recordFile,record);await fs.rename(temp,output);record={...record,state:'ready',tempName:null};await writeJsonAtomic(recordFile,record);await store.audit({actor:'studio-ui',action:'studio.manual-export.created',subject:runId,detail:{id,sha256:record.sha256,publicationAuthorized:false}});return record;}
  catch(error){await writeJsonAtomic(recordFile,{...record,state:'failed',error:error instanceof Error?error.message:'Manual export failed'});throw error;}
  finally{await fs.unlink(temp).catch(()=>{});}
 });
}
