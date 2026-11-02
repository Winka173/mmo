import {describe,it,expect} from "vitest";
import {DataStore} from "@ttm/storage";
import {BrandPresetStore} from "../src/brand-presets.js";
import {tmpDir} from "../../storage/test/helpers.js";
describe("Brand preset revision safety",()=>{
 it("persists reusable settings and refuses a stale concurrent revision",async()=>{const store=new DataStore(await tmpDir("acs-brand-presets-"));await store.init();const brands=new BrandPresetStore(store),first=await brands.save({style:{name:"Owned brand",font:"Tahoma",accent:"#445566"}}),next=await brands.save({id:first.id,revision:first.revision,style:{...first.style,cta:"View our project"}});expect(next.revision).toBe(2);expect((await brands.list())[0].style.cta).toBe("View our project");await expect(brands.save({id:first.id,revision:1,style:first.style})).rejects.toThrow("changed");});
});
