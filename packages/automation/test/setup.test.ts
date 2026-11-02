import {describe,it,expect} from "vitest";
import * as fs from "node:fs/promises";
import {DataStore,writeJsonAtomic} from "@ttm/storage";
import {ModelSetupStore,environmentLock} from "../src/setup.js";
import {tmpDir} from "../../storage/test/helpers.js";
describe("Durable model setup records",()=>{
 it("separates engine request artifacts from registry rows and de-duplicates concurrent requests",async()=>{
  const store=new DataStore(await tmpDir("acs-setup-"));await store.init();const registry=new ModelSetupStore(store),root=store.p("tools");
  const [a,b]=await Promise.all([registry.enqueue({profile:"kokoro",root}),registry.enqueue({profile:"kokoro",root})]);expect(a.id).toBe(b.id);
  await writeJsonAtomic(store.p("studio","setup",`${a.id}-vi-VN.request.json`),{op:"script"});await fs.writeFile(store.p("studio","setup",`${a.id}-vision.png`),"fixture");expect((await registry.list()).map(r=>r.id)).toEqual([a.id]);
  expect(environmentLock(store.p("env","Scripts","python.exe"))).toBe(environmentLock(store.p("env","Scripts","python.exe")));
 });
 it("refuses to install into another app's named folder",async()=>{const store=new DataStore(await tmpDir());await store.init();await expect(new ModelSetupStore(store).enqueue({profile:"kokoro",root:store.p("Asset-Forge-Studio")})).rejects.toThrow("ACS-owned");});
});
