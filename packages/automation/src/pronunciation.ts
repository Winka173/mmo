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

/** Project entries override global entries with the same term and language. */
export function mergePronunciations(global:Pronunciation[],project:Pronunciation[]){
 const key=(v:Pronunciation)=>`${v.language}:${v.term.normalize("NFC").toLocaleLowerCase()}`,own=new Set(project.map(key));
 return [...project,...global.filter(v=>!own.has(key(v)))];
}
const VI_LETTERS=/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹàáèéìíòóùúýõãĩũ]/i;
/** Rough Vietnamese respelling of an English term; only a starting point the owner edits and auditions. */
export function suggestVietnameseSpelling(term:string){
 const rules:[RegExp,string][]=[[/tion$/,"sần"],[/ee/g,"i"],[/ea/g,"i"],[/oo/g,"u"],[/ou/g,"ao"],[/ay|ai|a(?=[^aeiou]e\b)/g,"ê"],[/igh/g,"ai"],[/i(?=[^aeiou]e\b)/g,"ai"],[/o(?=[^aeiou]e\b)/g,"âu"],[/(?<=[^aeiou])e\b/g,""],[/er\b|or\b|ar\b/g,"ơ"],[/ph/g,"ph"],[/th/g,"th"],[/sh/g,"s"],[/ch/g,"ch"],[/ck/g,"k"],[/c(?=[eiy])/g,"x"],[/c/g,"c"],[/w/g,"u"],[/j/g,"gi"],[/z/g,"d"],[/f/g,"ph"],[/q/g,"kh"],[/x/g,"x"]];
 return term.split(/\s+/).map(word=>{let w=word.toLowerCase().replace(/[^a-z]/g,"");if(!w)return word;for(const [re,to] of rules)w=w.replace(re,to);
  // Split a closed final consonant into its own soft syllable (keeper -> kíp-pơ) so the TTS does not swallow it.
  w=w.replace(/^([^aeiouêâơư]*[aeiouêâơư]+)([pkt])(?=[aeiouêâơư])/,"$1$2-$2");return w.charAt(0).toUpperCase()+w.slice(1);}).join(" ");
}
/** Terms written in Latin script (brand/game names) inside a Vietnamese line that the ASR did not hear back as written. */
export function pronunciationSuggestions(expected:string,heard:string,language:string){
 if(language!=="vi-VN")return [];
 const norm=(s:string)=>s.normalize("NFC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim(),h=` ${norm(heard)} `;
 // Capitalised ASCII-only words (names) and their neighbours; Vietnamese words carry diacritics or are lowercase.
 const tokens=expected.normalize("NFC").split(/[\s,.;:!?()"“”‘’']+/u).filter(Boolean),runs:string[]=[];let cur:string[]=[];
 for(const tok of tokens){if(/^[A-Z][A-Za-z0-9-]*$/.test(tok)&&!VI_LETTERS.test(tok))cur.push(tok);else{if(cur.length)runs.push(cur.join(" "));cur=[];}}if(cur.length)runs.push(cur.join(" "));
 return [...new Set(runs)].filter(term=>!h.includes(` ${norm(term)} `)).map(term=>({term,language:"vi-VN" as const,spoken:suggestVietnameseSpelling(term),heard:heard.slice(0,200)}));
}
/** Global dictionary shared by every project (config/pronunciations.json). */
export class GlobalPronunciationStore{
 constructor(readonly store:import("@ttm/storage").DataStore){}
 private file(){return this.store.p("config","pronunciations.json");}
 async list():Promise<Pronunciation[]>{const {readJson}=await import("@ttm/storage");return (await readJson(this.file(),z.object({entries:z.array(Pronunciation)})))?.entries??[];}
 async save(entries:unknown){const {writeJsonAtomic}=await import("@ttm/storage");const rows=z.array(Pronunciation).max(500).parse(entries);const keys=new Set<string>();for(const r of rows){const k=`${r.language}:${r.term.toLocaleLowerCase()}`;if(keys.has(k))throw new Error(`Duplicate entry: ${r.term}`);keys.add(k);}await writeJsonAtomic(this.file(),{entries:rows,updatedAt:new Date().toISOString()});await this.store.audit({actor:"studio-ui",action:"pronunciation.global.save",subject:"global",detail:{entries:rows.length}});return rows;}
}
