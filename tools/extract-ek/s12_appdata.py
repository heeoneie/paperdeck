# -*- coding: utf-8 -*-
"""387문제 -> 학습앱용 JSON + 최적화 미디어"""
import sys, os, re, io, json, pickle, collections, time
sys.path.insert(0, '.')
import pymupdf, numpy as np
from PIL import Image
import ekcore as E, ekcard as C

D = pymupdf.open('clean.pdf')
B = pickle.load(open('blocks.pkl', 'rb'))
media = C.Media(); stats = collections.Counter()

CLZ = re.compile(r'\{\{c1::(.*?)\}\}', re.S)

def owner(html, pos):
    """cloze 위치를 감싸는 요소의 (태그, 클래스, data-g)"""
    seg = html[:pos]
    i = max(seg.rfind('<div'), seg.rfind('<td'), seg.rfind('<span'))
    if i < 0: return ('', '', None)
    j = seg.find('>', i)
    tag = seg[i:j if j > 0 else len(seg)]
    name = re.match(r'<(\w+)', tag).group(1)
    cls = (re.search(r'class="([^"]*)"', tag) or [None, ''])[1]
    g = re.search(r'data-g="(\d+)"', tag)
    return (name, cls, int(g.group(1)) if g else None)

def convert(r):
    html = r['text']
    blanks = []
    out, last = [], 0
    for m in CLZ.finditer(html):
        name, cls, g = owner(html, m.start())
        inner = m.group(1)
        isimg = '<img' in inner
        k = len(blanks)
        blanks.append(dict(k=k, g=g if g is not None else 0,
                           a=inner, t='img' if isimg else 'txt',
                           s=1 if (name == 'div' and 'ans' in cls.split()) else 0))
        out.append(html[last:m.start()])
        out.append('<span class="bk" data-b="%d"></span>' % k)
        last = m.end()
    out.append(html[last:])
    return "".join(out), blanks

t0 = time.time(); items = []
for n, b in enumerate(B):
    if not b['tags']: continue
    r = C.build_block(D, b, media, stats)
    h, blanks = convert(r)
    if not blanks: continue
    rounds = sorted(set(b['tags']), key=lambda t: (-int(t[0]), int(t[1])))
    items.append(dict(
        i=len(items), t=b['title'], h=h, b=blanks,
        y=sorted({x[0] for x in b['tags']}, reverse=True),
        r=["20%s년 %s회" % (y, c) for y, c in rounds],
        p=b['pages'][0] + 1,
        n=len({x['g'] for x in blanks}),
    ))
    if n % 40 == 0:
        print("\r %d/%d %.0fs" % (n, len(B), time.time() - t0), end='', flush=True)
print("\r문제 %d개  %.0fs" % (len(items), time.time() - t0))

# ---- 이미지 최적화 ----
def opt(data, maxw=720):
    im = Image.open(io.BytesIO(data)).convert('RGB')
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    a = np.asarray(im)
    colored = ((a.max(axis=2).astype(int) - a.min(axis=2).astype(int)) > 28).mean()
    out = (im.convert('L').quantize(colors=16) if colored < 0.004
           else im.quantize(colors=48))
    buf = io.BytesIO(); out.save(buf, format='PNG', optimize=True)
    return buf.getvalue()

used = set()
for it in items:
    used |= set(re.findall(r'src="([^"]+)"', it['h']))
    for bl in it['b']:
        used |= set(re.findall(r'src="([^"]+)"', bl['a']))
o = sum(len(media[m]) for m in used if m in media)
opts = {m: opt(media[m]) for m in used if m in media}
print("이미지 %d장  %.2f MB -> %.2f MB" % (len(opts), o/1e6, sum(len(v) for v in opts.values())/1e6))

import base64
mediab64 = {m: base64.b64encode(v).decode() for m, v in opts.items()}
yc = collections.Counter()
for it in items:
    for y in it['y']: yc[y] += 1
data = dict(items=items, media=mediab64,
            years=[{"y": y, "n": yc[y]} for y in sorted(yc, reverse=True)])
json.dump(data, open('appdata.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print("appdata.json %.2f MB" % (os.path.getsize('appdata.json')/1e6))
print("빈칸 총 %d개 (텍스트 %d / 그림 %d)"
      % (sum(len(x['b']) for x in items),
         sum(1 for x in items for b in x['b'] if b['t'] == 'txt'),
         sum(1 for x in items for b in x['b'] if b['t'] == 'img')))
print("연도별:", {("20"+k): yc[k] for k in sorted(yc, reverse=True)})
