import assert from 'node:assert/strict';

/** Real native WebView exercise; never fabricates a human listening review. */
export async function exerciseVoices(page, root) {
  const waitState=async(predicate,timeout=180000)=>{
    const until=Date.now()+timeout;
    while(Date.now()<until){
      const data=await page.evaluate(()=>fetch('/api/studio',{cache:'no-store'}).then(r=>r.json()));
      const result=predicate(data);if(result)return result;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    throw new Error('Timed out waiting for durable voice state');
  };
  await page.goto(new URL('/studio/models?tab=voices', page.url()).href);
  await page.getByLabel('Thư mục setup local').fill(root);
  await page.getByRole('button', { name: 'Tìm công cụ', exact: true }).click();
  await page.getByRole('button', { name: 'Dùng cấu hình này', exact: true }).click();
  await waitState(data=>data.config.python.includes('speech')&&data.config.pythonVi.includes('vieneu')&&data.config.asrModel.includes('qwen3-asr'),30000);
  // Resume through the UI. The isolated smoke store has no publication credentials.
  const state = await page.evaluate(() => fetch('/api/studio').then(r => r.json()));
  if (state.settings.paused) {
    await page.goto(new URL('/', page.url()).href);
    await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await page.goto(new URL('/studio/models?tab=voices', page.url()).href);
  }
  const checks = [];
  for (const language of ['en-GB', 'vi-VN']) {
    await page.getByLabel('Ngôn ngữ giọng', { exact: true }).selectOption(language);
    // Short independent lines make the test useful for pronunciation, not a speed benchmark.
    const text = language === 'vi-VN' ? 'Đây là mẫu kiểm tra giọng Việt. Ứng dụng lưu bản gốc và tạo video trên máy.' : 'This is a British English voice test. Original files remain available for review.';
    await page.getByLabel('Nội dung nghe thử').fill(text);
    const submitted = page.waitForResponse(async response => response.url().endsWith('/api/studio') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'voice-sample');
    await page.getByRole('button', { name: 'Tạo mẫu giọng local', exact: true }).click();
    const response = await submitted; assert.equal(response.status(), 200); const row = await response.json();
    const sample=await waitState(data=>data.voices.find(v=>v.id===row.id&&['ready','failed'].includes(v.state)));
    assert.equal(sample.state, 'ready', sample.error); assert.equal(sample.evidence.device, 'cuda'); assert.equal(sample.humanReview, 'NOT_REVIEWED');
    const audio = await page.request.get(new URL(`/api/studio/voice/${row.id}`, page.url()).href, { headers: { Range: 'bytes=0-43' } });
    assert.equal(audio.status(), 206); assert.equal((await audio.body()).subarray(0, 4).toString(), 'RIFF');
    const card = page.locator('section').filter({ has: page.locator(`audio[src="/api/studio/voice/${row.id}"]`) }).last();
    await card.getByRole('button', { name: 'Đã nghe · Phát âm đạt', exact: true }).waitFor();
    assert.equal(await card.getByRole('button', { name: 'Đã nghe · Phát âm đạt', exact: true }).isDisabled(), true);
    assert.equal(sample.evidence.roundTrip?.status, 'pass', JSON.stringify(sample.evidence.roundTrip));
    checks.push({ id: row.id, language, voice: sample.evidence.voice, device: sample.evidence.device, seconds: sample.evidence.audio_seconds, audioSha256: sample.audioSha256, asr: sample.evidence.roundTrip.status, review: sample.humanReview });
  }
  return checks;
}
