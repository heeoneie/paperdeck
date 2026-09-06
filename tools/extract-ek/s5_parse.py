# -*- coding: utf-8 -*-
"""전체 페이지 행 구조 1회 파싱 -> blocks.pkl 캐시"""
import sys, re, pickle, time, pymupdf, collections
sys.path.insert(0, '.')
import ekcore as E

D = pymupdf.open('clean.pdf')
TAG = re.compile(r'\[(\d{2})-(\d)\]')

def norm(s):
    return re.sub(r'[∎ㆍ◇\s]', '', s)

def slim(ls):
    return [dict(text=d["text"], bad=d["bad"], x0=d["x0"], x1=d["x1"],
                 y0=d["y0"], y1=d["y1"]) for d in ls]

def classify(c, y0, y1):
    lr = pymupdf.Rect(E.LX0, y0 + 0.5, E.LX1, y1 - 0.5)
    rr = pymupdf.Rect(E.RX0, y0 + 0.5, E.RX1, y1 - 0.5)
    ll, rl = c.lines_in(lr), c.lines_in(rr)
    lt = " ".join(x["text"].strip() for x in ll)
    rt = " ".join(x["text"].strip() for x in rl)
    nl, nr = norm(lt), norm(rt)
    bad = any(x["bad"] for x in ll)
    lbz, rbz = c.beige_in(lr), c.beige_in(rr)
    base = dict(lines=slim(ll), bad=bad,
                beige=[tuple(b) for b in lbz], nbeige_r=len(rbz))
    if not nl and not nr:
        lo, ri, li = E.ink_compare(c.page, y0 + 0.5, y1 - 0.5)
        if li <= 40 and ri <= 40:
            return None
        base.update(kind='IMGA' if lo > 40 else 'IMGQ', lonly=lo, rink=ri)
        return base
    if nl == nr:
        # 텍스트는 같아도 왼쪽에만 그림/색칠 정답이 있는 경우
        if len(lbz) > len(rbz):
            base['kind'] = 'HL'
            return base
        if (y1 - y0) > 35:
            lo, ri, li = E.ink_compare(c.page, y0 + 0.5, y1 - 0.5)
            if lo > 200:
                base.update(kind='HL', lonly=lo, rink=ri)
                return base
        base['kind'] = 'Q'
        return base
    base['kind'] = 'ANS' if not nr else 'FILL'
    return base


blocks, cur = [], None
nrows = nskip = 0
t0 = time.time()
for pi in range(D.page_count):
    p = D[pi]
    c = E.pc(p)
    ys = c.rows
    for i in range(len(ys) - 1):
        y0, y1 = ys[i], ys[i + 1]
        r = classify(c, y0, y1)
        nrows += 1
        if r is None:
            nskip += 1
            continue
        r.update(page=pi, y0=y0, y1=y1)
        txt = " ".join(x["text"].strip() for x in r['lines']).strip()
        r['text'] = txt
        if txt.startswith('◇'):
            if cur and cur['rows']:
                blocks.append(cur)
            cur = dict(title=txt.lstrip('◇ ').strip(), rows=[], tags=[], pages=set())
            continue
        if cur is None:
            continue
        if txt.startswith('과년도'):
            cur['tags'] = TAG.findall(txt)
            cur['pages'].add(pi)
            blocks.append(cur)
            cur = None
            continue
        cur['rows'].append(r)
        cur['pages'].add(pi)
    if pi % 20 == 0:
        print(f"\rpage {pi+1}/{D.page_count} blocks={len(blocks)} {time.time()-t0:.0f}s", end='', flush=True)
if cur and cur['rows']:
    blocks.append(cur)
print(f"\rdone {D.page_count} pages in {time.time()-t0:.0f}s" + " " * 30)

for b in blocks:
    b['pages'] = sorted(b['pages'])
pickle.dump(blocks, open('blocks.pkl', 'wb'))

kc = collections.Counter(r['kind'] for b in blocks for r in b['rows'])
print("rows:", nrows, "spacer skipped:", nskip)
print("blocks:", len(blocks), "| no-tag:", sum(1 for b in blocks if not b['tags']),
      "| no-rows:", sum(1 for b in blocks if not b['rows']))
print("row kinds:", dict(kc))
yc = collections.Counter()
for b in blocks:
    for y in set(t[0] for t in b['tags']):
        yc[y] += 1
print("blocks/year:", {"20" + k: yc[k] for k in sorted(yc)})
