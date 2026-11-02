import {getStore} from '../../../../lib/data';
import {ManualExport,exportFileHash} from '../../../../lib/manual-export';
import {serveFile} from '../../../../lib/serve';
import {readJson} from '@ttm/storage';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[a-f0-9]{64}$/.test(id))return new Response('Invalid export ID',{status:400});const store=await getStore(),record=await readJson(store.p('studio','exports',`${id}.json`),ManualExport);if(record?.state!=='ready')return new Response('Export not ready',{status:404});const file=store.p('studio','export-files',`${id}.zip`);if(await exportFileHash(file).catch(()=>null)!==record.sha256)return new Response('Export integrity check failed',{status:409});return serveFile(request,file,`ACS-${record.runId.slice(0,8)}.zip`);
}
