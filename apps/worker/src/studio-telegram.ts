import path from "node:path";
import * as fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {z} from "zod";
import {StudioStore,StudioReviewStore,StudioPublishingStore,ReviewCategory} from "@ttm/automation";
import {readJson,writeJsonAtomic,withLock} from "@ttm/storage";
import {runProcess} from "@ttm/media";
import type {TelegramReceipt} from "@ttm/telegram";
import type {Ctx} from "./context.js";
const Confirmation=z.object({id:z.string().uuid(),chatId:z.string(),userId:z.string(),runId:z.string().uuid(),category:ReviewCategory,decision:z.enum(["APPROVED","REJECTED"]),fingerprint:z.string(),evidence:z.string().min(12),highRiskAcknowledged:z.boolean(),expiresAt:z.string(),consumedAt:z.string().nullable()});
const uuid=(value:string)=>z.string().uuid().safeParse(value).success;
async function fileHash(file:string){const hash=createHash("sha256");for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest("hex");}
const requestUuid=(key:string)=>{const bytes=createHash("sha256").update(key).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;const hex=bytes.toString("hex");return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;};
/** Runs before the legacy job router. UUID commands refer to Studio output versions. */
export class StudioTelegramRouter{
 constructor(readonly ctx:Ctx,readonly now:()=>number=Date.now){}
 async handle(receipt:TelegramReceipt):Promise<{handled:boolean;reply:string|null}>{
  const [raw,...args]=receipt.text.trim().split(/\s+/),cmd=raw?.replace(/^\//,"").replace(/@.*$/,"").toLowerCase();
  const supported=cmd==="studio_confirm"||["preview","publish_status","review","approve","reject"].includes(cmd)&&uuid(args[0]??"");if(!supported)return{handled:false,reply:null};
  const settings=await this.ctx.settings();if(!settings.telegram.enabled||!settings.telegram.allowedChatIds.includes(receipt.chatId)||!settings.telegram.allowedUserIds.includes(receipt.userId))return{handled:true,reply:"Chat hoặc người dùng chưa được cấp quyền."};
  const review=new StudioReviewStore(this.ctx.store),studio=new StudioStore(this.ctx.store),actor=`telegram:${receipt.userId}`;
  const reply=(text:string)=>({handled:true,reply:text});
  if(cmd==="studio_confirm"){
   const id=args[0];if(!uuid(id??""))return reply("Mã xác nhận không hợp lệ.");
   return withLock(this.ctx.store.p("locks",`studio-tg-${id}.lock`),async()=>{
    const file=this.ctx.store.p("studio","telegram-confirm",`${id}.json`),challenge=await readJson(file,Confirmation);if(!challenge||challenge.chatId!==receipt.chatId||challenge.userId!==receipt.userId)return reply("Mã xác nhận không đúng người dùng/chat.");
    if(challenge.consumedAt)return reply("Quyết định này đã được ghi nhận; không đăng video hoặc lặp thao tác.");
    if(Date.parse(challenge.expiresAt)<this.now())return reply("Mã đã hết hạn. Xem /review và tạo yêu cầu mới.");
    try{await review.decide({...challenge,requestId:challenge.id},actor);}catch(error:any){return reply(`Không hoàn tất xác nhận: ${error.message}. Kiểm tra /review ${challenge.runId}; không tự đăng hoặc bỏ qua cổng bằng chứng.`);}await writeJsonAtomic(file,{...challenge,consumedAt:new Date(this.now()).toISOString()});
    return reply(`Đã ghi ${challenge.decision} cho ${challenge.category}, phiên bản ${challenge.runId}. Duyệt nội dung không cấp quyền đăng. Xem /publish_status ${challenge.runId}`);
   });
  }
  const run=await studio.run(args[0]);if(!run)return reply("Không tìm thấy phiên bản Studio.");
  if(cmd==="publish_status"){
   const publications=(await new StudioPublishingStore(this.ctx.store).list()).filter(p=>p.runId===run.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
   if(!publications.length)return reply(`${run.title}\n${run.language} · ${run.state}\nChưa có hồ sơ đăng hoặc ID từ nền tảng. Local export không đồng nghĩa đã đăng.`);
   // Report persisted reconciliation only. Never expose resumable session URLs, credentials or raw provider errors.
   return reply([`${run.title} · ${run.language}`,`Version: ${run.id}`,...publications.slice(0,8).map(p=>[
    `${p.channel.name} · ${p.channel.platform}: ${p.state}`,
    `ID: ${p.remoteId??"unknown"} · Visibility: ${p.actualPrivacy??"unknown"}`,
    p.url?`Link: ${p.url}`:"Chưa có link được đối soát.",
    `Cập nhật: ${p.updatedAt}`,
   ].join("\n")),publications.length>8?`Còn ${publications.length-8} hồ sơ trong Channels & Accounts.`:"",`Trạng thái lưu từ lần đối soát gần nhất; available không có nghĩa public. Lệnh này không đăng hoặc thử lại upload.`].filter(Boolean).join("\n\n"));
  }
  const context=await review.context(run.id);
  if(cmd==="review")return reply([`${run.title} · ${run.language}`,`Version: ${run.id}`,`Hash: ${context.fingerprint}`,...context.gates.map(g=>`${g.category}: ${g.status}`),`Xem video: /preview ${run.id}`,`Duyệt một phạm vi: /approve ${run.id} editorial ${context.fingerprint} GHI_CHU_BANG_CHUNG`,`Phạm vi: editorial | voice | facts | rights. Claims rủi ro cao cần --high-risk và nguồn trong ghi chú. Duyệt không đăng video.`].join("\n"));
  if(cmd==="preview"){
   if(run.state!=="ready"||!run.outputs.includes("final.mp4"))return reply("Video chưa sẵn sàng. Xem /review để biết trạng thái.");
   const dir=this.ctx.store.p("studio","artifacts",run.id),original=path.join(dir,"final.mp4"),previewDir=this.ctx.store.p("studio","telegram-previews",run.id),file=path.join(previewDir,`${context.videoHash}.mp4`),manifest=path.join(previewDir,`${context.videoHash}.json`);await fs.mkdir(previewDir,{recursive:true});
   const cached=await fs.readFile(manifest,"utf8").then(JSON.parse,()=>null);
   if(cached?.sourceSha256!==context.videoHash||cached?.previewSha256!==await fileHash(file).catch(()=>null)){
    const partial=file.replace(/\.mp4$/,".partial.mp4");
    if((await fs.stat(original)).size>45*1024*1024){const result=await runProcess(run.config.ffmpeg,["-y","-i",original,"-t","15","-vf","scale=360:640:force_original_aspect_ratio=decrease,pad=360:640:(ow-iw)/2:(oh-ih)/2","-c:v","libx264","-preset","fast","-crf","27","-c:a","aac","-b:a","64k",partial],{timeoutMs:120000});if(result.code)throw new Error("Không tạo được preview Telegram; bản gốc vẫn được giữ.");}
    else await fs.copyFile(original,partial);
    if(await fileHash(original)!==context.videoHash)throw new Error("Video thay đổi trong khi tạo preview; cần xem lại phiên bản hiện tại");await fs.rename(partial,file);await writeJsonAtomic(manifest,{sourceSha256:context.videoHash,previewSha256:await fileHash(file),createdAt:new Date(this.now()).toISOString()});
   }
   await this.ctx.outbox.enqueueOnce(`studio-preview:${receipt.updateId}`,{chatId:receipt.chatId,kind:"video",file,text:`${run.title} · ${run.language}\nDRAFT · ${run.id}\nHash: ${context.fingerprint}\nNội dung còn cần duyệt; chưa đăng công khai.`});return reply("Đã xếp preview vào outbox riêng cho chat này.");
  }
  const category=ReviewCategory.safeParse(args[1]);if(!category.success||args[2]!==context.fingerprint)return reply(`Cần đúng scope và hash hiện tại. Dùng /review ${run.id} rồi /${cmd} RUN_ID SCOPE HASH GHI_CHU_BANG_CHUNG`);
  const highRiskAcknowledged=args.slice(3).includes("--high-risk"),evidence=args.slice(3).filter(s=>s!=="--high-risk").join(" ");if(evidence.length<12)return reply("Ghi chú bằng chứng / lý do cần ít nhất 12 ký tự.");
  if(context.gates.find(g=>g.category===category.data)?.status==="BLOCKED"&&cmd==="approve")return reply("Trích dẫn không có trong bằng chứng. Cần sửa nguồn/kịch bản; không thể bỏ qua bằng approval.");
  const id=requestUuid(`studio-approval:${receipt.updateId}:${receipt.userId}`),file=this.ctx.store.p("studio","telegram-confirm",`${id}.json`);
  if(!await readJson(file,Confirmation))await writeJsonAtomic(file,Confirmation.parse({id,chatId:receipt.chatId,userId:receipt.userId,runId:run.id,category:category.data,decision:cmd==="approve"?"APPROVED":"REJECTED",fingerprint:context.fingerprint,evidence,highRiskAcknowledged,expiresAt:new Date(this.now()+120000).toISOString(),consumedAt:null}));
  return reply(`Xác nhận ${cmd} phạm vi ${category.data}, phiên bản ${run.id}:\n/studio_confirm ${id}\nTrong 2 phút, đúng người dùng/chat. Thao tác không tự đăng video.`);
 }
}
