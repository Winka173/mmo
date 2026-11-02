import {z} from "zod";
export const Pronunciation=z.object({term:z.string().trim().min(1).max(100),spoken:z.string().trim().min(1).max(150),language:z.enum(["vi-VN","en-US","en-GB"])});
export type Pronunciation=z.infer<typeof Pronunciation>;
/** Literal, Unicode-aware substitution for the speech track only. Captions/factual script retain original spelling. */
export function applyPronunciations(text:string,language:string,entries:Pronunciation[]){
 const terms=entries.map(v=>Pronunciation.parse(v)).filter(v=>v.language===language).map(v=>({...v,term:v.term.normalize("NFC"),spoken:v.spoken.normalize("NFC")})).sort((a,b)=>b.term.length-a.term.length);
 if(!terms.length)return text;
 const escaped=terms.map(v=>v.term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
 const expression=new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}\\p{M}])`,"giu");
 return text.normalize("NFC").replace(expression,(match,offset:number,source:string)=>{
  // A dictionary entry for 12 must not rewrite part of 12.5, 12,500 or a date.
  // Numeric/date interpretation remains explicit rather than guessed by locale.
  if(/^\d+(?:[.,]\d+)*$/u.test(match)&&(/\d[.,:/-]$/u.test(source.slice(0,offset))||/^[.,:/-]\d/u.test(source.slice(offset+match.length))))return match;
  return terms.find(v=>v.term.toLocaleLowerCase()===match.toLocaleLowerCase())?.spoken??match;
 });
}
