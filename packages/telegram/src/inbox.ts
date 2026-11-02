import * as fs from "node:fs/promises";
import {z} from "zod";
import {DataStore,readJson,writeJsonAtomic,withLock,redact} from "@ttm/storage";
export const TelegramReceipt=z.object({updateId:z.number().int().nonnegative(),chatId:z.string(),userId:z.string(),text:z.string().max(10000),state:z.enum(["received","running","done","uncertain"]),reply:z.string().nullable().default(null),replyQueued:z.boolean().default(false),attempts:z.number().int().nonnegative().default(0),createdAt:z.string(),updatedAt:z.string()});
export type TelegramReceipt=z.infer<typeof TelegramReceipt>;
/** Receive durably before advancing the polling offset. External side effects are never blindly replayed. */
export class TelegramInbox{
 constructor(readonly store:DataStore){}
 file(id:number,sub:"pending"|"archive"="pending"){z.number().int().nonnegative().parse(id);return this.store.p("telegram","inbox",sub,`${id}.json`);}
 async get(id:number){return await readJson(this.file(id,"archive"),TelegramReceipt)??await readJson(this.file(id),TelegramReceipt)??await readJson(this.store.p("telegram","inbox",`${id}.json`),TelegramReceipt);}
 private async save(row:TelegramReceipt){
  const archived=["done","uncertain"].includes(row.state)&&row.replyQueued;
  await writeJsonAtomic(this.file(row.updateId,archived?"archive":"pending"),row,{keepBackup:false});
  if(archived)await fs.rm(this.file(row.updateId),{force:true});await fs.rm(this.store.p("telegram","inbox",`${row.updateId}.json`),{force:true});return row;
 }
 async receive(value:{updateId:number;chatId:string;userId:string;text:string}){
  return withLock(this.store.p("locks",`telegram-in-${value.updateId}.lock`),async()=>{
   const old=await this.get(value.updateId);if(old)return old;const now=new Date().toISOString(),row=TelegramReceipt.parse({...value,text:redact(value.text),state:"received",createdAt:now,updatedAt:now});return this.save(row);
  });
 }
 async pending(){
  // Upgrade flat receipts without scanning archived history on every polling cycle.
  for(const name of await fs.readdir(this.store.p("telegram","inbox")).catch(()=>[] as string[]))if(/^\d+\.json$/.test(name)){const id=Number(name.slice(0,-5));await withLock(this.store.p("locks",`telegram-in-${id}.lock`),async()=>{const row=await this.get(id);if(row)await this.save(row);});}
  const names=await fs.readdir(this.store.p("telegram","inbox","pending")).catch(()=>[] as string[]),rows=[];
  for(const name of names.filter(n=>/^\d+\.json$/.test(n))){const row=await this.get(Number(name.slice(0,-5)));if(row&&(!["done","uncertain"].includes(row.state)||!row.replyQueued))rows.push(row);}
  return rows.sort((a,b)=>a.updateId-b.updateId);
 }
 async markReplyQueued(id:number){return withLock(this.store.p("locks",`telegram-in-${id}.lock`),async()=>{const row=await this.get(id);if(row&&["done","uncertain"].includes(row.state))await this.save({...row,replyQueued:true});});}
 async process(id:number,handler:(row:TelegramReceipt)=>Promise<string|null>,replaySafe:(text:string)=>boolean){
  return withLock(this.store.p("locks",`telegram-in-${id}.lock`),async()=>{
   let row=await this.get(id);if(!row)throw new Error("Telegram receipt missing");if(row.state==="done"||row.state==="uncertain")return row;
   if(row.state==="running"&&!replaySafe(row.text)){
    row={...row,state:"uncertain",reply:"Lệnh trước bị ngắt giữa chừng. Hãy kiểm tra trạng thái trước khi gửi lại; app không tự lặp thao tác chưa rõ kết quả.",updatedAt:new Date().toISOString()};
    await this.save(row);await this.store.audit({actor:"telegram",action:"telegram.command_uncertain",subject:String(id)});return row;
   }
   row={...row,state:"running",attempts:row.attempts+1,updatedAt:new Date().toISOString()};await this.save(row);
   const reply=await handler(row);row={...row,state:"done",reply:reply?redact(reply):null,updatedAt:new Date().toISOString()};return this.save(row);
  });
 }
}
