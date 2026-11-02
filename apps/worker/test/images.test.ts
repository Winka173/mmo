import {describe,it,expect,vi} from "vitest";
import * as fs from "node:fs/promises";
import {createHash} from "node:crypto";
import sharp from "sharp";
import {ImageStore,StudioStore} from "@ttm/automation";
import {tmpDir} from "../../../packages/storage/test/helpers.js";
import {buildContext} from "../src/context.js";
import * as local from "../src/local-engine.js";
import {executeImage} from "../src/images.js";
describe("Image output contract (mock model, real PNG decode)",()=>{
 it("validates dimensions/hash, keeps synthetic/unreviewed provenance and resumes without regenerating; detects tampering",async()=>{
  const ctx=await buildContext({dataDir:await tmpDir("acs-image-contract-")}),studio=new StudioStore(ctx.store),images=new ImageStore(ctx.store);await studio.saveConfig({...await studio.config(),pythonImage:"fixture-only",imageModel:"fixture-only"});const row=await images.enqueue({prompt:"Fixture gradient; not actual model inference",seed:42,width:384,height:384});
  const call=vi.spyOn(local,"invokeLocalEngine").mockImplementation(async(_ctx,_config,op)=>{const output=String(op.output);await fs.mkdir((await import("node:path")).dirname(output),{recursive:true});const bytes=await sharp(Buffer.from('<svg width="384" height="384" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="384" height="384" fill="url(#g)"/></svg>')).png().toBuffer();await fs.writeFile(output,bytes);return{output,output_sha256:createHash("sha256").update(bytes).digest("hex"),device:"MOCK_NOT_GPU_ACCEPTANCE",synthetic:true};});
  try{await executeImage(ctx,row.id);const completed=await images.get(row.id);expect(completed?.state).toBe("ready");expect(completed?.humanReview).toBe("NOT_REVIEWED");expect((completed?.evidence as any).factualEvidence).toBe(false);expect((completed?.evidence as any).technical.status).toBe("PASS");await executeImage(ctx,row.id);expect(call).toHaveBeenCalledTimes(1);await fs.appendFile(images.output(row.id),"tampered");await expect(executeImage(ctx,row.id)).rejects.toThrow("bytes changed");expect(call).toHaveBeenCalledTimes(1);}finally{call.mockRestore();}
 });
});
