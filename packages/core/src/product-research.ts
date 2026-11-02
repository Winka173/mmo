import {z} from "zod";
import {createHash} from "node:crypto";
import {FactoryError} from "./jobs.js";
import type {ResearchBundle} from "./research.js";
import type {ResearchDraft} from "./research.js";

/** User supplied partner configuration. This does not enroll users in an affiliate program. */
export const ProductSettings=z.object({
  affiliateEnabled:z.boolean().default(false),
  affiliateUrl:z.string().trim().max(2000).default(""),
  affiliateDisclosure:z.string().trim().max(1000).default(""),
  maxPriceAgeHours:z.number().int().min(1).max(168).default(24),
});
export type ProductSettings=z.infer<typeof ProductSettings>;
export const ProductRecord=z.object({
  name:z.string().min(1).max(500),brand:z.string().nullable(),sku:z.string().nullable(),model:z.string().nullable(),
  description:z.string().nullable(),specifications:z.array(z.object({name:z.string(),value:z.string()})).max(100),
  price:z.string().nullable(),currency:z.string().nullable(),availability:z.string().nullable(),
  url:z.string().url(),requestedUrl:z.string().url(),retrievedAt:z.string().datetime(),sourceSha256:z.string(),
});
export type ProductRecord=z.infer<typeof ProductRecord>;
export const ProductEvidence=z.object({
  version:z.literal(1),settings:ProductSettings,record:ProductRecord,
  affiliate:z.object({requestedUrl:z.string().url(),resolvedUrl:z.string().url(),checkedAt:z.string().datetime(),productIdentity:z.string()}).nullable(),
  researchIdentity:z.string(),
});
export type ProductEvidence=z.infer<typeof ProductEvidence>;

export function hasAffiliateDisclosure(value:string){
  return value.trim().length>=12&&/affiliate|commission|hoa\s+hồng|liên\s+kết\s+tiếp\s+thị/iu.test(value.normalize("NFC"));
}

/** A separate, deterministic sentence is appended after model-authored narration. */
export function productResearchDisclosure(language:string,retrievedAt:string,timezone:string){
  const date=new Intl.DateTimeFormat(language,{timeZone:timezone,year:"numeric",month:"long",day:"numeric"}).format(new Date(retrievedAt));
  return language.startsWith("vi")
    ?`Thông tin được tra cứu ngày ${date}. Đây là tổng hợp từ nguồn, không phải trải nghiệm sử dụng trực tiếp. Giá và tình trạng hàng có thể thay đổi.`
    :`Information retrieved on ${date}. This is source-based research, not firsthand testing. Prices and availability may change.`;
}

export const productEvidenceHash=(value:ProductEvidence)=>createHash("sha256").update(JSON.stringify(ProductEvidence.parse(value))).digest("hex");

/** Explicit first-person experience is forbidden in this research-only intake. */
export function validateProductResearchNarration(draft:z.infer<typeof ResearchDraft>){
  const text=[draft.title,...draft.claims.map(c=>c.text),...draft.shots.map(s=>s.text)].join(" ").normalize("NFC");
  if(/\b(?:I|we)\s+(?:(?:have|personally|actually|already)\s+)*(?:tested|tried|used|owned|bought|purchased|reviewed)\b|\b(?:my|our)\s+(?:hands[- ]on|testing|test results|experience using)\b|(?:tôi|chúng tôi|mình)\s+(?:(?:đã|từng|trực tiếp)\s+)*(?:thử|kiểm thử|sử dụng|dùng|sở hữu|mua|trải nghiệm)/iu.test(text))throw new FactoryError("PRODUCT_FIRSTHAND_CLAIM","HUMAN_REQUIRED","Research-only product content cannot claim first-hand use or tests");
}

/** Immutable evidence/disclosure checks; does not substitute for a fresh guarded HTTP check. */
export function validateProductPublicationMetadata(bundle:ResearchBundle,evidence:ProductEvidence,description:string,language:string,timezone:string){
  const hold=(message:string)=>new FactoryError("PRODUCT_REVALIDATION_REQUIRED","HUMAN_REQUIRED",message);
  const normalize=(value:string)=>value.normalize("NFC").replace(/\s+/g," ").trim();
  if(bundle.productEvidenceHash!==productEvidenceHash(evidence)||bundle.identity!==evidence.researchIdentity)throw hold("Product evidence does not match the approved research version");
  validateProductResearchNarration(bundle.draft);
  const disclosure=productResearchDisclosure(language,evidence.record.retrievedAt,timezone);
  if(!normalize(description).includes(normalize(disclosure)))throw hold("Publication description must include the dated source-research disclosure");
  const narration=bundle.draft.shots.map(s=>s.text).join(" ");
  if(!normalize(narration).includes(normalize(disclosure)))throw hold("Approved narration is missing its dated source-research disclosure");
  if(evidence.settings.affiliateEnabled){
    const {affiliateUrl,affiliateDisclosure}=evidence.settings;
    if(!evidence.affiliate||!hasAffiliateDisclosure(affiliateDisclosure)||!description.includes(affiliateUrl)||!normalize(description).includes(normalize(affiliateDisclosure))||!normalize(narration).includes(normalize(affiliateDisclosure)))throw hold("Affiliate URL and explicit disclosure must match the approved narration and publication description");
  }
}
