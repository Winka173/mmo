import {randomUUID,createHash} from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {DataStore,readJson,writeJsonAtomic,withLock} from "@ttm/storage";
import {FileQueue} from "./queue.js";
import {StudioPublishingStore,StudioChannel} from "./studio-publishing.js";
import {sanitizeComment,classifyComment,CommentAssistant,type FaqEntry} from "../../governance/src/comments.js";

/**
 * Non-video posts (text, link, image, carousel) through the same Studio flow as video:
 * create -> two review scopes tied to a content fingerprint -> explicit authorization per post and channel ->
 * publish job -> reconcile -> metrics; manual export is always available. YouTube community posts have no API.
 */
export const POST_KINDS=["text","link","image","carousel"] as const;
const Image=z.object({file:z.string(),name:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/),size:z.number().int().positive()});
const Decision=z.object({category:z.enum(["editorial","rights"]),decision:z.enum(["APPROVED","REJECTED","DEFERRED"]),fingerprint:z.string(),evidence:z.string().min(12).max(4000),at:z.string(),actor:z.string()});
export const StudioPost=z.object({id:z.string().uuid(),title:z.string().trim().min(1).max(160),kind:z.enum(POST_KINDS),text:z.string().trim().max(5000),link:z.string().url().nullable().default(null),images:z.array(Image).max(10).default([]),aiGenerated:z.boolean().default(false),
 decisions:z.array(Decision).default([]),
 publications:z.array(z.object({channelId:z.string().uuid(),channelRevision:z.number().int(),platform:z.string(),fingerprint:z.string(),privacy:z.enum(["private","public"]),state:z.enum(["queued","publishing","processing","available","needs_input","failed"]),remoteId:z.string().nullable().default(null),url:z.string().nullable().default(null),progress:z.record(z.any()).default({}),error:z.string().nullable().default(null),metrics:z.record(z.number().nullable()).nullable().default(null),metricsAt:z.string().nullable().default(null),authorizedAt:z.string()})).default([]),
 createdAt:z.string(),updatedAt:z.string()});
export type StudioPost=z.infer<typeof StudioPost>;
const POST_SUPPORT:Record<string,readonly string[]>={facebook_reels:["text","link","image","carousel"],instagram_reels:["image","carousel"],tiktok:["image","carousel"],youtube_long:[],youtube_shorts:[]};
export const postSupports=(platform:string,kind:string)=>(POST_SUPPORT[platform]??[]).includes(kind);
const sha=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");
export function postFingerprint(p:Pick<StudioPost,"kind"|"text"|"link"|"images">){return sha(JSON.stringify({kind:p.kind,text:p.text,link:p.link,images:p.images.map(i=>i.sha256)}));}

export class StudioPostStore{
 constructor(readonly store:DataStore){}
 dir(id:string){return this.store.p("studio","posts",z.string().uuid().parse(id));}
 get(id:string){return readJson(path.join(this.dir(id),"post.json"),StudioPost);}
 async list(){const root=this.store.p("studio","posts"),names=await fs.readdir(root).catch(()=>[] as string[]);return (await Promise.all(names.filter(n=>/^[0-9a-f-]{36}$/.test(n)).map(n=>this.get(n)))).filter(Boolean).sort((a,b)=>b!.createdAt.localeCompare(a!.createdAt)) as StudioPost[];}
 async save(p:StudioPost){p=StudioPost.parse({...p,updatedAt:new Date().toISOString()});await writeJsonAtomic(path.join(this.dir(p.id),"post.json"),p);return p;}
 /** Images are copied and hashed once; later edits create a new fingerprint, so earlier approvals no longer apply. */
 async create(input:unknown,files:{name:string;bytes:Buffer}[]=[]){
  const v=z.object({title:z.string().trim().min(1).max(160),kind:z.enum(POST_KINDS),text:z.string().trim().max(5000).default(""),link:z.string().url().nullable().default(null),aiGenerated:z.boolean().default(false)}).parse(input);
  if(v.kind==="link"&&!v.link)throw new Error("A link post needs a URL");if(v.kind==="text"&&!v.text)throw new Error("A text post needs text");
  if(v.kind==="image"&&files.length!==1)throw new Error("A single-image post needs exactly one image");if(v.kind==="carousel"&&(files.length<2||files.length>10))throw new Error("A carousel needs 2 to 10 images");
  if(["text","link"].includes(v.kind)&&files.length)throw new Error("Text and link posts have no images");
  const id=randomUUID(),dir=this.dir(id),images=[];await fs.mkdir(dir,{recursive:true});
  for(const [i,f] of files.entries()){if(!/\.(jpe?g|png|webp)$/i.test(f.name)||f.bytes.length>8*2**20)throw new Error("Images must be JPG/PNG/WebP up to 8 MB");const name=`${String(i+1).padStart(2,"0")}${path.extname(f.name).toLowerCase()}`,file=path.join(dir,name);await fs.writeFile(file,f.bytes,{flag:"wx"});images.push({file,name,sha256:sha(f.bytes),size:f.bytes.length});}
  const now=new Date().toISOString();return this.save(StudioPost.parse({...v,id,images,createdAt:now,updatedAt:now}));
 }
 approved(p:StudioPost){const fp=postFingerprint(p);return (["editorial","rights"] as const).every(c=>p.decisions.filter(d=>d.category===c).at(-1)?.decision==="APPROVED"&&p.decisions.filter(d=>d.category===c).at(-1)?.fingerprint===fp);}
 async decide(id:string,input:unknown){
  const v=z.object({category:z.enum(["editorial","rights"]),decision:z.enum(["APPROVED","REJECTED","DEFERRED"]),fingerprint:z.string(),evidence:z.string().trim().min(12).max(4000)}).parse(input);
  return withLock(this.store.p("locks",`post-${id}.lock`),async()=>{const p=await this.get(id);if(!p)throw new Error("Post not found");if(v.fingerprint!==postFingerprint(p))throw new Error("The post changed. Reload first.");
   const next=await this.save({...p,decisions:[...p.decisions,{...v,at:new Date().toISOString(),actor:"studio-ui"}]});await this.store.audit({actor:"studio-ui",action:`post.review.${v.decision}`,subject:id,detail:{category:v.category}});return next;});
 }
 /** Authorization per post and channel. Requires both reviews, an enabled channel that supports this post type, and Studio posting enabled. */
 async request(id:string,input:unknown){
  const v=z.object({channelId:z.string().uuid(),privacy:z.enum(["private","public"]),authorize:z.literal(true)}).parse(input);
  return withLock(this.store.p("locks",`post-${id}.lock`),async()=>{
   const p=await this.get(id),publishing=new StudioPublishingStore(this.store),channel=await publishing.channel(v.channelId);if(!p)throw new Error("Post not found");
   if(!channel?.enabled)throw new Error("Channel is disabled or missing");if(!postSupports(channel.platform,p.kind))throw new Error(channel.platform.startsWith("youtube")?"YouTube community posts have no official API; use the manual export package":`${channel.platform} does not support ${p.kind} posts through its API`);
   if(channel.platform==="instagram_reels"&&v.privacy!=="public")throw new Error("Instagram publishes posts publicly only");
   if(!this.approved(p))throw new Error("Editorial and rights reviews must approve this exact post first");
   const settings=await this.store.getSettings();if(!await publishing.postingEnabled()||settings.paused||settings.killSwitch)throw new Error("Studio posting must be explicitly enabled and production resumed");
   const fp=postFingerprint(p),old=p.publications.find(x=>x.channelId===channel.id&&x.fingerprint===fp);if(old)return {id,channelId:channel.id,state:old.state};
   await this.save({...p,publications:[...p.publications,{channelId:channel.id,channelRevision:channel.revision,platform:channel.platform,fingerprint:fp,privacy:v.privacy,state:"queued",remoteId:null,url:null,progress:{},error:null,metrics:null,metricsAt:null,authorizedAt:new Date().toISOString()}]});
   await this.store.audit({actor:"studio-ui",action:"post.publish.authorized",subject:id,detail:{channelId:channel.id,privacy:v.privacy}});
   await new FileQueue(this.store).enqueue({kind:"STUDIO_POST_PUBLISH",idempotencyKey:`studio-post:${id}:${channel.id}:${fp}`,payload:{postId:id,channelId:channel.id},usesGpu:false,maxAttempts:5});
   return {id,channelId:channel.id,state:"queued"};
  });
 }
 /** Manual export: images + caption + manifest with review state; usable for YouTube community posts and any platform. */
 async exportBundle(id:string){
  const p=await this.get(id);if(!p)throw new Error("Post not found");
  const manifest={product:"AUTONOMOUS CREATIVE STUDIO",postId:p.id,kind:p.kind,fingerprint:postFingerprint(p),reviewsApproved:this.approved(p),aiGenerated:p.aiGenerated,link:p.link,images:p.images.map(i=>({name:i.name,sha256:i.sha256})),note:"Manual posting package. Post with the platform's official app or website; ACS did not post this."};
  return {entries:[{name:"caption.txt",data:Buffer.from(`${p.text}${p.link?`\n\n${p.link}`:""}${p.aiGenerated?"\n\n#AI-generated":""}\n`,"utf8")},{name:"manifest.json",data:Buffer.from(JSON.stringify(manifest,null,2))},...p.images.map(i=>({name:i.name,file:i.file,sha256:i.sha256}))],root:this.dir(id)};
 }
}

/** Facebook Page inbox and comments: synced read-only, a sanitized draft from the comment assistant, owner approval before any send. */
export const InboxItem=z.object({id:z.string(),channelId:z.string().uuid(),kind:z.enum(["message","comment"]),threadId:z.string(),postId:z.string().nullable(),authorId:z.string(),author:z.string(),text:z.string(),at:z.string(),sanitized:z.string(),injectionSuspected:z.boolean(),class:z.string(),escalate:z.boolean(),draft:z.string().default(""),state:z.enum(["new","approved","sending","sent","dismissed","failed"]).default("new"),replyId:z.string().nullable().default(null),error:z.string().nullable().default(null),approvedText:z.string().nullable().default(null)});
export type InboxItem=z.infer<typeof InboxItem>;
export class PageInboxStore{
 constructor(readonly store:DataStore){}
 private file(){return this.store.p("studio","inbox.json");}
 async list(){return (await readJson(this.file(),z.array(InboxItem)))??[];}
 private async write(rows:InboxItem[]){await writeJsonAtomic(this.file(),rows.slice(-500));}
 /** Merge fetched items; existing decisions are kept. Incoming text is data, never instructions. */
 async merge(channelId:string,items:{kind:"message"|"comment";id:string;threadId:string;postId:string|null;authorId:string;author:string;text:string;at:string}[],faq:FaqEntry[]=[]){
  return withLock(this.store.p("locks","inbox.lock"),async()=>{const rows=await this.list(),known=new Set(rows.map(r=>r.id)),assistant=new CommentAssistant(this.store,{autoReplyEnabled:false,maxRepliesPerDay:0,cooldownMinutes:60});let added=0;
   for(const it of items){if(known.has(it.id))continue;const s=sanitizeComment(it.text),cls=classifyComment(s.text),d=await assistant.decide({id:it.id,platform:"facebook",remotePostId:it.postId??it.threadId,projectId:null,author:it.author,text:it.text,at:it.at,ownedMedia:true},faq);
    rows.push(InboxItem.parse({...it,channelId,sanitized:s.text,injectionSuspected:s.injection,class:cls,escalate:d.escalate,draft:d.draft??""}));added++;}
   await this.write(rows);return {added};});
 }
 async approve(id:string,text:string){return withLock(this.store.p("locks","inbox.lock"),async()=>{const rows=await this.list(),row=rows.find(r=>r.id===id);if(!row)throw new Error("Item not found");if(!["new","failed"].includes(row.state))throw new Error("Already handled");const reply=z.string().trim().min(1).max(2000).parse(text);
  row.state="approved";row.approvedText=reply;await this.write(rows);await this.store.audit({actor:"studio-ui",action:"inbox.reply.approved",subject:id,detail:{kind:row.kind}});
  await new FileQueue(this.store).enqueue({kind:"STUDIO_INBOX_SEND",idempotencyKey:`inbox-send:${id}`,payload:{itemId:id},usesGpu:false,maxAttempts:3});return row;});}
 async dismiss(id:string){return withLock(this.store.p("locks","inbox.lock"),async()=>{const rows=await this.list(),row=rows.find(r=>r.id===id);if(!row)throw new Error("Item not found");row.state="dismissed";await this.write(rows);return row;});}
 async update(id:string,patch:Partial<InboxItem>){return withLock(this.store.p("locks","inbox.lock"),async()=>{const rows=await this.list(),i=rows.findIndex(r=>r.id===id);if(i<0)throw new Error("Item not found");rows[i]=InboxItem.parse({...rows[i],...patch});await this.write(rows);return rows[i];});}
 async requestSync(channelId:string){const c=await new StudioPublishingStore(this.store).channel(channelId);if(!c||c.platform!=="facebook_reels")throw new Error("Inbox sync needs a Facebook Page channel");return new FileQueue(this.store).enqueue({kind:"STUDIO_INBOX_SYNC",idempotencyKey:`inbox-sync:${channelId}:${new Date().toISOString().slice(0,16)}`,payload:{channelId},usesGpu:false,maxAttempts:2});}
}
export type {StudioChannel};
