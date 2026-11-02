import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export type ArchiveEntry={name:string;file:string;sha256:string}|{name:string;data:Buffer};
const table=Array.from({length:256},(_,i)=>{let n=i;for(let b=0;b<8;b++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
/** ZIP STORE: streams existing compressed media without recompression or additional dependencies. */
export async function writeMediaArchive(output:string,sourceRoot:string,entries:ArchiveEntry[],date=new Date()){
 if(!entries.length||entries.length>40)throw new Error('Archive entry count outside supported bounds');
 const base=await fs.realpath(sourceRoot),names=new Set<string>();
 for(const entry of entries){if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(entry.name)||entry.name.includes('..')||names.has(entry.name))throw new Error('Unsafe or duplicate archive filename');names.add(entry.name);if('file'in entry){const actual=await fs.realpath(entry.file),relative=path.relative(base,actual);if(relative.startsWith('..')||path.isAbsolute(relative)||(await fs.lstat(entry.file)).isSymbolicLink())throw new Error('Archive source escaped its artifact folder');}}
 const year=Math.max(1980,Math.min(2107,date.getUTCFullYear())),dosDate=((year-1980)<<9)|((date.getUTCMonth()+1)<<5)|date.getUTCDate(),dosTime=(date.getUTCHours()<<11)|(date.getUTCMinutes()<<5)|Math.floor(date.getUTCSeconds()/2);
 const handle=await fs.open(output,'wx'),archiveHash=createHash('sha256');let offset=0;const central:Buffer[]=[],files:{name:string;sha256:string;bytes:number;crc32:number}[]=[];
 const write=async(data:Buffer)=>{if(offset+data.length>2*1024**3)throw new Error('Manual archive exceeds the 2 GiB limit');let at=0;while(at<data.length){const {bytesWritten}=await handle.write(data,at,data.length-at,null);if(!bytesWritten)throw new Error('Archive write stalled');at+=bytesWritten;}offset+=data.length;archiveHash.update(data);};
 try{
  for(const entry of entries){const name=Buffer.from(entry.name,'utf8'),start=offset,header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0808,6);header.writeUInt16LE(dosTime,10);header.writeUInt16LE(dosDate,12);header.writeUInt16LE(name.length,26);await write(header);await write(name);
   let crc=0xffffffff,size=0;const fileHash=createHash('sha256');
   const chunks='file'in entry?createReadStream(entry.file):[entry.data];for await(const raw of chunks){const bytes=Buffer.from(raw);size+=bytes.length;if(size>1024**3)throw new Error('Manual export file exceeds the 1 GiB limit');for(const value of bytes)crc=table[(crc^value)&255]^(crc>>>8);fileHash.update(bytes);await write(bytes);}
   const sha256=fileHash.digest('hex');if('sha256'in entry&&sha256!==entry.sha256)throw new Error('Export source changed while archiving');crc=(crc^0xffffffff)>>>0;
   const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(size,8);descriptor.writeUInt32LE(size,12);await write(descriptor);
   const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x0808,8);record.writeUInt16LE(dosTime,12);record.writeUInt16LE(dosDate,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(size,20);record.writeUInt32LE(size,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(start,42);central.push(record,name);files.push({name:entry.name,sha256,bytes:size,crc32:crc});
  }
  const centralStart=offset;for(const bytes of central)await write(bytes);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(offset-centralStart,12);end.writeUInt32LE(centralStart,16);await write(end);await handle.sync();return{bytes:offset,sha256:archiveHash.digest('hex'),files};
 }finally{await handle.close();}
}
