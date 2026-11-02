import {describe,it,expect} from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {downloadPinnedRuntime,extractRuntimeArchive,OLLAMA_RUNTIME} from "../src/setup-runtime.js";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
const payload=Buffer.from("verified fixture runtime bytes"),artifact={url:OLLAMA_RUNTIME.url,bytes:payload.length,sha256:createHash("sha256").update(payload).digest("hex")};
describe("Pinned private runtime download",()=>{
 it("resumes a partial file using a checked byte range and verifies the complete SHA-256",async()=>{
  const root=await tmpDir("acs-runtime-resume-"),file=path.join(root,"runtime.zip");await fs.writeFile(file+".acs-partial",payload.subarray(0,8));let request:any;
  const result=await downloadPinnedRuntime(artifact,file,async()=>{},async(_url,options)=>{request=options;return new Response(payload.subarray(8),{status:206,headers:{"content-range":`bytes 8-${payload.length-1}/${payload.length}`,"content-length":String(payload.length-8)}});});
  expect(request.headers.Range).toBe("bytes=8-");expect(result.resumedBytes).toBe(8);expect(await fs.readFile(file)).toEqual(payload);expect(await fs.access(file+".acs-partial").then(()=>true,()=>false)).toBe(false);
 });
 it("restarts safely when the server ignores Range",async()=>{
  const root=await tmpDir("acs-runtime-restart-"),file=path.join(root,"runtime.zip");await fs.writeFile(file+".acs-partial",payload.subarray(0,4));await downloadPinnedRuntime(artifact,file,async()=>{},async()=>new Response(payload,{status:200,headers:{"content-length":String(payload.length)}}));expect(await fs.readFile(file)).toEqual(payload);
 });
 it("rejects a corrupt complete partial before any extraction or request",async()=>{
  const root=await tmpDir("acs-runtime-corrupt-"),file=path.join(root,"runtime.zip");await fs.writeFile(file+".acs-partial",Buffer.alloc(payload.length));let requests=0;await expect(downloadPinnedRuntime(artifact,file,async()=>{},async()=>{requests++;return new Response(payload);})).rejects.toThrow("SHA-256 mismatch");expect(requests).toBe(0);expect(await fs.access(file).then(()=>true,()=>false)).toBe(false);
 });
 it("retains interrupted bytes and resumes on the next bounded attempt",async()=>{
  const root=await tmpDir("acs-runtime-interrupt-"),file=path.join(root,"runtime.zip");let attempts=0,range="",pulls=0;
  await downloadPinnedRuntime(artifact,file,async()=>{},async(_url,options)=>{attempts++;if(attempts===1)return new Response(new ReadableStream({pull(controller){if(pulls++===0)controller.enqueue(payload.subarray(0,7));else controller.error(new Error("network interrupted"));}}),{status:200});range=(options?.headers as any).Range;return new Response(payload.subarray(7),{status:206,headers:{"content-range":`bytes 7-${payload.length-1}/${payload.length}`}});});
  expect(attempts).toBe(2);expect(range).toBe("bytes=7-");expect(await fs.readFile(file)).toEqual(payload);
 });
 it("rejects unexpected ranges and oversized bodies without promoting a final archive",async()=>{
  const root=await tmpDir("acs-runtime-range-"),file=path.join(root,"runtime.zip");await fs.writeFile(file+".acs-partial",payload.subarray(0,5));await expect(downloadPinnedRuntime(artifact,file,async()=>{},async()=>new Response(payload.subarray(5),{status:206,headers:{"content-range":`bytes 0-${payload.length-1}/${payload.length}`}}))).rejects.toThrow("unexpected byte range");expect(await fs.readFile(file+".acs-partial")).toEqual(payload.subarray(0,5));expect(await fs.access(file).then(()=>true,()=>false)).toBe(false);
 });
 it("reuses only an archive matching both the pinned size and SHA-256",async()=>{
  const root=await tmpDir("acs-runtime-reuse-"),file=path.join(root,"runtime.zip");await fs.writeFile(file,payload);const result=await downloadPinnedRuntime(artifact,file,async()=>{},async()=>{throw new Error("must not download");});expect(result.sha256).toBe(artifact.sha256);await fs.writeFile(file,Buffer.alloc(payload.length));await expect(downloadPinnedRuntime(artifact,file,async()=>{})).rejects.toThrow("differs from the official pinned checksum");
 });
});

function fixtureZip(name:string,content=Buffer.from("owned archive fixture")){
 const filename=Buffer.from(name),table=Array.from({length:256},(_,index)=>{let value=index;for(let i=0;i<8;i++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;});let crc=0xffffffff;for(const byte of content)crc=table[(crc^byte)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
 const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);header.writeUInt32LE(content.length,18);header.writeUInt32LE(content.length,22);header.writeUInt16LE(filename.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(content.length,20);central.writeUInt32LE(content.length,24);central.writeUInt16LE(filename.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+filename.length,12);end.writeUInt32LE(header.length+filename.length+content.length,16);return Buffer.concat([header,filename,content,central,filename,end]);
}
describe.skipIf(process.platform!=="win32")("Windows runtime extraction path validation",()=>{
 it("extracts an owned archive into a new Unicode folder with spaces",async()=>{const root=await tmpDir("acs-runtime-extract-"),archive=path.join(root,"fixture.zip"),destination=path.join(root,"Ứng dụng ACS runtime");await fs.writeFile(archive,fixtureZip("lib/ollama/fixture.txt"));await extractRuntimeArchive(archive,destination);expect(await fs.readFile(path.join(destination,"lib","ollama","fixture.txt"),"utf8")).toBe("owned archive fixture");},30000);
 it("rejects traversal before creating an extraction directory",async()=>{const root=await tmpDir("acs-runtime-traversal-"),archive=path.join(root,"fixture.zip"),destination=path.join(root,"runtime");await fs.writeFile(archive,fixtureZip("../foreign.txt"));await expect(extractRuntimeArchive(archive,destination)).rejects.toThrow("Unsafe runtime archive path");expect(await fs.access(destination).then(()=>true,()=>false)).toBe(false);expect(await fs.access(path.join(root,"foreign.txt")).then(()=>true,()=>false)).toBe(false);},30000);
});
