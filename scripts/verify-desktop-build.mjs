import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
const dir='dist/windows';
const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const digest=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const build=await read(path.join(dir,'build-report.json'));
try{
for(const artifact of build.artifacts)assert.equal((await digest(path.join(dir,artifact.file))).toLowerCase(),artifact.sha256.toLowerCase(),'Artifact changed after build');
const exeHash=await digest(path.join(dir,'AUTONOMOUS CREATIVE STUDIO.exe'));
const native=await read('docs/evidence/acs-native-smoke.json'),installed=await read('docs/evidence/acs-installed-smoke.json'),install=await read('docs/evidence/acs-install.json');
assert.equal(native.exeSha256,exeHash,'Portable smoke belongs to a different EXE');
const workerHealth=await read('docs/evidence/acs-worker-health-ui.json'),startupFailure=await read('docs/evidence/acs-startup-failure.json');
assert.equal(workerHealth.exeSha256,exeHash,'Worker recovery evidence belongs to a different EXE');
assert.equal(workerHealth.status,'VERIFIED_BOUNDED_AUTOMATIC_WORKER_AND_WEB_RECOVERY','Worker fault/reopen did not pass');
assert.equal(workerHealth.shellClose,'NO_REOPEN_REQUIRED_FOR_AUTOMATIC_RECOVERY','Recovery scope must identify how the native shell was closed');
assert.equal(workerHealth.automaticRestart,true);assert.equal(workerHealth.retryLimitEnforced,true);assert.equal(workerHealth.workerAttempts,3);
const restoreSmoke=await read('docs/evidence/acs-restore-native.json');assert.equal(restoreSmoke.exeSha256,exeHash);assert.equal(restoreSmoke.status,'VERIFIED_NATIVE_UI_RESTORE_AND_UNDO');
assert.equal(workerHealth.publicPosting,false);assert.equal(workerHealth.AIInference,false);
assert.equal(startupFailure.exeSha256,exeHash,'Startup failure evidence belongs to a different EXE');
assert.equal(startupFailure.status,'VERIFIED_CONTROLLED_LIVE_OWNER_FAILURE_UI_AND_CLEANUP','Controlled live-owner startup failure did not pass');
const installedBytes=await fs.readFile(installed.exe),portableBytes=await fs.readFile(path.join(dir,'AUTONOMOUS CREATIVE STUDIO.exe'));
assert.equal(installed.exeSha256,createHash('sha256').update(installedBytes).digest('hex'),'Installed EXE changed after smoke');
// Tauri patches the installer variant NSS, then restores UNK for the portable.
// Accept exactly that three-byte marker difference; all other bytes must match.
if(!installedBytes.equals(portableBytes)){
  const marker=Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS'),offset=installedBytes.indexOf(marker);
  assert.ok(offset>=0,'Unknown installed binary variant');
  const normalized=Buffer.from(installedBytes);Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK').copy(normalized,offset);
  assert.ok(normalized.equals(portableBytes),'EXEs differ beyond the Tauri bundle marker');
}
for(const report of [native,installed]){assert.equal(report.processTreeStopped,true);assert.equal(report.authenticated,200);assert.equal(report.unauthenticated,401);}
assert.equal(installed.installer,'INSTALLED_EXE_VERIFIED');assert.ok(installed.voices.every(v=>v.device==='cuda'&&v.asr==='pass'&&v.review==='NOT_REVIEWED'));if(installed.voices.length)assert.equal(installed.voices.length,2);
assert.equal(install.installerSha256.toLowerCase(),(await digest(path.join(dir,'AUTONOMOUS CREATIVE STUDIO_0.2.0_x64-setup.exe'))).toLowerCase());
const resourceHashes={};
for(const file of ['backend/apps/web/worker.mjs','backend/apps/web/maintenance.mjs','backend/apps/web/server.js','backend/apps/web/.next/BUILD_ID','engines/runner.py','engines/image_engine.py','engines/install-image.py','engines/requirements-image.lock.txt']){
  const actual=await digest(path.join(dir,file));assert.equal(await digest(path.join(path.dirname(installed.exe),file)),actual,'Installed resources differ from the tested build');resourceHashes[file]=actual;
}
// Cover the complete SSR chunks/dependency/runtime tree, not just the server
// wrapper and BUILD_ID. No installed process is running during this comparison.
async function resourceFiles(base){
 const files=[];
 async function walk(relative){
  for(const entry of await fs.readdir(path.join(base,relative),{withFileTypes:true})){
   const file=path.join(relative,entry.name);
   assert.ok(!entry.isSymbolicLink(),`Unexpected resource link: ${file}`);
   if(entry.isDirectory())await walk(file);else if(entry.isFile())files.push(file.split(path.sep).join('/'));
  }
 }
 for(const folder of ['backend','runtime','engines'])await walk(folder);
 return files.sort();
}
const allFiles=await resourceFiles(dir),installedFiles=await resourceFiles(path.dirname(installed.exe));
const expectedSet=new Set(allFiles),installedSet=new Set(installedFiles);
const missing=allFiles.filter(file=>!installedSet.has(file)),extra=installedFiles.filter(file=>!expectedSet.has(file));
assert.ok(!missing.length&&!extra.length,`Installed resource tree differs: ${JSON.stringify({missing:missing.slice(0,8),extra:extra.slice(0,8),missingCount:missing.length,extraCount:extra.length})}`);
const entries=new Array(allFiles.length);let cursor=0;
await Promise.all(Array.from({length:8},async()=>{
 while(cursor<allFiles.length){
  const index=cursor++,file=allFiles[index],[bytes,installedBytes]=await Promise.all([fs.readFile(path.join(dir,file)),fs.readFile(path.join(path.dirname(installed.exe),file))]);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  assert.equal(createHash('sha256').update(installedBytes).digest('hex'),sha256,`Installed resource changed: ${file}`);
  entries[index]={file,bytes:bytes.length,sha256};
 }
}));
const manifest={schemaVersion:1,files:entries,fileCount:entries.length,totalBytes:entries.reduce((total,row)=>total+row.bytes,0),sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
await fs.writeFile(path.join(dir,'resource-manifest.json'),JSON.stringify(manifest,null,2));
build.status='VERIFIED_MACHINE_SMOKE_NOT_FULL_RELEASE';build.native_smoke='VERIFIED';build.installer_smoke='VERIFIED';build.installedExeSha256=installed.exeSha256;build.bundleMarkerDifference='Only NSS versus UNK; all other EXE bytes identical';build.verified_utc=new Date().toISOString();build.resourceHashes=resourceHashes;build.voices=installed.voices;build.limits=['No genuine game media','Human listening pending','Clean machine/model setup not verified','Full master prompt not complete','No public publishing acceptance'];
build.closePolicy=installed.closePolicy??native.closePolicy??null;build.installedVoiceRetest=installed.voices.length===2?'VERIFIED_CUDA_ASR_NOT_HUMAN_APPROVED':'NOT_RETESTED_ON_THIS_INSTALLER';if(!installed.voices.length)build.limits.push('Voice inference not repeated on this installer; earlier model evidence remains separate');
build.resourceTree={fileCount:manifest.fileCount,totalBytes:manifest.totalBytes,sha256:manifest.sha256,manifest:'resource-manifest.json',installedExactMatch:true};
build.wizards={portable:native.wizards??null,installed:installed.wizards??null};
build.workerRecovery={evidence:'acs-worker-health-ui.json',forcedWorkerDeath:true,shellClose:workerHealth.shellClose,automaticRestart:workerHealth.automaticRestart,isolatedWebviewProfile:workerHealth.webviewProfile};
build.restore={evidence:'acs-restore-native.json',uiRestore:true,uiUndo:true,crashRecoveryEvidence:'acs-restore-crash.json'};
build.controlledStartupFailure={evidence:'acs-startup-failure.json',liveOwnerPreserved:true,ownedProcessesCleaned:true};
install.status='VERIFIED_INSTALLED_AND_LAUNCHED';install.nativeEvidence='acs-installed-smoke.json';await fs.writeFile('docs/evidence/acs-install.json',JSON.stringify(install,null,2));
await fs.writeFile(path.join(dir,'build-report.json'),JSON.stringify(build,null,2));console.log(JSON.stringify({status:build.status,voices:build.voices.length,exeHash}));
}catch(error){
 build.status='FAILED_RESOURCE_OR_SMOKE_VERIFICATION';build.verificationError=String(error.message??error);build.failedVerificationUtc=new Date().toISOString();delete build.verified_utc;
 await fs.writeFile(path.join(dir,'build-report.json'),JSON.stringify(build,null,2));throw error;
}
