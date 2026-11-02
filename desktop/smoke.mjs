import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { exerciseVoices } from './voice-check.mjs';
import { exerciseClosePolicy } from './close-check.mjs';
import { exerciseWizards } from './wizard-check.mjs';
const packaging=await fs.readFile(path.join(process.cwd(),'.local/desktop-package.json'),'utf8').then(JSON.parse,()=>null);
if(packaging){let active=false;try{process.kill(packaging.pid,0);active=true;}catch{}if(active)throw new Error('Desktop packaging is still running. Wait for it to finish before launching native smoke tests.');}
const root=process.cwd(), cfg=path.join(root,'.local/native-smoke'), exe=process.env.ACS_SMOKE_EXE??path.join(root,'dist/windows/AUTONOMOUS CREATIVE STUDIO.exe');
await fs.mkdir(cfg,{recursive:true});
// Wizard-only acceptance starts with isolated, paused fixture data. Reusing the
// voice benchmark's backlog would let a legitimate retry race form assertions.
const isolatedWizards=process.env.ACS_SMOKE_WIZARDS==='1'&&process.env.ACS_SMOKE_VOICES!=='1';
const dataDir=isolatedWizards?path.join(cfg,'wizard-data',randomUUID()):path.join(cfg,'data');
if(isolatedWizards){
 const previous=await fs.readFile(path.join(cfg,'data/config/settings.json'),'utf8').then(JSON.parse,()=>({schemaVersion:1}));
 await fs.mkdir(path.join(dataDir,'config'),{recursive:true});
 await fs.writeFile(path.join(dataDir,'config/settings.json'),JSON.stringify({...previous,paused:true,externalPostingEnabled:false,telegram:{...previous.telegram,enabled:false}}));
}
await fs.rm(path.join(cfg,'desktop-status.json'),{force:true});
const portServer=createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const debugPort=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));
const child=spawn(exe,[],{env:{...process.env,ACS_CONFIG_DIR:cfg,ACS_DATA:dataDir,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`},windowsHide:true,stdio:'ignore'});
child.on('error',error=>console.error(error.message));
let status,browser,report,page;
const installed=!!process.env.ACS_SMOKE_EXE;
const reportFile=installed?'docs/evidence/acs-installed-smoke.json':'docs/evidence/acs-native-smoke.json';
try{
 for(let i=0;i<120;i++){status=await fs.readFile(path.join(cfg,'desktop-status.json'),'utf8').then(JSON.parse,()=>null);if(status?.status==='FAILED')throw new Error(status.error??'Native startup failed');if(status?.status==='READY')break;await new Promise(r=>setTimeout(r,500));}
 if(status?.status!=='READY')throw new Error('Native backend did not become ready');
 const base=`http://127.0.0.1:${status.port}`;
 const forbidden=await fetch(base+'/api/studio');if(forbidden.status!==401)throw new Error('Unauthenticated access was not blocked');
 const pid=Number(status.workerPid);process.kill(pid,0);
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
 const context=browser.contexts()[0];
 for(let i=0;i<60;i++){page=context.pages().find(p=>p.url().startsWith(base));if(page)break;await new Promise(r=>setTimeout(r,500));}
 if(!page)throw new Error('Native WebView did not navigate to authenticated workspace');
 await page.getByRole('heading',{name:'Không gian sáng tạo của bạn'}).waitFor({timeout:30000});
 await fs.mkdir('docs/evidence',{recursive:true});await page.screenshot({path:'docs/evidence/acs-native-window.png',fullPage:true});
 const authenticated=await page.evaluate(async()=>{const r=await fetch('/api/studio');return r.status;});if(authenticated!==200)throw new Error('Native session cookie did not authorize studio API');
 const workspaceScreens=[];
 for(const [route,heading] of [['projects','Hồ sơ dự án & thương hiệu'],['channels','Đăng nhập YouTube bằng trình duyệt'],['insights','Hiệu quả nội dung']]){
  await page.goto(`${base}/studio/${route}`);await page.getByRole('heading',{name:heading,exact:true}).waitFor({timeout:30000});workspaceScreens.push(route);
 }
 await page.screenshot({path:'docs/evidence/acs-native-expansion.png',fullPage:true});await page.goto(base);
 const wizards=process.env.ACS_SMOKE_WIZARDS==='1'?await exerciseWizards(page,base):null;
 const voices=process.env.ACS_SMOKE_VOICES==='1'?await exerciseVoices(page,root):[];
 const closePolicy=process.env.ACS_SMOKE_CLOSE==='1'?await exerciseClosePolicy(page,root,status,child.pid):null;
 if(voices.length&&!closePolicy)await page.screenshot({path:'docs/evidence/acs-native-voices.png',fullPage:true});
 report={product:'AUTONOMOUS CREATIVE STUDIO',exe,exeSha256:createHash('sha256').update(await fs.readFile(exe)).digest('hex'),timestamp:new Date().toISOString(),status:'VERIFIED_NATIVE_WEBVIEW_AND_AUTH',desktopPid:child.pid,webPid:status.webPid,workerPid:pid,port:status.port,unauthenticated:forbidden.status,authenticated,workspaceScreens,wizards,visualReview:'SCREENSHOT_CAPTURED',installer:installed?'INSTALLED_EXE_VERIFIED':'NOT_VERIFIED',voices,closePolicy};
}catch(error){
 if(page){await page.screenshot({path:'docs/evidence/acs-native-failure.png',fullPage:true}).catch(()=>{});await fs.writeFile('docs/evidence/acs-native-failure.html',await page.content().catch(()=>''));}
 const failure={status:'FAILED_OR_BLOCKED_NATIVE_ATTEMPT',exe,timestamp:new Date().toISOString(),error:String(error),voicesRequested:process.env.ACS_SMOKE_VOICES==='1',exeSha256:await fs.readFile(exe).then(bytes=>createHash('sha256').update(bytes).digest('hex'),()=>null)};
 await fs.writeFile(reportFile.replace(/\.json$/,'-latest-attempt.json'),JSON.stringify(failure,null,2));
 // Replace the main report too: an older PASS must not survive a failed attempt at a new binary.
 await fs.writeFile(reportFile,JSON.stringify(failure,null,2));
 throw error;
}finally{
 if(browser)await browser.close().catch(()=>{});
 if(child.pid&&child.exitCode===null){await new Promise(resolve=>{const stop=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});stop.on('close',resolve);});}
 if(report){
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  for(let i=0;i<30&&[status.webPid,status.workerPid].some(alive);i++)await new Promise(resolve=>setTimeout(resolve,200));
  report.processTreeStopped=![status.webPid,status.workerPid].some(alive);
  await fs.writeFile(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  if(!report.processTreeStopped)throw new Error('Owned backend/worker survived native process shutdown');
 }
}
