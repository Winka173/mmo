import {afterEach,describe,it,expect} from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {FileLock} from "../src/lock.js";

describe("Read-only process-lock health, not existence-based worker status",()=>{
 const folders:string[]=[];
 afterEach(async()=>{for(const folder of folders.splice(0)){const target=path.resolve(folder);if(!target.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(target).startsWith("acs-worker-health-"))throw new Error("Unsafe fixture path");await fs.rm(target,{recursive:true,force:true});}});
 async function fixture(){const folder=await fs.mkdtemp(path.join(os.tmpdir(),"acs-worker-health-"));folders.push(folder);return path.join(folder,"worker.lock");}
 const current=()=>({pid:process.pid,host:os.hostname(),acquiredAt:new Date().toISOString(),heartbeatAt:new Date().toISOString(),purpose:"worker"});
 it("distinguishes missing/malformed/invalid/future records without creating, changing or removing files",async()=>{
  const file=await fixture(),lock=new FileLock(file);
  expect((await lock.health()).status).toBe("missing");
  for(const raw of ["{",JSON.stringify({...current(),pid:-4}),JSON.stringify({...current(),heartbeatAt:"invalid"}),JSON.stringify(null)]){
   await fs.writeFile(file,raw);expect((await lock.health()).status).toBe("invalid");expect(await fs.readFile(file,"utf8")).toBe(raw);
  }
  const future={...current(),heartbeatAt:new Date(Date.now()+60000).toISOString()};await fs.writeFile(file,JSON.stringify(future));expect((await lock.health()).status).toBe("unknown");
 });
 it("requires local liveness and a fresh heartbeat; a suspended live owner is unresponsive, not dead",async()=>{
  const file=await fixture(),lock=new FileLock(file,{ttlMs:1000}),info=current();await fs.writeFile(file,JSON.stringify(info));expect((await lock.health()).status).toBe("online");
  const old={...info,heartbeatAt:"2020-01-01T00:00:00Z"};await fs.writeFile(file,JSON.stringify(old));expect((await lock.health()).status).toBe("unresponsive");expect(await lock.read()).toEqual(old);
 });
 it("does not label a remote host online or a reused PID as a healthy worker",async()=>{
  const file=await fixture(),lock=new FileLock(file,{ttlMs:1000});await fs.writeFile(file,JSON.stringify({...current(),host:"different-host"}));expect((await lock.health()).status).toBe("remote");
  const old={...current(),acquiredAt:"2020-01-01T00:00:00Z",heartbeatAt:"2020-01-01T00:00:00Z"};await fs.writeFile(file,JSON.stringify(old));expect((await lock.health()).status).toBe("dead");expect(await lock.read()).toEqual(old);
 });
 it("detects an actual independent worker process death immediately while its lock remains",async()=>{
  const file=await fixture(),lock=new FileLock(file),child=spawn(process.execPath,["-e","console.log('ready');setInterval(()=>{},1000)"],{windowsHide:true,stdio:["ignore","pipe","ignore"]});
  try{
   await new Promise<void>((resolve,reject)=>{child.stdout!.once("data",()=>resolve());child.once("error",reject);});
   const info={...current(),pid:child.pid!};await fs.writeFile(file,JSON.stringify(info));expect((await lock.health()).status).toBe("online");
   const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill();await exited;
   expect((await lock.health()).status).toBe("dead");expect(await lock.read()).toEqual(info);
  }finally{if(child.exitCode===null)child.kill();}
 });
});
