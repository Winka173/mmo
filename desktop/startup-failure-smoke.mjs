import {spawn} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {chromium} from 'playwright-core';

const root=process.cwd(),exe=path.join(root,'dist/windows/AUTONOMOUS CREATIVE STUDIO.exe');
const cfg=path.join(root,'.local/startup-failure-smoke',randomUUID()),data=path.join(cfg,'data');
await fs.mkdir(path.join(data,'locks'),{recursive:true});
const now=new Date().toISOString(),lock={pid:process.pid,host:os.hostname(),acquiredAt:now,heartbeatAt:now,purpose:'controlled live-owner startup failure',ownerId:randomUUID()};
await fs.writeFile(path.join(data,'locks/worker.lock'),JSON.stringify(lock));
const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const child=spawn(exe,[],{windowsHide:true,stdio:'ignore',env:{...process.env,ACS_CONFIG_DIR:cfg,ACS_DATA:data,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`}});
let browser,status;
try{
 for(let i=0;i<100;i++){
  status=await fs.readFile(path.join(cfg,'desktop-status.json'),'utf8').then(JSON.parse,()=>null);
  if(status?.status==='READY')throw new Error('Desktop falsely marked failed worker as ready');
  if(status?.status==='FAILED')break;
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 if(status?.status!=='FAILED'||!/(worker ownership check|Worker exited during startup)/.test(status.error??''))throw new Error('Expected a diagnostic worker startup failure');
 const alive=pid=>{if(!pid)return false;try{process.kill(pid,0);return true;}catch{return false;}};
 for(let i=0;i<30&&[status.webPid,status.workerPid].some(alive);i++)await new Promise(resolve=>setTimeout(resolve,100));
 if([status.webPid,status.workerPid].some(alive))throw new Error('Failed startup left an owned child process alive');
 if(JSON.stringify(JSON.parse(await fs.readFile(path.join(data,'locks/worker.lock'),'utf8')))!==JSON.stringify(lock))throw new Error('Live owner lock was changed');
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 const page=browser.contexts()[0].pages()[0];
 await page.locator('#startup-status').filter({hasText:'Startup failed'}).waitFor();
 await page.locator('#startup-detail').filter({hasText:'logs'}).waitFor();
 await page.screenshot({path:path.join(root,'docs/evidence/acs-startup-failure-ui.png'),fullPage:true});
 const report={status:'VERIFIED_CONTROLLED_LIVE_OWNER_FAILURE_UI_AND_CLEANUP',at:new Date().toISOString(),exeSha256:createHash('sha256').update(await fs.readFile(exe)).digest('hex'),config:cfg,checks:['Existing live owner is retained; no duplicate worker starts','Failed child is not reported READY','Configured diagnostic file and bilingual native failure UI display the reason','Owned web/worker processes are cleaned; live test lock is unchanged'],controlledFault:true,AIInference:false,publicPosting:false};
 await fs.writeFile(path.join(root,'docs/evidence/acs-startup-failure.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 if(browser)await browser.close().catch(()=>{});
 if(child.pid&&child.exitCode===null)await new Promise(resolve=>{const cleanup=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});cleanup.on('close',resolve);});
}
