import path from"node:path";
import{buildContext}from"../apps/worker/src/context.js";
import{StudioStore}from"@ttm/automation";
import{setupOllamaModel}from"../apps/worker/src/model-setup.js";
import{stopManagedLlm}from"../apps/worker/src/managed-llm.js";
async function main(){
 const root=process.cwd(),ctx=await buildContext({dataDir:path.join(root,".local/llm-setup/data")}),studio=new StudioStore(ctx.store);
 const c=await studio.saveConfig({llmManaged:true,llmBinary:path.join(root,".local/tools/ollama/ollama.exe"),llmModelStore:path.join(root,".local/models/ollama"),llmPort:11435,llmUrl:"http://127.0.0.1:11435/v1",llmDevice:"cuda",maxContext:8192});
 try{const installed=await setupOllamaModel(ctx,c,async event=>{console.log(JSON.stringify(event));});await studio.saveConfig(installed);console.log(JSON.stringify({status:"INSTALLED_NOT_INFERENCE_VERIFIED",model:installed.llmModel,digest:installed.llmModelDigest}));}finally{stopManagedLlm();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
