import https from "node:https";
import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
import {createHash} from "node:crypto";
import {FactoryError} from "@ttm/core";
import {htmlToText} from "./factcheck.js";
export function publicAddress(address:string):boolean{
 const ip=address.toLowerCase().replace(/^\[|\]$/g,"");
 if(isIP(ip)===4){const [a,b,c]=ip.split(".").map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&(c===0||c===2)||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
 if(isIP(ip)===6){if(ip.startsWith("::ffff:")){const rest=ip.slice(7);if(isIP(rest)===4)return publicAddress(rest);return false;}return /^[23]/.test(ip)&&!ip.startsWith("2001:db8:")&&!ip.startsWith("2002:")&&!ip.startsWith("2001:0:");}
 return false;
}
export function publicSourceUrl(value:string){
 const u=new URL(value);const host=u.hostname.replace(/^\[|\]$/g,"").toLowerCase();
 if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443")||host==="localhost"||host.endsWith(".local")||host.endsWith(".internal")||isIP(host)&&!publicAddress(host))throw new FactoryError("SOURCE_ADDRESS","BLOCKED","Only public HTTPS source URLs are allowed / Chỉ nhận URL nguồn HTTPS công khai");
 return u;
}
type SourceResponse={status:number;headers:Record<string,string>;body:string};
async function requestPublic(u:URL,maxBytes:number,timeoutMs:number):Promise<SourceResponse>{
 return new Promise((resolve,reject)=>{
  const req=https.get(u,{headers:{"user-agent":"AutonomousCreativeStudio/0.2 (local source research)",accept:"text/html,application/json,text/plain,application/rss+xml,application/atom+xml","accept-encoding":"identity"},
   lookup:((hostname:any,options:any,callback:any)=>{lookup(hostname,{all:true,verbatim:true}).then(addresses=>{if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error("Public source DNS resolved to a non-public address");if(options?.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);}).catch(error=>callback(error));}) as any,
  },res=>{const chunks:Buffer[]=[];let size=0;res.on("data",chunk=>{size+=chunk.length;if(size>maxBytes){req.destroy(new Error("Source exceeds size limit"));return;}chunks.push(Buffer.from(chunk));});res.on("error",reject);res.on("end",()=>resolve({status:res.statusCode??0,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(","):v??""])),body:Buffer.concat(chunks).toString("utf8")}));});
  const timer=setTimeout(()=>req.destroy(new Error("Source request timed out")),timeoutMs);req.once("close",()=>clearTimeout(timer));req.on("error",reject);
 });
}
export async function fetchPublicSource(url:string,options:{maxBytes?:number;timeoutMs?:number;transport?:(u:URL,maxBytes:number,timeoutMs:number)=>Promise<SourceResponse>}={}){
 let current=publicSourceUrl(url);const max=options.maxBytes??2*1024*1024;
 for(let redirects=0;redirects<=3;redirects++){
  const response=await (options.transport??requestPublic)(current,max,options.timeoutMs??20000);
  if([301,302,303,307,308].includes(response.status)){if(!response.headers.location)throw new Error("Redirect without location");current=publicSourceUrl(new URL(response.headers.location,current).href);continue;}
  if(response.status!==200)throw new FactoryError("SOURCE_HTTP",response.status===429||response.status>=500?"RETRYABLE":"HUMAN_REQUIRED",`Source HTTP ${response.status}: ${current.hostname}`);
  if(Buffer.byteLength(response.body)>max)throw new Error("Source exceeds size limit");
  const mime=response.headers["content-type"]??"text/html";if(!/text\/|application\/(?:json|rss\+xml|atom\+xml|xml)/i.test(mime))throw new Error("Source is not a supported text document");
  if(response.headers["content-encoding"]&&response.headers["content-encoding"]!=="identity")throw new Error("Source returned unsupported compressed content");
  const html=response.body,title=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim()??current.hostname;
  const main=/<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1]??/<article[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1]??html;
  const text=htmlToText(main.replace(/<(nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi," "));
  return{url:current.href,requestedUrl:url,domain:current.hostname,title:htmlToText(title),fetchedAt:new Date().toISOString(),mime,sha256:createHash("sha256").update(html).digest("hex"),text,html};
 }
 throw new Error("Too many source redirects");
}
