import {z} from 'zod';
import {getStore} from '../../../lib/data';
import {createManualExport} from '../../../lib/manual-export';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(request.headers.get('origin')!==`http://${request.headers.get('host')}`)return Response.json({error:'Invalid origin'},{status:403});
 try{const {runId}=z.object({runId:z.string().uuid()}).strict().parse(await request.json()),record=await createManualExport(await getStore(),runId);return Response.json({...record,url:`/api/studio/export/${record.id}`});}catch(error){return Response.json({error:error instanceof Error?error.message:'Manual export failed'},{status:400});}
}
