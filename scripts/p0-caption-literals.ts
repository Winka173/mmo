import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {runProcess,toAss,toSrt} from "@ttm/media";

async function main(){
 const root=process.cwd(),folder=path.join(root,".local/benchmarks/p0-caption-literals",String(Date.now()));await fs.mkdir(folder,{recursive:true});
 const cues=[{start:0,end:3,text:"File C:\\New\\Node {\\pos(0,0)} remains literal."}],ass=toAss(cues,{width:1280,height:720,fontSize:46,marginV:100,fontName:"Arial"});
 await fs.writeFile(path.join(folder,"captions.ass"),ass,"utf8");await fs.writeFile(path.join(folder,"captions.srt"),toSrt(cues),"utf8");
 const image=path.join(folder,"literal-caption.png"),result=await runProcess(path.join(root,".local/tools/ffmpeg.exe"),["-hide_banner","-y","-f","lavfi","-i","color=c=0x241b3c:s=1280x720:r=30:d=1","-vf","ass=captions.ass","-frames:v","1","-threads","1",image],{cwd:folder,timeoutMs:30000});
 await fs.writeFile(path.join(folder,"render.log"),result.stderr,"utf8");if(result.code!==0)throw new Error(result.stderr);
 const bytes=await fs.readFile(image),report={status:"VERIFIED_REAL_LIBASS_RENDER_VISUAL_REVIEW_PENDING",folder,image,imageSha256:createHash("sha256").update(bytes).digest("hex"),sourceText:cues[0].text,scriptAss:ass,renderer:"Local FFmpeg/libass; Arial",scope:"Literal path/backslash/brace handling, not narration or word timing",publicPosting:false};
 await fs.writeFile(path.join(root,"docs/evidence/acs-p0-caption-literals.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({image,status:report.status}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
