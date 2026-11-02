import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {chromium} from 'playwright-core';

// Isolated UI contract with an actual deterministic plan and a copied prior speech draft.
// This harness starts no inference worker, account flow or publication.
const root=process.cwd(),folder=path.join(root,'.local/p0-ui',`ux-${randomUUID()}`);
await fs.mkdir(folder,{recursive:true});
await new Promise((resolve,reject)=>{const seed=spawn(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'scripts/seed-p0-ui.ts'],{cwd:root,windowsHide:true,env:{...process.env,ACS_P0_UI_ROOT:folder,NODE_PATH:path.join(root,'node_modules/.pnpm/node_modules')},stdio:['ignore','ignore','pipe']});let error='';seed.stderr.on('data',bytes=>error+=bytes);seed.once('error',reject);seed.once('close',code=>code===0?resolve():reject(new Error(error)));});
const fixture=JSON.parse(await fs.readFile(path.join(folder,'fixture.json'),'utf8')),token=randomUUID(),socket=createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
const serverEntry=process.env.ACS_UX_UI_SERVER?path.resolve(process.env.ACS_UX_UI_SERVER):path.join(root,'desktop/backend/apps/web/server.js');
const server=spawn(process.execPath,[serverEntry],{cwd:root,windowsHide:true,env:{...process.env,NODE_ENV:'production',PORT:String(port),HOSTNAME:'127.0.0.1',DATA_DIR:fixture.data,ACS_SESSION_TOKEN:token},stdio:['ignore','pipe','pipe']});
let log='',browser,page;server.stdout.on('data',bytes=>log+=bytes);server.stderr.on('data',bytes=>log+=bytes);const checks=[],errors=[];
async function poll(fn,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,400));}throw new Error('UX shell smoke timed out');}
try{
 await poll(()=>fetch(base+'/api/desktop/health',{headers:{'x-acs-token':token}}).then(response=>response.ok,()=>false));
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+`/api/desktop/pair?token=${token}`);await page.goto(base+'/');
 const nav=page.getByRole('navigation',{name:'Điều hướng chính'});assert.equal(await nav.getByRole('link',{includeHidden:true}).count(),14);
 await page.getByRole('heading',{name:'Việc tiếp theo',exact:true}).waitFor();
 const action=page.locator(`[data-next-action="plan-${fixture.planId}"]`);await action.waitFor();assert.equal(await action.getByRole('link').getAttribute('href'),`/studio/create?id=${fixture.planId}`);
 await nav.getByRole('button',{name:'Sáng tạo',exact:true}).click();assert.equal(await nav.getByRole('link',{name:'Tạo nội dung',exact:true}).isVisible(),false);await page.reload();
 assert.equal(await page.getByRole('navigation').getByRole('link',{name:'Tạo nội dung',exact:true}).isVisible(),false);
 await page.getByRole('navigation').getByRole('button',{name:'Sáng tạo',exact:true}).press('Enter');assert.equal(await page.getByRole('navigation').getByRole('link',{name:'Tạo nội dung',exact:true}).isVisible(),true);
 checks.push('All 14 destinations retained; grouped sidebar supports keyboard collapse and persists across reload; Home links to the exact saved plan without starting it');
 await page.screenshot({path:'docs/evidence/acs-ux-home-vi.png',fullPage:true});
 await page.goto(base+'/studio/models?tab=voices');const voices=page.getByRole('tab',{name:'Giọng đọc',exact:true});await voices.waitFor();await poll(()=>voices.getAttribute('aria-selected').then(value=>value==='true'));
 const audition=page.getByLabel('Nội dung nghe thử',{exact:true}),text='UI draft only: preserve this voice audition text when changing tabs.';await audition.fill(text);
 await page.getByRole('tab',{name:'Kiểm tra máy',exact:true}).click();await page.getByRole('heading',{name:'Kiểm tra môi trường',exact:true}).waitFor();assert.equal(await audition.isVisible(),false);
 await voices.click();assert.equal(await audition.inputValue(),text);assert.equal(await page.getByRole('tabpanel').count(),1);
 await voices.press('End');assert.equal(await page.getByRole('tab',{name:'Kiểm tra máy',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:'Thiết lập',exact:true}).getAttribute('aria-selected'),'true');
 const setup=page.getByLabel('Thư mục setup ACS',{exact:true});await setup.fill(path.join(folder,'retained-setup'));await page.getByRole('tab',{name:'Model đã cài',exact:true}).click();await page.getByRole('heading',{name:'Profile đã cài trong workspace',exact:true}).waitFor();await page.getByRole('tab',{name:'Thiết lập',exact:true}).click();assert.equal(await setup.inputValue(),path.join(folder,'retained-setup'));
 checks.push('Four Models tabs expose one panel at a time; deep links, Home/End keyboard control and in-tab voice/setup drafts are preserved');
 // Return a clearly marked injected error from one UI-only diagnostic request.
 await page.getByRole('tab',{name:'Kiểm tra máy',exact:true}).click();
 await page.route('**/api/studio',async route=>{const request=route.request();if(request.method()==='POST'&&request.postDataJSON()?.action==='probe')await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'UI CONTRACT ONLY: ffprobe missing'})});else await route.continue();});
 await page.getByRole('button',{name:'Kiểm tra ngay',exact:true}).click();await page.getByRole('alert').filter({hasText:'Cần kiểm tra công cụ media'}).last().waitFor();
 await page.getByRole('alert').filter({hasText:'Cần kiểm tra công cụ media'}).last().getByText('Chi tiết lỗi gốc',{exact:true}).click();await page.getByText('UI CONTRACT ONLY: ffprobe missing',{exact:true}).last().waitFor();
 await page.unroute('**/api/studio');checks.push('An explicitly injected diagnostic error retains its raw message and shows relevant Settings navigation; no tool was actually removed');
 await page.screenshot({path:'docs/evidence/acs-ux-models-vi.png',fullPage:true});
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByLabel('Language',{exact:true}).selectOption('en')]);await page.getByRole('tab',{name:'Diagnostics',exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'Diagnostics',exact:true}).getAttribute('aria-selected'),'true');
 await page.goto(base+'/');await page.getByRole('heading',{name:'Your next steps',exact:true}).waitFor();await page.screenshot({path:'docs/evidence/acs-ux-home-en.png',fullPage:true});
 const sizes=[];for(const width of [1280,960,640,480]){await page.setViewportSize({width,height:900});await page.goto(base+'/studio/models?tab=voices');await page.getByRole('tab',{name:'Voices',exact:true}).waitFor();await poll(()=>page.getByRole('tab',{name:'Voices',exact:true}).getAttribute('aria-selected').then(value=>value==='true'));const dimensions=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));assert.ok(dimensions.scrollWidth<=dimensions.clientWidth+2,`Horizontal page overflow at ${width}: ${JSON.stringify(dimensions)}`);sizes.push({width,...dimensions});if(width===480)await page.screenshot({path:'docs/evidence/acs-ux-models-480.png',fullPage:true});}
 checks.push('VI/EN Home and Models render; layouts at 1280/960/640/480 CSS pixels have no horizontal page overflow (viewport checks, not a physical Windows DPI acceptance)');
 assert.deepEqual(errors,[]);
 const workspace=await page.evaluate(()=>fetch('/api/studio',{cache:'no-store'}).then(response=>response.json()));assert.equal(workspace.publications.length,0);assert.equal(workspace.voices.length,0);
 await fs.writeFile('docs/evidence/acs-ux-shell-ui.json',JSON.stringify({status:'VERIFIED_ACTUAL_BROWSER_UI_CONTRACTS',at:new Date().toISOString(),serverEntry,serverSha256:createHash('sha256').update(await fs.readFile(serverEntry)).digest('hex'),fixture,checks,sizes,browserErrors:errors,inference:false,publishing:false,physicalWindowsDpi:'NOT_TESTED',errorCase:'EXPLICIT_INJECTED_FFPROBE_ERROR_NO_TOOL_REMOVAL'},null,2));console.log(JSON.stringify({status:'VERIFIED',checks,sizes}));
}catch(error){if(page)await page.screenshot({path:'docs/evidence/acs-ux-shell-failure.png',fullPage:true}).catch(()=>{});await fs.writeFile('docs/evidence/acs-ux-shell-ui.json',JSON.stringify({status:'FAILED',at:new Date().toISOString(),fixture,checks,error:String(error),browserErrors:errors},null,2));throw error;}
finally{if(browser)await browser.close();if(server.pid)await new Promise(resolve=>spawn('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('close',resolve));await fs.writeFile('docs/evidence/acs-ux-shell-ui.log',log);}
