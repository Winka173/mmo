import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {FactoryError,ResearchBundle} from "@ttm/core";
import {ProductEvidence,ProductRecord,ProductSettings,hasAffiliateDisclosure,productEvidenceHash,validateProductPublicationMetadata} from "../../../packages/core/src/product-research.js";
import {fetchPublicSource,publicSourceUrl} from "@ttm/providers";
import {writeJsonAtomic} from "@ttm/storage";
import type {StudioRun} from "@ttm/automation";
import type {Ctx} from "./context.js";

type Source=Awaited<ReturnType<typeof fetchPublicSource>>;
type Retrieve=(url:string)=>Promise<Source>;
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hold=(message:string)=>new FactoryError("PRODUCT_REVALIDATION_REQUIRED","HUMAN_REQUIRED",message);
const scalar=(value:unknown):string|null=>typeof value==="string"||typeof value==="number"?String(value).trim().slice(0,10000)||null:null;
const normalizeText=(value:string)=>value.normalize("NFC").replace(/\s+/g," ").trim();
const productIdentity=(record:ProductRecord)=>digest({name:normalizeText(record.name).toLowerCase(),brand:record.brand?.toLowerCase()??null,sku:record.sku,model:record.model});
export {productEvidenceHash,validateProductPublicationMetadata} from "../../../packages/core/src/product-research.js";

/** Parse one unambiguous JSON-LD product/offer. Never treat a price range as a sale price. */
export function extractProductRecord(source:Source):ProductRecord|null{
  const products:Record<string,any>[]=[];
  const collect=(value:any,depth=0)=>{
    if(depth>20||!value||typeof value!=="object")return;
    if(Array.isArray(value)){for(const item of value)collect(item,depth+1);return;}
    const type=value["@type"];
    if(type==="Product"||Array.isArray(type)&&type.includes("Product"))products.push(value);
    for(const key of ["@graph","mainEntity","itemListElement","item"])if(value[key])collect(value[key],depth+1);
  };
  for(const match of source.html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{collect(JSON.parse(match[1]));}catch{/* Invalid structured metadata is not evidence. */}
  }
  // A category page or several variants cannot safely identify a chosen product/price.
  if(products.length!==1)return null;
  const p=products[0],name=scalar(p.name);if(!name||name.length>500)return null;
  const offers=Array.isArray(p.offers)?p.offers:p.offers?[p.offers]:[];
  const offer=offers.length===1&&offers[0]?.["@type"]!=="AggregateOffer"?offers[0]:null;
  const raw=scalar(offer?.price),price=raw&&/^\d+(?:\.\d+)?$/.test(raw)&&Number.isFinite(Number(raw))?raw:null;
  const currency=scalar(offer?.priceCurrency);
  const properties=Array.isArray(p.additionalProperty)?p.additionalProperty:p.additionalProperty?[p.additionalProperty]:[];
  const specifications=properties.flatMap((v:any)=>{const name=scalar(v?.name),value=scalar(v?.value);return name&&value?[{name,value:scalar(v.unitText)?`${value} ${scalar(v.unitText)}`:value}]:[];}).slice(0,100).sort((a,b)=>a.name.localeCompare(b.name)||a.value.localeCompare(b.value));
  return ProductRecord.parse({name,brand:scalar(p.brand?.name??p.brand),sku:scalar(p.sku),model:scalar(p.model?.name??p.model),description:scalar(p.description),specifications,
    price:price&&currency&&/^[A-Z]{3}$/.test(currency)?price:null,currency:currency&&/^[A-Z]{3}$/.test(currency)?currency:null,
    availability:scalar(offer?.availability),url:source.url,requestedUrl:source.requestedUrl,retrievedAt:source.fetchedAt,sourceSha256:source.sha256});
}

export async function captureProductEvidence(record:ProductRecord,settingsInput:unknown,researchIdentity:string,retrieve:Retrieve=fetchPublicSource):Promise<ProductEvidence>{
  const settings=ProductSettings.parse(settingsInput??{});let affiliate:ProductEvidence["affiliate"]=null;
  if(settings.affiliateEnabled){
    if(!hasAffiliateDisclosure(settings.affiliateDisclosure))throw hold("An explicit affiliate/commission disclosure is required / Cần công bố liên kết tiếp thị và hoa hồng");
    publicSourceUrl(settings.affiliateUrl);
    const result=await retrieve(settings.affiliateUrl);
    const destination=extractProductRecord(result);
    if(!destination||productIdentity(destination)!==productIdentity(record))throw hold("Affiliate destination must identify the selected product; unrelated or ambiguous landing pages cannot be approved");
    affiliate={requestedUrl:settings.affiliateUrl,resolvedUrl:result.url,checkedAt:result.fetchedAt,productIdentity:productIdentity(destination)};
  }
  return ProductEvidence.parse({version:1,settings,record,affiliate,researchIdentity});
}

/** Never refresh research.json or approved narration in place. Changed/stale evidence retires the version. */
export async function assertFreshProductPublication(ctx:Ctx,run:StudioRun,description:string,options:{retrieve?:Retrieve;now?:Date}={}){
  if(run.snapshot.family!=="product")return null;
  const dir=ctx.store.p("studio","artifacts",run.id),retrieve=options.retrieve??fetchPublicSource,now=options.now??new Date();
  const invalidation=path.join(dir,"product-invalidation.json");
  if(await fs.access(invalidation).then(()=>true,()=>false))throw hold("Product evidence for this version was invalidated; create a new draft and review it");
  const bundle=ResearchBundle.parse(JSON.parse(await fs.readFile(path.join(dir,"research.json"),"utf8")));
  const evidence=ProductEvidence.parse(JSON.parse(await fs.readFile(path.join(dir,"product-evidence.json"),"utf8")));
  validateProductPublicationMetadata(bundle,evidence,description,run.language,run.snapshot.timezone);
  const invalidate=async(reason:string,detail:unknown={})=>{
    await writeJsonAtomic(invalidation,{at:now.toISOString(),reason,detail,approvedEvidenceHash:productEvidenceHash(evidence),action:"CREATE_NEW_DRAFT_AND_REVIEW"});
    throw hold(reason);
  };
  const age=now.getTime()-Date.parse(evidence.record.retrievedAt);
  if(age<0||age>evidence.settings.maxPriceAgeHours*3600000)await invalidate("Dated product information is stale; create a new draft and review current prices/specifications");
  const checks=[];
  for(const document of bundle.documents){
    // Reuse guarded HTTPS + DNS/redirect/size/timeout checks; inaccessible sources hold publication.
    const source=await retrieve(document.requestedUrl);
    if(source.url!==document.url||normalizeText(source.text.slice(0,300000))!==normalizeText(document.text))await invalidate("A product research source or its supported specifications changed; the prior approval is invalid",{requestedUrl:document.requestedUrl,currentUrl:source.url});
    if(document.url===evidence.record.url){
      const current=extractProductRecord(source);
      const stable=(value:ProductRecord)=>{const {retrievedAt,sourceSha256,...rest}=value;return rest;};
      if(!current||digest(stable(current))!==digest(stable(evidence.record)))await invalidate("Product price, availability, specifications or identity changed; create and review a new draft",{current});
    }
    checks.push({url:source.url,fetchedAt:source.fetchedAt,sha256:source.sha256});
  }
  if(!bundle.documents.some(d=>d.url===evidence.record.url))throw hold("Product record has no retrieved source document");
  let affiliate=null;
  if(evidence.settings.affiliateEnabled){
    const result=await retrieve(evidence.settings.affiliateUrl);
    if(result.url!==evidence.affiliate?.resolvedUrl)await invalidate("Affiliate destination changed; prior approval is invalid",{resolvedUrl:result.url});
    const destination=extractProductRecord(result);
    if(!destination||productIdentity(destination)!==evidence.affiliate?.productIdentity)await invalidate("Affiliate destination no longer identifies the selected product; prior approval is invalid");
    affiliate={url:result.url,checkedAt:result.fetchedAt};
  }
  const report={checkedAt:now.toISOString(),approvedEvidenceHash:productEvidenceHash(evidence),checks,affiliate,status:"UNCHANGED_RETRIEVED_EVIDENCE"};
  await writeJsonAtomic(path.join(dir,"product-preflight.json"),report);return report;
}
