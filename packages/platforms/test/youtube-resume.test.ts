import {describe,it,expect} from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import {tmpDir} from "../../storage/test/helpers.js";
import {YouTubePublisher,type PublishPackage,type UploadState} from "../src/index.js";
const response=(data:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers});
async function fixture(){const file=path.join(await tmpDir(),"contract-fixture.mp4");await fs.writeFile(file,Buffer.alloc(100,1));const pkg:PublishPackage={projectId:"fixture",idempotencyKey:"fixture:en:r1",videoFile:file,videoSha256:"test-bytes-not-real-media",thumbnailFile:null,title:"Fixture",description:"Protocol test, no public upload",tags:[],privacy:"private",publishAt:null,containsSyntheticMedia:true,madeForKids:false,language:"en-US"};return pkg;}
describe("YouTube resumable reconciliation protocol (mock transport only)",()=>{
 it("persists session before bytes, reconciles a lost final response, persists remote ID and never creates a duplicate",async()=>{
  const pkg=await fixture();let uploads=0,puts=0,state:UploadState|undefined,metadata:any;
  const transport=async(url:string,init?:RequestInit)=>{
   if(url.includes("oauth2.googleapis.com/token"))return response({access_token:"test-only",expires_in:3600});
   if(url.includes("upload/youtube")){uploads++;metadata=JSON.parse(String(init?.body));return response({},200,{location:"https://www.googleapis.com/upload/fixture-session"});}
   if(url.endsWith("fixture-session")){
    if((init?.headers as any)?.["content-range"]?.startsWith("bytes */"))return response({id:"REMOTE_FIXTURE",status:{uploadStatus:"processed",privacyStatus:"private"}});
    expect(state?.sessionUri).toBe(url);puts++;throw new Error("connection dropped after provider committed video");
   }throw new Error(`Unexpected mock request ${url}`);
  };
  const publisher=new YouTubePublisher("youtube_long",{clientId:"c",clientSecret:"s",refreshToken:"r"},{fetchImpl:transport as any}),persist=async(s:UploadState)=>{state=s;};
  await expect(publisher.upload(pkg,persist)).rejects.toThrow("connection dropped");expect(state?.sessionUri).toBeTruthy();expect((await publisher.upload(pkg,persist,state)).status).toBe("PUBLISHED");expect(state?.remoteId).toBe("REMOTE_FIXTURE");expect(uploads).toBe(1);expect(puts).toBe(1);expect(metadata.snippet.defaultAudioLanguage).toBe("en-US");
 });
 it("holds expired/ambiguous sessions instead of silently initiating another upload",async()=>{
  const pkg=await fixture();for(const status of[404,410,500]){let initiated=false;const transport=async(url:string)=>{if(url.includes("oauth2.googleapis.com/token"))return response({access_token:"a"});if(url.includes("fixture-session"))return response({},status);initiated=true;return response({});};const publisher=new YouTubePublisher("youtube_long",{clientId:"c",clientSecret:"s",refreshToken:"r"},{fetchImpl:transport as any});await expect(publisher.upload(pkg,async()=>{},{sessionUri:"https://www.googleapis.com/fixture-session"})).rejects.toThrow();expect(initiated).toBe(false);}
 });
 it("resumes partial bytes from acknowledged offset and persists completion",async()=>{
  const pkg=await fixture();let range="",state:UploadState|undefined;const transport=async(url:string,init?:RequestInit)=>{if(url.includes("oauth2.googleapis.com/token"))return response({access_token:"a"});const header=(init?.headers as any)?.["content-range"];if(header.startsWith("bytes */"))return response({},308,{range:"bytes=0-49"});range=header;return response({id:"RESUMED_FIXTURE",status:{uploadStatus:"processed",privacyStatus:"private"}});};const publisher=new YouTubePublisher("youtube_long",{clientId:"c",clientSecret:"s",refreshToken:"r"},{fetchImpl:transport as any});await publisher.upload(pkg,async s=>{state=s;},{sessionUri:"https://www.googleapis.com/fixture-session"});expect(range).toBe("bytes 50-99/100");expect(state?.remoteId).toBe("RESUMED_FIXTURE");
 });
});
