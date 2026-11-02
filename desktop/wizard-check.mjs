/** Exercise installed WebView forms without activating factories or queuing AI. */
export async function exerciseWizards(page, base) {
 const before=await page.evaluate(async()=>await(await fetch('/api/studio')).json());
 const actions=[];
 const observe=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/studio')actions.push(request.postDataJSON()?.action);};
 page.on('request',observe);
 const checks=[];
 for(const locale of ['vi','en']){
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByLabel('Language').selectOption(locale)]);
  await page.goto(`${base}/studio/autopilots`);
  const en=locale==='en',name=`Native ${locale} draft ${Date.now()}`;
  await page.getByRole('button',{name:en?'New Autopilot':'Tạo Autopilot'}).click();
  await page.getByLabel(en?'Project / Autopilot name':'Tên dự án / Autopilot').fill(name);
  await page.getByRole('button',{name:en?'Continue':'Tiếp tục'}).click();
  await page.getByLabel(en?'Brief / evidence-backed information':'Brief / thông tin có bằng chứng').fill('Native UI fixture only; no genuine gameplay, source rights, account actions or publication approval.');
  await page.getByRole('button',{name:en?'Continue':'Tiếp tục'}).click();
  const audience=page.getByLabel(en?'Audience':'Đối tượng người xem',{exact:true});
  await audience.fill('Internal native UI review');
  await page.reload();
  await audience.waitFor();
  if(await audience.inputValue()!=='Internal native UI review')throw new Error('Native draft lost unsaved text on reload');
  for(let step=4;step<=7;step++){
   await page.getByRole('button',{name:en?'Continue':'Tiếp tục'}).click();
   await page.getByRole('heading',{name:`${en?'Step':'Bước'} ${step} / 7`,exact:true}).waitFor();
  }
  await page.screenshot({path:`docs/evidence/acs-native-wizard-${locale}.png`,fullPage:true});
  const save=page.getByRole('button',{name:en?'Save & Close':'Lưu & Đóng'});
  const fail=async route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Native test storage unavailable'})}):route.continue();
  await page.route('**/api/studio',fail);
  await save.click();
  await page.getByRole('alert').filter({hasText:'Native test storage unavailable'}).waitFor();
  await page.getByRole('heading',{name:`${en?'Step':'Bước'} 7 / 7`,exact:true}).waitFor();
  await page.unroute('**/api/studio',fail);
  await save.click();
  await page.getByRole('heading',{name,exact:true}).waitFor();
  await page.reload();
  await page.getByRole('heading',{name,exact:true}).waitFor();
  const stored=await page.evaluate(async title=>(await(await fetch('/api/studio')).json()).autopilots.find(row=>row.name===title),name);
  if(!stored||stored.step!==7||stored.enabled||stored.rights!=='PERMISSION_PENDING'||stored.targets.length)throw new Error('Native draft did not retain an inactive unapproved configuration');
  checks.push({locale,autopilotId:stored.id,sevenSteps:true,reloadPersistence:true,failedSaveRetainsDraft:true,serverDraftInactive:true});
 }
 await page.goto(`${base}/studio/create`);
 await page.getByLabel('Video title',{exact:true}).fill(`Native one-off ${Date.now()}`);
 await page.getByRole('button',{name:'Continue'}).click();
 await page.getByLabel('Brief / evidence-backed information').fill('Internal native form only, without production or approval.');
 await page.getByRole('button',{name:'Continue'}).click();
 await page.getByLabel('Editable script · one scene per paragraph').fill('A first source-backed scene.\n\nA second scene for an internal UI fixture.');
 await page.reload();
 if(!(await page.getByLabel('Editable script · one scene per paragraph').inputValue()).includes('second scene'))throw new Error('Native one-off script lost on reload');
 for(let step=4;step<=6;step++){
  await page.getByRole('button',{name:'Continue'}).click();
  await page.getByRole('heading',{name:`Step ${step} / 6`,exact:true}).waitFor();
 }
 if(!await page.getByRole('button',{name:'Queue video production'}).isDisabled())throw new Error('Incomplete native one-off form permits production');
 await page.screenshot({path:'docs/evidence/acs-native-create.png',fullPage:true});
 const after=await page.evaluate(async()=>await(await fetch('/api/studio')).json());
 page.off('request',observe);
 if(after.runs.length!==before.runs.length||actions.some(action=>action!=='save-autopilot'))throw new Error('Native draft walkthrough unexpectedly requested production');
 if(after.publications.length!==before.publications.length)throw new Error('Native draft walkthrough unexpectedly created a publication');
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByLabel('Language').selectOption('vi')]);
 await page.goto(base);
 return {status:'VERIFIED_NATIVE_DRAFT_WIZARDS_ONLY',autopilot:checks,oneOffSixSteps:true,oneOffScriptPersisted:true,missingSourcesBlockProduction:true,queuedJobs:0,publicationActions:0,humanApproval:'NOT_CREATED'};
}
