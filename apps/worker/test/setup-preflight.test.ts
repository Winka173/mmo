import {describe,it,expect} from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import {StudioConfig,StudioStore,ModelSetupStore} from "@ttm/automation";
import {setupPreflight} from "../src/setup-preflight.js";
import {executeModelSetup} from "../src/model-setup.js";
import {buildContext} from "../src/context.js";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
const successfulProbe=async(binary:string)=>({code:0,stdout:binary==="nvidia-smi"?"NVIDIA fixture, 999.0, 16384, 12000\n":"fixture version 1",stderr:""});
describe("Selected-profile setup preflight",()=>{
 it("reads a fresh parent without creating folders, loading a model or reserving a GPU",async()=>{
  const parent=await tmpDir("acs-preflight-"),root=path.join(parent,"fresh","ACS"),commands:string[][]=[];
  const result=await setupPreflight({profile:"kokoro",root,config:StudioConfig.parse({})},{freeDiskBytes:100*1024**3,probe:async(binary,args)=>{commands.push([binary,...args]);return successfulProbe(binary);}});
  expect(result.readyToInstall).toBe(true);expect(result.inferenceVerified).toBe(false);expect(result.diskEstimateKind).toBe("CONSERVATIVE_RESERVATION_NOT_BENCHMARK");expect(await fs.readdir(parent)).toEqual([]);
  expect(commands.every(command=>command.includes("--version")||command.includes("-version")||command[0]==="nvidia-smi")).toBe(true);expect(result.checks.find(check=>check.id==="gpu")?.evidence).toMatchObject({modelNotLoaded:true,leaseAcquired:false});
 });
 it("reports actionable disk and uv failures before installation",async()=>{
  const root=await tmpDir("acs-preflight-missing-"),result=await setupPreflight({profile:"vieneu",root,config:StudioConfig.parse({uv:"missing-uv"})},{freeDiskBytes:1024,probe:async(binary)=>binary==="missing-uv"?{code:1,stdout:"",stderr:"missing uv"}:successfulProbe(binary)});
  expect(result.readyToInstall).toBe(false);expect(result.checks.filter(check=>check.blocking).map(check=>check.id)).toEqual(["disk","uv"]);for(const check of result.checks.filter(check=>check.blocking)){expect(check.action?.vi.length).toBeGreaterThan(10);expect(check.action?.en.length).toBeGreaterThan(10);}
 });
 it("keeps explicit CUDA requirements and allows CPU only when selected",async()=>{
  const root=await tmpDir("acs-preflight-device-"),probe=async(binary:string)=>binary==="nvidia-smi"?{code:1,stdout:"",stderr:"no GPU"}:successfulProbe(binary),base={profile:"kokoro" as const,root};
  const cuda=await setupPreflight({...base,config:StudioConfig.parse({ttsDevice:"cuda"})},{freeDiskBytes:100*1024**3,probe}),cpu=await setupPreflight({...base,config:StudioConfig.parse({ttsDevice:"cpu"})},{freeDiskBytes:100*1024**3,probe});
  expect(cuda.readyToInstall).toBe(false);expect(cpu.readyToInstall).toBe(true);expect(cuda.checks.find(check=>check.id==="gpu")?.evidence).toMatchObject({cudaRequested:true});expect(cpu.checks.find(check=>check.id==="gpu")?.status).toBe("warn");
 });
 it("persists a read-only preflight result as checked, never as installed or inference verified",async()=>{
  const parent=await tmpDir("acs-preflight-durable-"),root=path.join(parent,"fresh ACS"),ctx=await buildContext({dataDir:path.join(parent,"data")});await new StudioStore(ctx.store).saveConfig({uv:process.execPath,ttsDevice:"cpu"});
  const registry=new ModelSetupStore(ctx.store),row=await registry.enqueue({profile:"kokoro",root,mode:"preflight"});await executeModelSetup(ctx,row.id);const checked=await registry.get(row.id);
  expect(checked?.state).toBe("checked");expect(checked?.mode).toBe("preflight");expect(checked?.resultConfig).toBeNull();expect((checked?.progress.preflight as any).inferenceVerified).toBe(false);expect(await fs.access(root).then(()=>true,()=>false)).toBe(false);
 });
 it("blocks an install with missing uv before a Python environment or ownership marker is created",async()=>{
  const parent=await tmpDir("acs-preflight-install-"),root=path.join(parent,"ACS"),ctx=await buildContext({dataDir:path.join(parent,"data")});await new StudioStore(ctx.store).saveConfig({uv:path.join(parent,"absent-uv.exe"),ttsDevice:"cpu"});
  const registry=new ModelSetupStore(ctx.store),row=await registry.enqueue({profile:"kokoro",root});await expect(executeModelSetup(ctx,row.id)).rejects.toThrow("prerequisites need action");const failed=await registry.get(row.id);
  expect(failed?.state).toBe("failed");expect((failed?.progress.preflight as any).checks.find((check:any)=>check.id==="uv").blocking).toBe(true);expect(await fs.readdir(path.join(root,".local"))).toEqual([]);
 });
});
