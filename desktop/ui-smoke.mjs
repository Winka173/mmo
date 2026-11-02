import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
const root=process.cwd(),port=3467,base=`http://127.0.0.1:${port}`,token='acs-ui-test-only';
const server=spawn(process.execPath,['desktop/backend/apps/web/server.js'],{cwd:root,env:{...process.env,PORT:String(port),HOSTNAME:'127.0.0.1',DATA_DIR:path.join(root,'.local/ui-smoke-data'),ACS_SESSION_TOKEN:token},windowsHide:true,stdio:['ignore','pipe','pipe']});
let serverLog='';server.stdout.on('data',b=>serverLog+=b.toString());server.stderr.on('data',b=>serverLog+=b.toString());
server.on('error',e=>serverLog+=e.message);let browser,page;
await fs.mkdir('docs/evidence',{recursive:true});

try{
 let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(base+'/api/desktop/health',{headers:{'x-acs-token':token},signal:AbortSignal.timeout(2000)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
 if(!ready)throw new Error('UI backend did not become ready: '+serverLog.slice(-3000));
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(25000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+`/api/desktop/pair?token=${token}`);
 if(new URL(page.url()).origin!==base)throw new Error(`Pairing changed loopback origin to ${page.url()}`);
 await page.getByRole('heading',{name:'Không gian sáng tạo của bạn'}).waitFor();
 await fs.mkdir('docs/evidence',{recursive:true});await page.screenshot({path:'docs/evidence/acs-overview.png',fullPage:true});
 await page.goto(base+'/studio/autopilots');await page.getByRole('button',{name:'Tạo Autopilot'}).click();
 const draftName=`UI acceptance draft ${Date.now()}`;
 await page.getByLabel('Tên dự án / Autopilot').fill(draftName);await page.getByRole('button',{name:'Tiếp tục'}).click();await page.getByLabel('Thư mục media trên máy').waitFor();
 await page.getByLabel('Brief / thông tin có bằng chứng').fill('Fixture only. No genuine gameplay or publication permission.');await page.getByRole('button',{name:'Tiếp tục'}).click();
 await page.getByLabel('Đối tượng người xem').fill('Review audience');await page.reload();await page.getByLabel('Đối tượng người xem').waitFor();if(await page.getByLabel('Đối tượng người xem').inputValue()!=='Review audience')throw new Error('Wizard draft lost after reload');
 await page.screenshot({path:'docs/evidence/acs-wizard.png',fullPage:true});
 for(let step=4;step<=7;step++){
  await page.getByRole('button',{name:'Tiếp tục'}).click();
  await page.getByRole('heading',{name:`Bước ${step} / 7`,exact:true}).waitFor();
 }
 await page.getByRole('heading',{name:'Duyệt kế hoạch',exact:true}).waitFor();
 const failSave=async route=>{
  if(route.request().method()==='POST')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary test storage failure'})});
  else await route.continue();
 };
 await page.route('**/api/studio',failSave);
 await page.getByRole('button',{name:'Lưu & Đóng'}).click();
 await page.getByRole('alert').filter({hasText:'Temporary test storage failure'}).waitFor();
 await page.getByRole('heading',{name:'Duyệt kế hoạch',exact:true}).waitFor();
 await page.unroute('**/api/studio',failSave);
 await page.getByRole('button',{name:'Lưu & Đóng'}).click();
 await page.getByRole('heading',{name:draftName,exact:true}).waitFor();
 await page.reload();
 await page.getByRole('heading',{name:draftName,exact:true}).waitFor();
 await page.goto(base+'/studio/create');
 await page.getByLabel('Tên video',{exact:true}).fill('One-off UI test');
 await page.getByRole('button',{name:'Tiếp tục'}).click();
 await page.getByLabel('Brief / thông tin có bằng chứng').fill('Local fixture plan. Not real gameplay.');
 await page.getByRole('button',{name:'Tiếp tục'}).click();
 await page.getByLabel('Kịch bản có thể sửa · một cảnh mỗi đoạn').fill('Cảnh một có nguồn.\n\nCảnh hai kết thúc.');
 await page.reload();
 if(!(await page.getByLabel('Kịch bản có thể sửa · một cảnh mỗi đoạn').inputValue()).includes('Cảnh hai'))throw new Error('One-off script draft lost');
 await page.getByRole('button',{name:'Tiếp tục'}).click();
 await page.getByLabel('Mục tiêu thời lượng (giây)').fill('30');
 await page.getByRole('button',{name:'Tiếp tục'}).click();
 await page.getByRole('button',{name:'Sửa kịch bản',exact:true}).waitFor();
 await page.getByRole('button',{name:'Tiếp tục'}).click();
 if(!await page.getByRole('button',{name:'Xếp hàng tạo video'}).isDisabled())throw new Error('Missing media should disable production');
 await page.screenshot({path:'docs/evidence/acs-create.png',fullPage:true});
 await page.goto(base+'/studio/models');await page.getByRole('heading',{name:'Kiểm tra môi trường'}).waitFor();await page.screenshot({path:'docs/evidence/acs-models.png',fullPage:true});
 await page.getByLabel('Language').selectOption('en');await page.getByRole('heading',{name:'Environment check'}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/');await page.getByRole('heading',{name:'Your creative workspace'}).waitFor();await page.screenshot({path:'docs/evidence/acs-mobile.png',fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
 if(overflow)throw new Error('Mobile viewport overflows');if(errors.length)throw new Error(errors.join('\n'));
 const report={status:'VERIFIED',checks:['SSR page load','cookie auth pairing','wizard save + reload persistence','seven-step Autopilot navigation and server draft persistence','failed save keeps wizard open','distinct six-step one-off wizard','editable script reload persistence','missing media prevents queue submission','model status catalog','VI/EN workspace locale','mobile no overflow','no browser runtime errors'],screenshots:['acs-overview.png','acs-wizard.png','acs-models.png','acs-mobile.png','acs-create.png'],timestamp:new Date().toISOString()};
 await fs.writeFile('docs/evidence/acs-ui-smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
 if(page){await page.screenshot({path:'docs/evidence/acs-ui-failure.png',fullPage:true}).catch(()=>{});await fs.writeFile('docs/evidence/acs-ui-failure.html',await page.content().catch(()=>''));}
 await fs.writeFile('docs/evidence/acs-ui-smoke.json',JSON.stringify({status:'FAILED',error:String(error),url:page?.url(),timestamp:new Date().toISOString()},null,2));throw error;
}finally{await fs.writeFile('docs/evidence/acs-ui-server.log',serverLog);if(browser)await browser.close();server.kill();}

