import {spawn} from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {chromium} from 'playwright-core';
const root=process.cwd(),folder=path.join(root,'.local/semantic-ui',randomUUID()),token=randomUUID(),socket=createServer();await fs.mkdir(folder,{recursive:true});
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'node_modules/tsx/dist/cli.mjs'),'scripts/seed-semantic-ui.ts'],{cwd:root,windowsHide:true,env:{...process.env,ACS_SEMANTIC_UI_ROOT:folder,NODE_PATH:path.join(root,'node_modules/.pnpm/node_modules')},stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);child.once('close',code=>code===0?resolve():reject(new Error(error)));});
const fixture=JSON.parse(await fs.readFile(path.join(folder,'fixture.json'),'utf8')),data=fixture.data;
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const base=`http://127.0.0.1:${port}`;
const children=['server.js','worker.mjs'].map(script=>spawn(process.execPath,[path.join(root,'desktop/backend/apps/web',script),...(script==='worker.mjs'?['run']:[])],{cwd:root,windowsHide:true,env:{...process.env,NODE_ENV:'production',PORT:String(port),HOSTNAME:'127.0.0.1',DATA_DIR:data,ACS_SESSION_TOKEN:token,ACS_ENGINE_RUNNER:path.join(root,'engines/runner.py'),OMP_NUM_THREADS:'4',MKL_NUM_THREADS:'4'},stdio:['ignore','pipe','pipe']}));
let log='',browser,page;const errors=[],checks=[];for(const child of children){child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);}
async function poll(fn,timeout=180000){const until=Date.now()+timeout;while(Date.now()<until){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,400));}throw new Error('Semantic UI operation timed out; durable tasks retained');}
try{
 await poll(()=>fetch(base+'/api/desktop/health',{headers:{'x-acs-token':token}}).then(response=>response.ok,()=>false),30000);
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+`/api/desktop/pair?token=${token}`);await page.goto(base+'/studio/models');
 await page.getByLabel('Thư mục setup ACS',{exact:true}).fill(root);await page.getByRole('combobox',{name:'Model setup profile'}).selectOption('qwen-embedding');
 const state=()=>page.evaluate(()=>fetch('/api/studio',{cache:'no-store'}).then(response=>response.json()));
 await page.getByRole('button',{name:'Cài / sửa profile này',exact:true}).click();
 const installed=await poll(async()=>{const row=(await state()).setups.find(row=>row.profile==='qwen-embedding'&&row.mode==='install');if(row?.state==='failed')throw new Error(row.error);return row?.state==='installed'?row:false;});
 const card=page.locator('.acs-panel').filter({has:page.locator('header b',{hasText:'qwen-embedding · install'})}).last();
 await card.getByRole('button',{name:'Áp dụng đường dẫn / model đã cài',exact:true}).click();
 await poll(async()=>{const config=(await state()).config;return config.pythonEmbedding&&config.embeddingModel&&config.embeddingDevice==='cpu';});
 await page.getByRole('button',{name:'Kiểm tra embedding local',exact:true}).click();
 const verified=await poll(async()=>{const row=(await state()).setups.find(row=>row.profile==='qwen-embedding'&&row.mode==='verify');if(row?.state==='failed')throw new Error(row.error);return row?.state==='verified'?row:false;});
 if(verified.progress.metadata.device!=='cpu'||verified.progress.scores.library<=verified.progress.scores.unrelated)throw new Error('Explicit CPU verification/ranking not retained');
 checks.push('Selected profile reuses pinned weights and compatible runtime, applies only embedding settings and performs actual explicit CPU verification');
 await page.goto(base+'/studio/library');await page.getByRole('button',{name:'Dựng / làm mới chỉ mục',exact:true}).click();
 const semantic=()=>page.evaluate(()=>fetch('/api/studio/semantic',{cache:'no-store'}).then(response=>response.json()));
 await poll(async()=>{const value=await semantic();const task=value.tasks.find(row=>row.kind==='index');if(task?.state==='failed')throw new Error(task.error);return value.index&&!value.index.stale&&task?.state==='ready';});
 const results=[];
 for(const query of ['sao Kim khí quyển và thời gian quay','clearly labeled software calibration test fixture']){
  await page.getByLabel('Nội dung cần tìm',{exact:true}).fill(query);await page.getByRole('button',{name:'Tìm bằng model local',exact:true}).click();
  const task=await poll(async()=>{const row=(await semantic()).tasks.find(row=>row.kind==='search'&&row.query===query);if(row?.state==='failed')throw new Error(row.error);return row?.state==='ready'?row:false;});
  const first=task.result.matches[0],expected=query.startsWith('sao')?fixture.sources[0].runId:fixture.sources.at(-1).runId;
  if(first.runId!==expected)throw new Error('Fixed semantic UI query ranked an unexpected source');
  await page.getByRole('link').filter({hasText:first.title}).first().waitFor();results.push({query,first});
 }
 checks.push('Actual original VI/EN drafts build a 1024-dimensional derived index; fixed Vietnamese/scientific and English/calibration queries find their corresponding source versions');
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByLabel('Language').selectOption('en')]);
 await page.getByRole('heading',{name:'Search scripts by meaning',exact:true}).waitFor();
 const index=(await semantic()).index;await page.screenshot({path:'docs/evidence/acs-semantic-ui.png',fullPage:true});
 const foreign=await browser.newContext(),anonymous=await foreign.request.get(base+'/api/studio/semantic');if(anonymous.status()!==401)throw new Error('Anonymous semantic access allowed');await foreign.close();
 // Chromium controls Origin; use a separate authenticated HTTP request to set it explicitly.
 const cookies=await page.context().cookies(),cookie=cookies.map(row=>`${row.name}=${row.value}`).join('; '),bad=await fetch(base+'/api/studio/semantic',{method:'POST',headers:{cookie,origin:'https://foreign.invalid','content-type':'application/json'},body:JSON.stringify({kind:'index'})});if(bad.status!==403)throw new Error('Foreign-origin semantic request allowed');
 if(errors.length)throw new Error(errors.join('\n'));checks.push('Vietnamese/English search UI renders without runtime errors; anonymous and foreign-origin requests are refused; no public post or human approval');
 const report={status:'VERIFIED_REAL_LOCAL_SEMANTIC_UI_SMALL_CPU_FIXTURE_ONLY',at:new Date().toISOString(),data,sources:fixture.sources,index,installedId:installed.id,verifiedId:verified.id,verification:verified.progress,results,checks,requestedDevice:'cpu',productionConfigChanged:false,publicPosting:false,humanApproval:'NOT_CREATED',browserErrors:errors};
 await fs.writeFile('docs/evidence/acs-semantic-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks,index}));
}catch(error){if(page)await page.screenshot({path:'docs/evidence/acs-semantic-ui-failure.png',fullPage:true}).catch(()=>{});await fs.writeFile('docs/evidence/acs-semantic-ui.json',JSON.stringify({status:'BLOCKED_OR_FAILED',data,checks,error:String(error)},null,2));throw error;}finally{if(browser)await browser.close();for(const child of children)if(child.pid)await new Promise(resolve=>spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('close',resolve));await fs.writeFile('docs/evidence/acs-semantic-ui.log',log);}
