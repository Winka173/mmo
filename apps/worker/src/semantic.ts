import {SemanticStore,SemanticIndex,SemanticVector,embeddingConfigHash,embeddingTextHash,hash} from "@ttm/automation";
import {withLock,writeJsonAtomic} from "@ttm/storage";
import {FactoryError} from "@ttm/core";
import {invokeLocalEngine} from "./local-engine.js";
import type {Ctx} from "./context.js";

export async function executeSemantic(ctx:Ctx,id:string){
 const registry=new SemanticStore(ctx.store);let task=await registry.get(id);if(!task)throw new Error("Semantic task missing");
 if(task.configHash!==hash(task.config))throw new Error("Semantic config changed across attempts");
 if(task.state==="ready")return {taskId:id,state:task.state};
 const embed=async(texts:{id:string;text:string;role?:string}[],suffix:string)=>invokeLocalEngine(ctx,task!.config,{op:"embed",texts},ctx.store.p("studio","semantic","tasks",`${id}-${suffix}.request.json`));
 await registry.save({...task,state:"running",error:null});
 try{
  if(task.kind==="index"){
   const result=await withLock(ctx.store.p("locks","semantic-index.lock"),async()=>{
    const corpus=await registry.corpus();if(!corpus.documents.length)throw new Error("No ready original scripts to index; derived/cut versions are excluded");
    const documents:any[]=[];let fingerprint="",evidence:any=null;
    // Incremental refresh: reuse vectors of unchanged scripts from an index built with the same embedding config.
    const previous=await registry.index(),reusable=previous&&previous.configHash===embeddingConfigHash(task!.config)?new Map(previous.documents.map(d=>[`${d.id}:${d.textHash}`,d])):new Map();
    const pendingDocs=corpus.documents.filter(d=>!reusable.has(`${d.id}:${d.textHash}`));
    if(!pendingDocs.length&&previous){fingerprint=previous.fingerprint;evidence={...previous.evidence,incremental:{reused:corpus.documents.length,embedded:0}};}
    for(let offset=0;offset<pendingDocs.length;offset+=16){
     const batch=pendingDocs.slice(offset,offset+16),response=await embed(batch.map(d=>({id:d.id,text:d.text})),`batch-${offset}`);
     if(!/^[a-f0-9]{64}$/.test(response.fingerprint)||response.documents?.length!==batch.length)throw new Error("Invalid embedding batch response");
     if(fingerprint&&fingerprint!==response.fingerprint)throw new Error("Embedding identity changed during index construction");fingerprint=response.fingerprint;
     const {documents:_,...metadata}=response;evidence=metadata;
     for(let i=0;i<batch.length;i++){const vector=response.documents[i];if(vector.id!==batch[i].id||vector.textSha256!==batch[i].textHash)throw new Error("Embedding document order/text identity changed");documents.push({...batch[i],vector:SemanticVector.parse(vector.vector)});}
     await registry.save({...task!,state:"running",result:{completed:documents.length,total:pendingDocs.length},error:null});
    }
    if(previous&&reusable.size&&fingerprint!==previous.fingerprint)throw new Error("Embedding runtime/checkpoint identity changed; delete the old index and rebuild from scratch");
    const embedded=new Map(documents.map(d=>[d.id,d]));documents.length=0;
    for(const d of corpus.documents){const own=embedded.get(d.id),old=reusable.get(`${d.id}:${d.textHash}`);documents.push(own??{...d,vector:old!.vector});}
    evidence={...evidence,incremental:{reused:corpus.documents.length-embedded.size,embedded:embedded.size}};
    if((await registry.corpus()).hash!==corpus.hash)throw new Error("Library changed during indexing; rebuild from the current scripts");
    const index=SemanticIndex.parse({schemaVersion:1,fingerprint,configHash:embeddingConfigHash(task!.config),corpusHash:corpus.hash,documents,coverage:corpus.coverage,createdAt:new Date().toISOString(),evidence});
    await writeJsonAtomic(ctx.store.p("studio","semantic","index.json"),index);
    return {documents:documents.length,incremental:evidence.incremental,coverage:corpus.coverage,fingerprint,device:evidence?.device??null,meaningRightsOriginalityCertified:false};
   },{waitMs:7200000,ttlMs:60000,purpose:"Build derived semantic index"});
   task=await registry.save({...task,state:"ready",result,error:null});
  }else{
   const index=await registry.index(),corpus=await registry.corpus();
   if(!index||index.corpusHash!==corpus.hash||index.configHash!==embeddingConfigHash(task.config))throw new Error("Semantic index is stale; rebuild before searching");
   const response=await embed([{id:"query",text:task.query,role:"query"}],"query");
   if(response.fingerprint!==index.fingerprint)throw new Error("Embedding runtime/checkpoint identity changed; rebuild before searching");
   if(response.documents?.[0]?.id!=="query"||response.documents[0].textSha256!==embeddingTextHash(task.query))throw new Error("Embedding query text identity changed");
   const vector=SemanticVector.parse(response.documents?.[0]?.vector);
   const ranked=index.documents.map(doc=>({doc,score:doc.vector.reduce((total,x,i)=>total+x*vector[i],0)})).sort((a,b)=>b.score-a.score||a.doc.id.localeCompare(b.doc.id));
   const seen=new Set<string>(),matches=[];
   for(const row of ranked){if(seen.has(row.doc.runId))continue;seen.add(row.doc.runId);matches.push({runId:row.doc.runId,title:row.doc.title,language:row.doc.language,score:row.score,excerpt:row.doc.text.slice(0,600),chunk:row.doc.chunk});if(matches.length===10)break;}
   if((await registry.corpus()).hash!==corpus.hash)throw new Error("Library changed during search; rebuild the index");
   task=await registry.save({...task,state:"ready",result:{matches,fingerprint:index.fingerprint,indexCreatedAt:index.createdAt,device:response.device,meaningRightsOriginalityCertified:false},error:null});
  }
  return {taskId:id,state:task.state};
 }catch(error:any){
  const waiting=["GPU_BUSY","RAM_BUSY","ENGINE_COOLDOWN","STUDIO_PAUSED"].includes(error.code);
  await registry.save({...task,state:waiting?"queued":"failed",error:String(error.message??error)});
  if(waiting)throw error;
  throw new FactoryError("SEMANTIC_REVIEW","HUMAN_REQUIRED",String(error.message??error));
 }
}
