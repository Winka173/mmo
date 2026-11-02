import yauzl from 'yauzl';
export async function archiveEntries(file:string):Promise<Record<string,{bytes:Buffer;crc32:number}>>{
 return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true},(error,zip)=>{if(error||!zip){reject(error);return;}const entries:Record<string,{bytes:Buffer;crc32:number}>={};zip.on('error',reject);zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error||!stream){reject(error);zip.close();return;}const chunks:Buffer[]=[];stream.on('data',b=>chunks.push(Buffer.from(b)));stream.on('error',reject);stream.on('end',()=>{entries[entry.fileName]={bytes:Buffer.concat(chunks),crc32:entry.crc32};zip.readEntry();});}));zip.on('end',()=>resolve(entries));zip.readEntry();}));
}
