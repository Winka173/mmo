import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runProcess } from "@ttm/media";
import type { ModelSetup, StudioConfig } from "@ttm/automation";

type Text = {vi:string;en:string};
export type SetupCheck = {id:string;label:Text;status:"pass"|"warn"|"fail"|"unknown";blocking:boolean;evidence:unknown;action:Text|null};
export type SetupPreflight = {version:1;checkedAt:string;profile:ModelSetup["profile"];root:string;readyToInstall:boolean;checks:SetupCheck[];inferenceVerified:false;diskEstimateKind:"CONSERVATIVE_RESERVATION_NOT_BENCHMARK"};
type Probe = (binary:string,args:string[])=>Promise<{code:number;stdout:string;stderr:string}>;
// A cold "import torch, transformers" can take well over 10 s on a busy PC (antivirus scan, cold disk cache); measured failure 2026-11-02.
const probe:Probe = (binary,args)=>runProcess(binary,args,{timeoutMs:args.some(a=>/import[^;]*torch/.test(a))?120000:10000,env:{PYTHONDONTWRITEBYTECODE:"1"}});
const text=(vi:string,en:string):Text=>({vi,en});
/** Reservations cover weights, environments, download cache and headroom; these are not measured inference estimates. */
export const SETUP_DISK_GIB:Record<ModelSetup["profile"],number>={"espeak-ng":1,"qwen3.5-9b":16,"qwen-quality":24,kokoro:10,vieneu:18,"qwen-asr":14,"silero-vad":1,"flux2-klein-4b":38,"qwen-embedding":4,"wav2vec2-en-align":2};
export function setupPython(profile:ModelSetup["profile"],root:string,config:StudioConfig){
 const base=path.join(root,".local","engines"),binary=process.platform==="win32"?"Scripts/python.exe":"bin/python";
 if(profile==="qwen-embedding")return config.pythonEmbedding||config.pythonAsr||path.join(base,"asr",binary);
 if(profile==="silero-vad"||profile==="wav2vec2-en-align")return config.pythonAsr||path.join(base,"asr",binary);
 return path.join(base,profile==="flux2-klein-4b"?"image":profile==="kokoro"?"speech":profile==="vieneu"?"vieneu":"asr",binary);
}
async function ancestor(folder:string){let candidate=path.resolve(folder);for(;;){const stat=await fs.stat(candidate).catch(()=>null);if(stat?.isDirectory())return candidate;const parent=path.dirname(candidate);if(parent===candidate)throw new Error("No existing setup parent directory");candidate=parent;}}
/** Read-only preflight. It neither loads models nor creates a setup folder or claims inference works. */
export async function setupPreflight(row:Pick<ModelSetup,"profile"|"root"|"config">,options:{probe?:Probe;freeDiskBytes?:number;availableRamBytes?:number}={}):Promise<SetupPreflight>{
 const config=row.config,checks:SetupCheck[]=[],run=options.probe??probe;
 const add=(id:string,label:Text,status:SetupCheck["status"],blocking:boolean,evidence:unknown,action:Text|null=null)=>checks.push({id,label,status,blocking,evidence,action});
 let diskParent:string|null=null;
 try{
  if(!path.isAbsolute(row.root)||/asset[-_ ]?forge/i.test(row.root))throw new Error("Choose an absolute ACS-owned folder separate from Asset Forge");
  diskParent=await ancestor(row.root);const canonical=await fs.realpath(diskParent);
  if(/asset[-_ ]?forge/i.test(canonical))throw new Error("Setup parent resolves into Asset Forge storage");
  await fs.access(diskParent,constants.W_OK);
  add("folder",text("Thư mục ACS có thể ghi","Writable ACS folder"),"pass",false,{nearestExistingParent:diskParent,canonical,folderCreated:false});
 }catch(error){add("folder",text("Thư mục ACS","ACS folder"),"fail",true,String(error),text("Chọn thư mục tuyệt đối có quyền ghi, riêng biệt với Asset Forge.","Choose a writable absolute folder separate from Asset Forge."));}
 try{
  if(!diskParent)throw new Error("No safe disk path to inspect");
  const info=options.freeDiskBytes===undefined?await fs.statfs(diskParent):null,freeBytes=options.freeDiskBytes??Number(info!.bavail)*Number(info!.bsize),reservedBytes=SETUP_DISK_GIB[row.profile]*1024**3;
  add("disk",text("Dung lượng trống","Free disk space"),freeBytes>=reservedBytes?"pass":"fail",freeBytes<reservedBytes,{freeBytes,reservedBytes,reservationIncludes:"checkpoint + environment/cache + headroom; conservative, not a measured download size"},freeBytes>=reservedBytes?null:text(`Cần ít nhất ${SETUP_DISK_GIB[row.profile]} GiB trống theo mức dự phòng bảo thủ; dọn dung lượng hoặc chọn ổ khác.`,`Reserve at least ${SETUP_DISK_GIB[row.profile]} GiB using the conservative allowance; free space or choose another drive.`));
 }catch(error){add("disk",text("Dung lượng trống","Free disk space"),"unknown",true,String(error),text("Kiểm tra quyền truy cập ổ đĩa rồi chạy lại.","Check drive access and run preflight again."));}
 const availableRamBytes=options.availableRamBytes??os.freemem();add("ram",text("RAM khả dụng","Available RAM"),availableRamBytes>=8*1024**3?"pass":"warn",false,{availableBytes:availableRamBytes,totalBytes:os.totalmem(),notAnInferenceGuarantee:true},availableRamBytes>=8*1024**3?null:text("Đóng ứng dụng không cần thiết trước khi inference; app không tự hạ chất lượng.","Close unneeded apps before inference; quality is never silently reduced."));
 const command=async(id:string,binary:string,args:string[],label:Text,blocking:boolean,action:Text)=>{
  try{const result=await run(binary,args);if(result.code!==0)throw new Error(result.stderr.slice(-1000)||`Exit ${result.code}`);add(id,label,"pass",false,{binary,version:(result.stdout||result.stderr).trim().slice(0,500)});return true;}
  catch(error){add(id,label,blocking?"fail":"warn",blocking,{binary,error:String(error)},action);return false;}
 };
 if(!["qwen3.5-9b","qwen-quality","silero-vad","qwen-embedding","wav2vec2-en-align"].includes(row.profile))await command("uv",config.uv,["--version"],text("Runtime uv / Python quản lý","uv / managed Python runtime"),true,text("Chọn uv.exe của bản cài ACS trong Settings → uv; uv sẽ tải Python 3.11 riêng khi cài profile.","Select the installed ACS runtime/uv.exe in Settings → uv; uv downloads isolated Python 3.11 during setup."));
 if(row.profile==="qwen-embedding"||row.profile==="silero-vad"||row.profile==="wav2vec2-en-align"){
  await command("python",setupPython(row.profile,row.root,config),["-I","-c","import sys,torch,transformers; print(sys.version.split()[0]); print('torch='+torch.__version__); print('transformers='+transformers.__version__)"],text("Python ASR tương thích có sẵn","Existing compatible ASR Python"),true,text("Cài và áp dụng profile Qwen3-ASR trước. Embedding/VAD dùng runtime này mà không sửa package.","Install and apply Qwen3-ASR first. Embedding/VAD reuse that runtime without changing packages."));
  if(row.profile==="wav2vec2-en-align")await command("alignment-runtime",setupPython(row.profile,row.root,config),["-I","-c","import torchaudio; assert torchaudio.__version__.split('+')[0]=='2.8.0', 'English alignment requires pinned torchaudio 2.8.0'; print(torchaudio.__version__)"],text("Runtime căn từ tiếng Anh CPU","English CPU alignment runtime"),true,text("Cài và áp dụng Qwen3-ASR với torchaudio 2.8.0 đã pin. Adapter chỉ dùng CPU, không sửa runtime hiện tại.","Install/apply Qwen3-ASR with pinned torchaudio 2.8.0. This adapter explicitly uses CPU and does not alter the current runtime."));
 }
 if(row.profile==="qwen3.5-9b"||row.profile==="qwen-quality"){
  const legacy=path.join(row.root,".local","tools","ollama","ollama.exe"),legacyExists=await fs.stat(legacy).then(info=>info.isFile(),()=>false);
  const binary=config.llmBinary||(legacyExists?legacy:path.join(row.root,".local","tools","ollama-0.40.8","ollama.exe")),exists=await fs.stat(binary).then(s=>s.isFile(),()=>false),automatic=process.platform==="win32"&&process.arch==="x64";
  if(exists)await command("ollama",binary,["--version"],text("Runtime Ollama local","Local Ollama runtime"),true,text("Chọn ollama.exe cùng thư mục lib hợp lệ của ACS, hoặc để trống llmBinary để tải bản đã pin.","Select an ACS Ollama executable with its lib folder, or clear llmBinary to download the pinned runtime."));
  else add("ollama",text("Runtime Ollama local","Local Ollama runtime"),automatic&&!config.llmBinary?"warn":"fail",!automatic||!!config.llmBinary,{binary,bootstrapAvailable:automatic&&!config.llmBinary,release:"v0.40.8",archiveBytes:1582537058},automatic&&!config.llmBinary?text("Install sẽ tải ZIP Windows x64 chính thức đã pin và kiểm SHA-256, không chạy trình cài hệ thống.","Install downloads the pinned official Windows x64 ZIP and verifies SHA-256 without a system installer."):text("Sửa llmBinary bị thiếu trong Settings, hoặc để trống để ACS tải runtime riêng trên Windows x64.","Fix the missing llmBinary in Settings, or clear it for the private Windows x64 bootstrap."));
 }
 await command("ffmpeg",config.ffmpeg,["-version"],text("FFmpeg dựng video","FFmpeg rendering"),false,text("Settings → Tìm công cụ trong thư mục ACS, hoặc chọn đường dẫn ffmpeg.exe. Cài model vẫn được nhưng chưa dựng được video.","Settings → Discover tools in the ACS folder, or select ffmpeg.exe. Model setup can continue, but rendering remains unavailable."));
 await command("ffprobe",config.ffprobe,["-version"],text("FFprobe kiểm tra media","FFprobe media checks"),false,text("Chọn ffprobe.exe cùng bộ FFmpeg trong Settings. Chưa thể nghiệm thu media nếu thiếu công cụ.","Select ffprobe.exe from the same FFmpeg package in Settings. Media cannot be validated without it."));
 const cudaRequired=row.profile==="flux2-klein-4b"||(row.profile==="qwen-quality"?config.llmQualityDevice==="cuda":row.profile==="qwen3.5-9b"?config.llmDevice==="cuda":row.profile==="qwen-embedding"?config.embeddingDevice==="cuda":row.profile==="qwen-asr"?config.asrDevice!=="cpu":["silero-vad","wav2vec2-en-align"].includes(row.profile)?false:config.ttsDevice!=="cpu");
 try{
  const result=await run("nvidia-smi",["--query-gpu=name,driver_version,memory.total,memory.free","--format=csv,noheader,nounits"]);if(result.code!==0||!result.stdout.trim())throw new Error(result.stderr||"No NVIDIA device returned");
  const devices=result.stdout.trim().split(/\r?\n/).map(line=>{const[name,driver,total,free]=line.split(",").map(s=>s.trim());return{name,driver,totalMiB:Number(total),freeMiB:Number(free)};});
  add("gpu",text("GPU / driver NVIDIA","NVIDIA GPU / driver"),"pass",false,{devices,cudaRequested:cudaRequired,modelNotLoaded:true,leaseAcquired:false,freeMemoryNotReserved:true});
 }catch(error){add("gpu",text("GPU / driver NVIDIA","NVIDIA GPU / driver"),cudaRequired?"fail":"warn",cudaRequired,{cudaRequested:cudaRequired,error:String(error)},text("Cài driver NVIDIA và kiểm tra nvidia-smi. Có thể chọn CPU cho profile hỗ trợ CPU; app không tự chuyển thiết bị.","Install the NVIDIA driver and check nvidia-smi. Select CPU explicitly for a supported profile; the app never changes devices silently."));}
 const models=path.join(row.root,".local","models"),folder=row.profile==="qwen3.5-9b"||row.profile==="qwen-quality"?"ollama":row.profile==="qwen-embedding"?"qwen3-embedding-0.6b":row.profile==="qwen-asr"?"qwen3-asr":row.profile==="silero-vad"?"silero-vad":row.profile==="flux2-klein-4b"?"flux2-klein-4b":row.profile;
 const modelFolder=path.join(models,folder),manifest=await fs.readFile(path.join(modelFolder,"acs-manifest.json"),"utf8").then(value=>{try{return JSON.parse(value);}catch{return null;}},()=>null);
 add("checkpoint",text("Checkpoint và tính toàn vẹn","Checkpoint and integrity"),manifest?"pass":"warn",false,{folder:modelFolder,manifestFound:!!manifest,revision:manifest?.revision??null,files:Array.isArray(manifest?.files)?manifest.files.length:null,hashValidation:"PERFORMED_DURING_INSTALL_AND_ENGINE_LOAD_NOT_BY_THIS_PREFLIGHT",inferenceVerified:false},manifest?null:text("Install tải riêng profile này, tiếp tục phần tải dở khi downloader hỗ trợ và kiểm checksum. Sau đó Apply rồi chạy mẫu thật.","Install downloads only this profile, resumes partial files where supported and checks hashes. Then Apply and run a real sample."));
 return {version:1,checkedAt:new Date().toISOString(),profile:row.profile,root:row.root,readyToInstall:!checks.some(check=>check.blocking),checks,inferenceVerified:false,diskEstimateKind:"CONSERVATIVE_RESERVATION_NOT_BENCHMARK"};
}
