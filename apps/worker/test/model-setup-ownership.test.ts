import {describe,it,expect} from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import {ModelSetupStore} from "@ttm/automation";
import {buildContext} from "../src/context.js";
import {executeModelSetup,assertOwnedSetupTree} from "../src/model-setup.js";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
describe("Model setup ownership before any environment mutation",()=>{
 it("rejects a nested model junction outside ACS before a downloader or pip can touch it",async()=>{
  const outer=await tmpDir("acs-setup-ownership-"),root=path.join(outer,"ACS"),foreign=path.join(outer,"Asset-Forge-Studio","models");await fs.mkdir(path.join(root,".local","models","kokoro"),{recursive:true});await fs.mkdir(foreign,{recursive:true});await fs.writeFile(path.join(foreign,"owner-sentinel.txt"),"must remain unchanged");await fs.symlink(foreign,path.join(root,".local","models","kokoro","nested"),process.platform==="win32"?"junction":"dir");
  const ctx=await buildContext({dataDir:path.join(outer,"data")}),registry=new ModelSetupStore(ctx.store),row=await registry.enqueue({profile:"kokoro",root});await expect(executeModelSetup(ctx,row.id)).rejects.toThrow("outside ACS");expect((await registry.get(row.id))?.state).toBe("failed");expect(await fs.readFile(path.join(foreign,"owner-sentinel.txt"),"utf8")).toBe("must remain unchanged");expect(await fs.readdir(foreign)).toEqual(["owner-sentinel.txt"]);expect(await fs.access(path.join(root,".local","acs-managed.json")).then(()=>true,()=>false)).toBe(false);
 });
 it("accepts ordinary owned model directories and internal links without recursing forever",async()=>{const root=await tmpDir("acs-setup-owned-"),a=path.join(root,"models","a");await fs.mkdir(a,{recursive:true});await fs.symlink(a,path.join(a,"cycle"),process.platform==="win32"?"junction":"dir");await expect(assertOwnedSetupTree(root,a)).resolves.toBeUndefined();});
});
