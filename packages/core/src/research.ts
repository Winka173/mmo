import {z} from "zod";
export const ResearchDocument=z.object({url:z.string().url(),requestedUrl:z.string().url(),domain:z.string(),title:z.string(),fetchedAt:z.string(),sha256:z.string(),text:z.string().max(300000),mime:z.string()});
export const ResearchDraft=z.object({title:z.string().min(1).max(160),claims:z.array(z.object({id:z.string(),text:z.string().min(1).max(1500),risk:z.enum(["low","high"]),quotes:z.array(z.object({url:z.string().url(),quote:z.string().min(4).max(400)})).min(1).max(4)})).min(1).max(8),shots:z.array(z.object({text:z.string().min(1).max(1500),claimIds:z.array(z.string()).max(8)})).min(2).max(8)});
export const ResearchBundle=z.object({id:z.string().uuid(),autopilotId:z.string().uuid(),language:z.string(),createdAt:z.string(),identity:z.string(),documents:z.array(ResearchDocument),draft:ResearchDraft,claims:z.array(z.object({id:z.string(),status:z.enum(["EVIDENCE_FOUND","UNVERIFIED","HIGH_RISK_REVIEW"]),reasons:z.array(z.string())})),product:z.object({name:z.string(),price:z.string().nullable(),currency:z.string().nullable(),availability:z.string().nullable(),url:z.string(),retrievedAt:z.string()}).nullable().default(null),productEvidenceHash:z.string().nullable().default(null),model:z.string(),factApproval:z.literal("REQUIRED").default("REQUIRED")});
export type ResearchBundle=z.infer<typeof ResearchBundle>;
export function validateResearchEvidence(draft:z.infer<typeof ResearchDraft>,documents:z.infer<typeof ResearchDocument>[]){
 const normalize=(v:string)=>v.normalize("NFC").replace(/\s+/g," ").toLowerCase().trim();
 const ids=new Set(draft.claims.map(c=>c.id));if(ids.size!==draft.claims.length)throw new Error("Research model returned duplicate claim IDs");
 for(const shot of draft.shots)if(shot.claimIds.some(id=>!ids.has(id)))throw new Error("Script references a nonexistent claim");
 return draft.claims.map(claim=>{
  const reasons:string[]=[];
  for(const quote of claim.quotes){const doc=documents.find(d=>d.url===quote.url||d.requestedUrl===quote.url);if(!doc)reasons.push("Citation URL was not retrieved");else if(!normalize(doc.text).includes(normalize(quote.quote)))reasons.push("Quoted evidence was not found in the actual source");}
  if(claim.risk==="high")reasons.push("High-risk claim needs explicit review");
  return{id:claim.id,status:reasons.some(r=>r!=="High-risk claim needs explicit review")?"UNVERIFIED" as const:claim.risk==="high"?"HIGH_RISK_REVIEW" as const:"EVIDENCE_FOUND" as const,reasons};
 });
}
