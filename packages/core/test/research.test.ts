import{describe,it,expect}from"vitest";
import{ResearchDraft,validateResearchEvidence}from"../src/research.js";
const docs=[{url:"https://source.test/fact",requestedUrl:"https://source.test/fact",domain:"source.test",title:"Actual source",fetchedAt:new Date().toISOString(),sha256:"abc",mime:"text/plain",text:"A year on Venus lasts 225 Earth days."}];
const draft=()=>ResearchDraft.parse({title:"Venus",claims:[{id:"claim1",text:"Venus orbits the Sun in about 225 Earth days.",risk:"low",quotes:[{url:"https://source.test/fact",quote:"225 Earth days"}]}],shots:[{text:"One original explanation.",claimIds:["claim1"]},{text:"Second explanation.",claimIds:["claim1"]}]});
describe("Retrieved research evidence",()=>{
 it("recognizes exact retrieved evidence without manufacturing fact approval",()=>{const result=validateResearchEvidence(draft(),docs);expect(result[0].status).toBe("EVIDENCE_FOUND");expect(result[0].status).not.toBe("VERIFIED");});
 it("marks invented citations/quotes unverified and holds high-risk claims",()=>{
  const missing=draft();missing.claims[0].quotes[0].quote="Made up evidence";expect(validateResearchEvidence(missing,docs)[0].status).toBe("UNVERIFIED");
  missing.claims[0].quotes[0]={url:"https://invented.test",quote:"225 Earth days"};expect(validateResearchEvidence(missing,docs)[0].status).toBe("UNVERIFIED");
  const high=draft();high.claims[0].risk="high";expect(validateResearchEvidence(high,docs)[0].status).toBe("HIGH_RISK_REVIEW");
 });
 it("rejects scripts whose claim IDs do not exist",()=>{const value=draft();value.shots[0].claimIds=["invented"];expect(()=>validateResearchEvidence(value,docs)).toThrow("nonexistent");});
});
