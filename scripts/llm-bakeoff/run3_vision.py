import base64, io, json, time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
exec(open(r'D:\llm_eval\run.py', encoding='utf-8').read().split("procs = {")[0])

im = Image.new('RGB', (640, 400), 'white'); d = ImageDraw.Draw(im)
d.ellipse((80, 90, 260, 270), fill='blue'); d.rectangle((350, 90, 520, 260), fill='orange')
d.text((210, 320), 'ACS 42', fill='black', font=ImageFont.truetype('arial.ttf', 56))
buf = io.BytesIO(); im.save(buf, 'PNG'); b64 = base64.b64encode(buf.getvalue()).decode()
Path(r'D:\llm_eval\out2\vision_fixture.png').write_bytes(buf.getvalue())
schema = dict(type='object', properties=dict(circleColor=dict(type='string'), rectangleColor=dict(type='string'), visibleText=dict(type='string')), required=['circleColor', 'rectangleColor', 'visibleText'])
procs = {p: serve(p, s) for p, s in STORES.items()}
res = {}
try:
    for port, model in MODELS:
        out = []
        for run in range(3):
            body = dict(model=model, stream=False, think=False, format=schema, keep_alive='5m', options=dict(temperature=0.3, seed=run + 1, num_ctx=8192, num_predict=200),
                        messages=[dict(role='system', content='Inspect the actual image. Report the circle color, rectangle color and exact visible text. Do not infer facts beyond the pixels.'),
                                  dict(role='user', content='What colors are the circle and rectangle, and what text is visible?', images=[b64])])
            t0 = time.time()
            try:
                r = json.load(call(port, '/api/chat', body)); a = json.loads(r['message']['content'])
                ok = 'blue' in a['circleColor'].lower() and 'orange' in a['rectangleColor'].lower() and a['visibleText'].replace(' ', '') == 'ACS42'
                out.append(dict(answer=a, ok=ok, wall_s=round(time.time() - t0, 1)))
            except Exception as e: out.append(dict(error=str(e)[:160]))
            say(model, 'vision', out[-1])
        res[model] = out
        try: call(port, '/api/generate', dict(model=model, keep_alive=0, prompt=''), 60)
        except Exception: pass
    Path(r'D:\llm_eval\out2\vision.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8'); say('ALLDONE3')
finally:
    for p in procs.values(): p.terminate()
