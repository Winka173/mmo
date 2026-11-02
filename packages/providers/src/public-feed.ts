import {createHash} from 'node:crypto';
import {htmlToText} from './factcheck.js';
import {publicSourceUrl} from './public-source.js';
/** Bounded RSS/Atom metadata only. No XML entities, enclosures or media retrieval. */
export function parsePublicFeed(xml:string,feedUrl:string){
 publicSourceUrl(feedUrl);
 if(Buffer.byteLength(xml)>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Feed exceeds bounds or declares unsupported XML entities');
 if(!/<(?:rss|feed|rdf:RDF)\b/i.test(xml))throw new Error('Source is not an offered RSS/Atom document');
 const blocks=[...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0,100),items=[];
 const content=(s:string)=>htmlToText(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'));
 const tag=(s:string,name:string)=>content(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,'i').exec(s)?.[1]??'');
 for(const [,kind,block] of blocks){
  try{
   let link=kind.toLowerCase()==='item'?tag(block,'link'):'';
   if(!link)for(const m of block.matchAll(/<link\b([^>]*?)\/?\s*>/gi)){const attrs=Object.fromEntries([...m[1].matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(v=>[v[1].toLowerCase(),v[3]]));if(attrs.href&&(!attrs.rel||attrs.rel==='alternate')){link=content(attrs.href);break;}}
   const u=publicSourceUrl(new URL(link,feedUrl).href);if(!link)continue;u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))u.searchParams.delete(key);
   const title=tag(block,'title').slice(0,500);if(!title)continue;
   const value=tag(block,'pubDate')||tag(block,'published')||tag(block,'updated')||tag(block,'dc:date'),time=Date.parse(value);
   items.push({id:createHash('sha256').update(u.href).digest('hex'),url:u.href,title,summary:(tag(block,'description')||tag(block,'summary')).slice(0,1500),publishedAt:Number.isFinite(time)?new Date(time).toISOString():null});
  }catch{/* One malformed/private/unsupported entry cannot authorize a request. */}
 }
 return [...new Map(items.map(item=>[item.id,item])).values()];
}
