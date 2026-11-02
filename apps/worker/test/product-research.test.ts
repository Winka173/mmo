import {afterEach,describe,expect,it} from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {ResearchBundle,ResearchDocument} from "@ttm/core";
import {ProductSettings,productEvidenceHash,productResearchDisclosure,validateProductPublicationMetadata,validateProductResearchNarration} from "../../../packages/core/src/product-research.js";
import {extractProductRecord,captureProductEvidence,assertFreshProductPublication} from "../src/product-research.js";
import type {Ctx} from "../src/context.js";
import type {StudioRun} from "@ttm/automation";

// Synthetic source fixtures: no live product, affiliate authorization or publication approval.
const at="2026-10-23T02:00:00.000Z",url="https://merchant.example/product";
const structured=(patch:Record<string,unknown>={})=>({"@type":"Product",name:"Fixture kettle",brand:{name:"Fixture"},sku:"fixture-1",description:"Fixture kettle description",additionalProperty:[{name:"Capacity",value:1.5,unitText:"L"}],offers:{"@type":"Offer",price:"25.00",priceCurrency:"USD",availability:"https://schema.org/InStock"},...patch});
function source(product:unknown=structured(),text="Fixture kettle has a 1.5 L capacity. Price is USD 25.00."){
  const html=`<main>${text}</main><script type="application/ld+json">${JSON.stringify(product)}</script>`;
  return {url,requestedUrl:url,domain:"merchant.example",title:"Synthetic fixture",fetchedAt:at,mime:"text/html",sha256:createHash("sha256").update(html).digest("hex"),html,text};
}
const dirs:string[]=[];
afterEach(async()=>{for(const dir of dirs.splice(0))await fs.rm(dir,{recursive:true,force:true});});
async function setup(settingsInput:unknown={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"acs-product-fixture-"));dirs.push(dir);
  const original=source(),record=extractProductRecord(original)!;
  const settings=ProductSettings.parse(settingsInput),identity="synthetic-research-identity";
  const evidence=await captureProductEvidence(record,settings,identity,async requestedUrl=>({...source(),requestedUrl,url:requestedUrl}));
  const disclosure=productResearchDisclosure("en-US",at,"UTC");
  const bundle=ResearchBundle.parse({id:"11111111-1111-4111-a111-111111111111",autopilotId:"22222222-2222-4222-a222-222222222222",language:"en-US",createdAt:at,identity,documents:[ResearchDocument.parse(original)],draft:{title:"Fixture research",claims:[{id:"c1",text:"Sourced capacity",risk:"low",quotes:[{url,quote:"1.5 L capacity"}]}],shots:[{text:"Sourced capacity information.",claimIds:["c1"]},{text:disclosure,claimIds:[]},...(settings.affiliateEnabled?[{text:settings.affiliateDisclosure,claimIds:[]}]:[])]},claims:[{id:"c1",status:"EVIDENCE_FOUND",reasons:[]}],product:record,productEvidenceHash:productEvidenceHash(evidence),model:"synthetic-fixture-no-inference"});
  await fs.writeFile(path.join(dir,"research.json"),JSON.stringify(bundle));
  await fs.writeFile(path.join(dir,"product-evidence.json"),JSON.stringify(evidence));
  const ctx={store:{p:()=>dir}} as unknown as Ctx;
  const run={id:bundle.id,language:"en-US",snapshot:{family:"product",timezone:"UTC"}} as StudioRun;
  const description=[disclosure,settings.affiliateDisclosure,settings.affiliateUrl].filter(Boolean).join("\n");
  return {ctx,run,dir,bundle,evidence,description,original};
}

describe("Product source metadata (synthetic fixtures)",()=>{
  it("captures source identity, exact offer, specifications and retrieval timestamp",()=>{
    const record=extractProductRecord(source())!;
    expect(record).toMatchObject({name:"Fixture kettle",sku:"fixture-1",price:"25.00",currency:"USD",retrievedAt:at,requestedUrl:url,specifications:[{name:"Capacity",value:"1.5 L"}]});
  });
  it("never substitutes aggregate minimum, malformed price or missing currency for a sale price",()=>{
    expect(extractProductRecord(source(structured({offers:{"@type":"AggregateOffer",lowPrice:"10",priceCurrency:"USD"}})))?.price).toBeNull();
    expect(extractProductRecord(source(structured({offers:{price:"-2",priceCurrency:"USD"}})))?.price).toBeNull();
    expect(extractProductRecord(source(structured({offers:{price:"25.00"}})))?.price).toBeNull();
  });
  it("holds ambiguous multiple products and accepts graph/mainEntity wrappers",()=>{
    expect(extractProductRecord(source([structured(),structured({name:"Other fixture"})]))).toBeNull();
    expect(extractProductRecord(source({"@graph":[{mainEntity:structured()}]}))?.name).toBe("Fixture kettle");
  });
  it("requires an explicit affiliate disclosure and public HTTPS link",async()=>{
    const record=extractProductRecord(source())!;
    await expect(captureProductEvidence(record,{affiliateEnabled:true,affiliateUrl:"https://affiliate.example/link",affiliateDisclosure:"Buy it now"},"fixture")).rejects.toThrow("disclosure");
    await expect(captureProductEvidence(record,{affiliateEnabled:true,affiliateUrl:"http://127.0.0.1/link",affiliateDisclosure:"I may earn an affiliate commission."},"fixture")).rejects.toThrow("HTTPS");
    await expect(captureProductEvidence(record,{affiliateEnabled:true,affiliateUrl:"https://affiliate.example/link",affiliateDisclosure:"I may earn an affiliate commission."},"fixture",async()=>source(structured({name:"Unrelated fixture product"})))).rejects.toThrow("selected product");
  });
});

describe("Product publication preflight (synthetic fixtures, no posting)",()=>{
  it("rechecks unchanged sources and logs evidence without rewriting approved research",async()=>{
    const fixture=await setup(),before=await fs.readFile(path.join(fixture.dir,"research.json"),"utf8");
    const report=await assertFreshProductPublication(fixture.ctx,fixture.run,fixture.description,{now:new Date(at),retrieve:async()=>fixture.original});
    expect(report?.status).toBe("UNCHANGED_RETRIEVED_EVIDENCE");
    expect(await fs.readFile(path.join(fixture.dir,"research.json"),"utf8")).toBe(before);
    expect(report?.checks).toHaveLength(1);
  });
  it("binds product metadata and mandatory dated disclosure to the exact research version",async()=>{
    const f=await setup();
    expect(()=>validateProductPublicationMetadata(f.bundle,f.evidence,"Buy now","en-US","UTC")).toThrow("disclosure");
    f.evidence.record.price="99";
    expect(()=>validateProductPublicationMetadata(f.bundle,f.evidence,f.description,"en-US","UTC")).toThrow("approved research");
  });
  it.each(["I personally tested this kettle.","We have used this kettle.","Tôi đã trực tiếp thử chiếc ấm này."])("rejects invented first-person experience: %s",async text=>{
    const f=await setup();f.bundle.draft.shots[0].text=text;
    expect(()=>validateProductResearchNarration(f.bundle.draft)).toThrow("first-hand");
  });
  it.each(["price","specification","visible evidence","destination"])("invalidates prior approval on changed %s without replacing it",async kind=>{
    const f=await setup();
    const changed=kind==="price"?source(structured({offers:{price:"27.00",priceCurrency:"USD"}})):
      kind==="specification"?source(structured({additionalProperty:[{name:"Capacity",value:2,unitText:"L"}]})):
      kind==="visible evidence"?source(structured(),"The source text has changed."):{...f.original,url:"https://merchant.example/other"};
    await expect(assertFreshProductPublication(f.ctx,f.run,f.description,{now:new Date(at),retrieve:async()=>changed})).rejects.toThrow(/changed/);
    expect(JSON.parse(await fs.readFile(path.join(f.dir,"product-invalidation.json"),"utf8"))).toMatchObject({action:"CREATE_NEW_DRAFT_AND_REVIEW"});
    await expect(assertFreshProductPublication(f.ctx,f.run,f.description,{now:new Date(at),retrieve:async()=>f.original})).rejects.toThrow("invalidated");
  });
  it("expires the original dated evidence instead of silently refreshing approval",async()=>{
    const f=await setup({maxPriceAgeHours:1});
    await expect(assertFreshProductPublication(f.ctx,f.run,f.description,{now:new Date("2026-10-23T04:00:00.000Z"),retrieve:async()=>f.original})).rejects.toThrow("stale");
  });
  it("blocks broken/inaccessible public sources",async()=>{
    const f=await setup();
    await expect(assertFreshProductPublication(f.ctx,f.run,f.description,{now:new Date(at),retrieve:async()=>{throw new Error("Fixture source HTTP 404");}})).rejects.toThrow("404");
  });
  it("requires disclosure/link in description and rejects affiliate redirects that changed",async()=>{
    const f=await setup({affiliateEnabled:true,affiliateUrl:"https://affiliate.example/link",affiliateDisclosure:"I may earn a commission through this affiliate link."});
    expect(()=>validateProductPublicationMetadata(f.bundle,f.evidence,productResearchDisclosure("en-US",at,"UTC"),"en-US","UTC")).toThrow("Affiliate");
    await expect(assertFreshProductPublication(f.ctx,f.run,f.description,{now:new Date(at),retrieve:async requestedUrl=>requestedUrl===url?f.original:{...f.original,url:"https://affiliate.example/changed"}})).rejects.toThrow("Affiliate destination changed");
  });
  it("invalidates an affiliate destination that still resolves but now sells another product",async()=>{
    const f=await setup({affiliateEnabled:true,affiliateUrl:"https://affiliate.example/link",affiliateDisclosure:"I may earn an affiliate commission."});
    await expect(assertFreshProductPublication(f.ctx,f.run,f.description,{now:new Date(at),retrieve:async requestedUrl=>requestedUrl===url?f.original:{...source(structured({name:"Changed destination product"})),url:requestedUrl}})).rejects.toThrow("selected product");
  });
});
