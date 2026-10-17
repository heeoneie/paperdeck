#!/usr/bin/env python3
"""번호 매긴 객관식 문제집 PDF -> paperdeck 데이터

전기기사 변환기(tools/extract-ek/)는 그 책 한 권 전용이다. 이 스크립트는 흔한 모양의
기출 PDF 를 일반적으로 다룬다.

  - 문제는 줄 맨 앞의 `1.` `2.` … 번호로 시작하고, 보기는 ①~⑩ 으로 시작한다.
  - 1단·2단 조판 모두 된다(2단은 왼쪽 단 → 오른쪽 단 순서로 읽는다).
  - 정답은 두 가지 중 하나에서 읽는다.
      문제 바로 아래 `정답: 2` (`■ 정답：2, 4` 처럼 복수 정답도 가능) · `해설:` 은 풀이로
      따로 정답표 PDF (`--key`) — `1 ③ 2 ① …` 처럼 번호와 정답이 짝지어 나오는 표

문제를 보여주는 방식(--mode)
  image  문제 영역을 그림으로 잘라 넣는다. 박스·도표·그림이 많은 시험지도 원본 그대로 보인다.
         보기 글자를 읽을 수 있으면 보기는 글자 버튼으로, 아니면 보기까지 그림에 넣고 번호 버튼만 둔다.
  text   글자로 넣고 문제 속 그림만 따로 잘라 붙인다. 글자 위주 문제집에 알맞다(검색·확대에 유리).

사용 예
  # 정답이 문제 아래 붙어 있는 문제은행
  python tools/pdf2deck.py 문제은행.pdf -o deck.json --mode text --title "운전면허 학과시험"

  # 시험지 + 정답표, 여러 과목·회차를 한 문제집으로 모으기 (--append)
  python tools/pdf2deck.py 한국사.pdf --key 정답.pdf --key-match 한국사 \\
      --round "2026년 2회" -o deck.json --title "고졸 검정고시"
  python tools/pdf2deck.py 사회.pdf --key 정답.pdf --key-match 사회 \\
      --round "2026년 2회" --append -o deck.json

만든 파일은 앱의 '파일에서 추가' 로 바로 불러올 수 있다. 사이트에 넣으려면 publish-dataset.py.
"""
import argparse, base64, collections, hashlib, html, io, json, os, re, sys

import pymupdf
from PIL import Image

CIRC = '①②③④⑤⑥⑦⑧⑨⑩'
ANCHOR = re.compile(r'^\s*(\d{1,4})\s*[.．]\s*(?!\d)(.*)$')
ANS = re.compile(r'^\s*[■□▶◆●\[]?\s*정\s*답\s*\]?\s*[:：]?\s*(.*)$')
EXP = re.compile(r'^\s*[■□▶◆●\[]?\s*(?:해\s*설|풀\s*이)\s*\]?\s*[:：]?\s*(.*)$')
# 보기 번호로 쓰이는 다른 동그라미 숫자(➀ ❶ ⓵ …)는 ①~⑩ 으로 맞춘다
CIRC_ALT = str.maketrans(dict(zip(
    [chr(c) for c in range(0x2780, 0x278A)] + [chr(c) for c in range(0x2776, 0x2780)] +
    [chr(c) for c in range(0x24F5, 0x24FF)] + ['ⓛ'],      # ⓛ: ① 대신 잘못 친 글자
    CIRC * 3 + '①')))
DPI = 144            # 그림으로 자를 때 해상도
MAXW = 720           # 앱에 넣는 그림 최대 폭(px)


def esc(s):
    return html.escape(s, quote=False)


def circ_digits(s):
    """'2, 4' · '②④' · '2. 4' -> [1, 3] (0부터)"""
    out = []
    for ch in re.findall(r'[①-⑩]|\d+', s):
        k = CIRC.index(ch) + 1 if ch in CIRC else int(ch)
        if 1 <= k <= 10 and k - 1 not in out:
            out.append(k - 1)
    return out


# ---------------------------------------------------------------- 페이지 읽기
class Page:
    def __init__(self, doc, pi):
        p = self.p = doc[pi]
        self.pi, self.W, self.H = pi, p.rect.width, p.rect.height
        self.lines = []
        for b in p.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                t = ''.join(s['text'] for s in l['spans']).translate(CIRC_ALT)
                if t.strip():
                    x0, y0, x1, y1 = l['bbox']
                    self.lines.append(dict(t=t, x0=x0, y0=y0, x1=x1, y1=y1, pi=pi))
        self.imgs = []
        for info in p.get_image_info(xrefs=True):
            x0, y0, x1, y1 = info['bbox']
            if (x1 - x0) > 12 and (y1 - y0) > 12:
                self.imgs.append(dict(x0=x0, y0=y0, x1=x1, y1=y1, xref=info.get('xref', 0), pi=pi))
        self.draws = []
        for d in p.get_drawings():
            r = d['rect']
            self.draws.append(dict(x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1, pi=pi))
        self.split = self._columns()
        self._edge = {}

    def _columns(self):
        """2단이면 단 경계 x, 1단이면 None"""
        mid = self.W / 2
        body = [l for l in self.lines if self.H * 0.06 < l['y0'] < self.H * 0.94]
        if len(body) < 8:
            return None
        cross = [l for l in body if l['x0'] < mid - 4 and l['x1'] > mid + 4]
        left = [l for l in body if l['x1'] <= mid + 4]
        right = [l for l in body if l['x0'] >= mid - 4]
        if len(cross) <= 0.06 * len(body) and len(left) >= 4 and len(right) >= 4:
            return mid
        return None

    def col(self, o):
        if self.split is None:
            return 0
        if o['x0'] < self.split - 4 and o['x1'] > self.split + 4:
            return -1                       # 단을 가로지르는 것 = 머리말·꼬리말
        return 0 if (o['x0'] + o['x1']) / 2 < self.split else 1

    def col_x(self, c):
        if self.split is None:
            return 0, self.W
        return (0, self.split) if c == 0 else (self.split, self.W)

    def col_edge(self, c):
        """단에서 글줄이 실제로 시작하는 x. 여백 폭은 문서마다 달라 쪽 가장자리로 재면 안 된다.
        머리말·꼬리말을 뺀 줄들의 왼쪽 끝 중 아래쪽 10% 지점(튀는 줄 몇 개는 무시)"""
        if c not in self._edge:
            xs = sorted(l['x0'] for l in self.lines
                        if l['y0'] > self.H * 0.1 and l['y1'] < self.H * 0.9 and self.col(l) == c)
            self._edge[c] = xs[int(len(xs) * 0.1)] if len(xs) >= 3 else self.col_x(c)[0]
        return self._edge[c]


def repeated_lines(pages):
    """여러 쪽에 같은 자리에 반복되는 줄(쪽 번호·머리말) — 숫자는 무시하고 비교"""
    cnt = collections.Counter()
    for pg in pages:
        seen = set()
        for l in pg.lines:
            if l['y0'] < pg.H * 0.1 or l['y1'] > pg.H * 0.9:
                k = re.sub(r'\d+', '#', l['t'].strip())
                if k not in seen:
                    seen.add(k); cnt[k] += 1
    n = len(pages)
    return {k for k, v in cnt.items() if n >= 3 and v >= max(3, n * 0.3)}


def stream(pages):
    """읽는 순서(쪽 → 단 → 위에서 아래)로 줄을 늘어놓는다"""
    rep = repeated_lines(pages)
    out, first_seen = [], [False]
    for pg in pages:
        ls = []
        for l in pg.lines:
            c = pg.col(l)
            if c < 0:
                continue
            if (l['y0'] < pg.H * 0.1 or l['y1'] > pg.H * 0.9) and \
               re.sub(r'\d+', '#', l['t'].strip()) in rep:
                continue
            l['c'] = c
            ls.append(l)
        ls.sort(key=lambda l: (l['c'], round(l['y0'] / 3), l['x0']))
        # 시험지 제목처럼 머리에만 있는 것: 첫 문제 번호가 나오는 쪽에서만, 그 번호보다 위의 줄을 버린다.
        # 다른 쪽에서는 위쪽에 앞 문제의 보기가 이어질 수 있어 건드리지 않는다(반복되는 머리말은 위에서 걸러짐).
        tops = [l['y0'] for l in ls if ANCHOR.match(l['t'])]
        if tops and not first_seen[0]:
            first_seen[0] = True
            if min(tops) < pg.H * 0.2:
                ls = [l for l in ls if not l['y1'] < min(tops) - 1]
        out += ls
    return out


def find_anchors(lines, pages):
    """문제 번호 줄. 번호가 앞 번호보다 크고(빠진 번호는 몇 개까지 허용) 단의 글줄 왼쪽 끝 가까이에 있어야 한다."""
    last, idx = 0, []
    for i, l in enumerate(lines):
        m = ANCHOR.match(l['t'])
        if not m:
            continue
        n = int(m.group(1))
        pg = pages[l['pi']]
        # 번호는 글줄 시작에 붙어 있다 — 글자 한 자 넘게 들여 쓴 '1.' 은 지문 속 목록
        if l['x0'] - pg.col_edge(l['c']) > (l['y1'] - l['y0']) * 0.9:
            continue
        if last < n <= last + 6:
            idx.append((i, n)); last = n
    return idx


# ---------------------------------------------------------------- 문제 한 개
def split_choices(lines):
    """보기 줄들 -> {번호: 글자}. 한 줄에 보기가 여러 개 있어도 된다."""
    txt = ' '.join(l['t'].strip() for l in lines)
    parts = re.split(r'([①-⑩])', txt)
    out = {}
    for i in range(1, len(parts) - 1, 2):
        out[CIRC.index(parts[i])] = re.sub(r'\s+', ' ', parts[i + 1]).strip()
    return out


def join_text(lines):
    s = ' '.join(l['t'].strip() for l in lines)
    return re.sub(r'\s+', ' ', s).strip()


class Media:
    def __init__(self, prefix):
        self.prefix, self.data = prefix, {}

    def add(self, im):
        im = shrink(im)
        name, data = encode(im)
        key = '%s_%s.%s' % (self.prefix, hashlib.sha1(data).hexdigest()[:12], name)
        self.data[key] = base64.b64encode(data).decode()
        return key


def shrink(im):
    if im.width > MAXW:
        im = im.resize((MAXW, round(im.height * MAXW / im.width)), Image.LANCZOS)
    return im


def encode(im):
    """글자·선 위주면 회색 16색 PNG, 사진이면 JPEG"""
    rgb = im.convert('RGB')
    small = rgb.resize((max(1, rgb.width // 4), max(1, rgb.height // 4)))
    px = list(small.getdata()) if not hasattr(small, 'get_flattened_data') else list(small.get_flattened_data())
    colored = sum(1 for r, g, b in px if max(r, g, b) - min(r, g, b) > 28) / max(1, len(px))
    distinct = len(set(px))
    if colored < 0.01 and distinct < 4000:
        buf = io.BytesIO(); rgb.convert('L').quantize(colors=16).save(buf, 'PNG', optimize=True)
        return 'png', buf.getvalue()
    if distinct < 1500:
        buf = io.BytesIO(); rgb.quantize(colors=64).save(buf, 'PNG', optimize=True)
        return 'png', buf.getvalue()
    buf = io.BytesIO(); rgb.save(buf, 'JPEG', quality=72, optimize=True)
    return 'jpg', buf.getvalue()


def render(doc, pieces):
    """[(쪽, Rect)] 를 잘라 세로로 이어 붙인 그림"""
    ims = []
    for pi, r in pieces:
        pix = doc[pi].get_pixmap(dpi=DPI, clip=r)
        ims.append(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
    if not ims:
        return None
    w = max(i.width for i in ims)
    gap = 12
    out = Image.new('RGB', (w, sum(i.height for i in ims) + gap * (len(ims) - 1)), 'white')
    y = 0
    for i in ims:
        out.paste(i, (0, y)); y += i.height + gap
    return out


def objects_between(pages, a, b, kind):
    """읽는 순서상 줄 a 와 줄 b(없으면 끝) 사이에 놓인 그림/선"""
    out = []
    ka = (a['pi'], a['c'], a['y0'] - 2)
    kb = (b['pi'], b['c'], b['y0'] - 2) if b else (10 ** 9, 0, 0)
    for pg in pages[a['pi']:(b['pi'] + 1 if b else len(pages))]:
        for o in getattr(pg, kind):
            c = pg.col(o)
            if c < 0:
                continue
            # 그림이 문제 번호 줄보다 살짝 위에서 시작하기도 해서 세로 가운데로 가른다
            k = (o['pi'], c, (o['y0'] + o['y1']) / 2)
            if ka <= k < kb:
                out.append(dict(o, c=c))
    return out


def pieces_of(pages, lines, objs, pad=4):
    """같은 쪽·단에 있는 것끼리 묶어 자를 영역을 만든다"""
    g = collections.OrderedDict()
    for o in lines + objs:
        g.setdefault((o['pi'], o['c']), []).append(o)
    out = []
    for (pi, c), os_ in g.items():
        pg = pages[pi]
        cx0, cx1 = pg.col_x(c)
        x0 = max(cx0, min(o['x0'] for o in os_) - pad)
        x1 = min(cx1, max(o['x1'] for o in os_) + pad)
        y0 = min(o['y0'] for o in os_) - pad
        y1 = max(o['y1'] for o in os_) + pad
        out.append((pi, pymupdf.Rect(x0, y0, x1, y1)))
    return out


def build_item(doc, pages, seg, nxt, no, mode, media, inline):
    """seg: 이 문제의 줄들(첫 줄이 번호 줄), nxt: 다음 문제 번호 줄"""
    # 정답·해설 줄 찾기
    qend, ans, exp = len(seg), None, []
    if inline:
        for i, l in enumerate(seg):
            m = ANS.match(l['t'])
            if m and i > 0:
                qend, ans = i, circ_digits(m.group(1))
                rest = seg[i + 1:]
                for j, r in enumerate(rest):
                    e = EXP.match(r['t'])
                    if e:
                        exp = [e.group(1)] + [x['t'].strip() for x in rest[j + 1:]]
                        break
                break
    q = seg[:qend]
    stop = seg[qend] if qend < len(seg) else nxt

    ci = next((i for i, l in enumerate(q) if i > 0 and l['t'].strip()[:1] in CIRC), None)
    stem = q[:ci] if ci is not None else q
    chl = q[ci:] if ci is not None else []
    hints = [l for l in chl if l['t'].strip().startswith('■')]
    chl = [l for l in chl if l not in hints]
    choices = split_choices(chl)
    nch = (max(choices) + 1) if choices else 0
    if nch < 2:
        return None, '보기를 찾지 못함'

    first = ANCHOR.match(stem[0]['t']).group(2)
    stem_txt = join_text([dict(t=first)] + stem[1:])
    title = stem_txt[:48] + ('…' if len(stem_txt) > 48 else '')

    imgs = objects_between(pages, seg[0], stop, 'imgs')
    text_ok = all(choices.get(k) for k in range(nch))

    if mode == 'text':
        h = '<div class="qs">%s</div>' % esc(stem_txt)
        if hints:
            h += '<ul class="qh">%s</ul>' % ''.join(
                '<li>%s</li>' % esc(l['t'].strip().lstrip('■').strip()) for l in hints)
        for o in imgs:
            h += '<img class="qi" src="%s">' % media.add(crop(doc, o))
        opts = [esc(choices.get(k, '')) or CIRC[k] for k in range(nch)]
    else:
        draws = objects_between(pages, seg[0], stop, 'draws')
        if text_ok:
            # 보기 앞까지만 그림으로 — 보기는 글자 버튼
            cut = chl[0] if chl else stop
            body = [l for l in stem + hints]
            objs = [o for o in imgs + draws
                    if (o['pi'], o['c'], (o['y0'] + o['y1']) / 2) < (cut['pi'], cut['c'], cut['y0'] - 2)]
            opts = [esc(choices[k]) for k in range(nch)]
        else:
            body, objs = q, imgs + draws
            opts = [CIRC[k] for k in range(nch)]
        objs = [o for o in objs if (o['x1'] - o['x0']) < 2000]
        im = render(doc, pieces_of(pages, body, objs))
        h = '<img class="qimg" src="%s" alt="%s">' % (media.add(im), esc(stem_txt[:200]).replace('"', '&quot;'))

    it = dict(q='mc', no=no, t=title, h=h, o=opts, p=seg[0]['pi'] + 1, s=stem_txt)
    if ans is not None:
        it['a'] = ans
    # 풀이: 글자 + 풀이 자리에 있는 그림
    ximgs = objects_between(pages, stop, nxt, 'imgs') if qend < len(seg) else []
    if exp or ximgs:
        it['x'] = esc(re.sub(r'\s+', ' ', ' '.join(exp)).strip()) + ''.join(
            '<img class="qi" src="%s">' % media.add(crop(doc, o)) for o in ximgs)
    return it, None


def crop(doc, o):
    pix = doc[o['pi']].get_pixmap(dpi=DPI, clip=pymupdf.Rect(o['x0'], o['y0'], o['x1'], o['y1']))
    return Image.frombytes('RGB', (pix.width, pix.height), pix.samples)


# ---------------------------------------------------------------- 정답표
def read_key(path, match):
    """정답표 PDF 에서 `번호 정답` 짝을 읽는다. match 가 있으면 그 글자가 들어 있는 쪽만."""
    doc = pymupdf.open(path)
    pages = [p for p in doc if not match or match in p.get_text()]
    if not pages:
        sys.exit('정답표에서 "%s" 가 들어 있는 쪽을 찾지 못했습니다.' % match)
    if match and len(pages) > 1:
        print('  ! 정답표에서 "%s" 가 들어 있는 쪽이 %d개 — 첫 쪽만 씁니다.' % (match, len(pages)))
    toks = re.findall(r'[①-⑩]+|\d+', pages[0].get_text())
    key = {}
    i = 0
    while i < len(toks) - 1:
        # '①'.isdigit() 도 True 라 isdigit 로 가르면 안 된다
        if toks[i][0] in '0123456789' and toks[i + 1][0] in CIRC:
            key[int(toks[i])] = circ_digits(toks[i + 1]); i += 2
        else:
            i += 1
    return key


# ---------------------------------------------------------------- 실행
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf')
    ap.add_argument('-o', '--out', required=True)
    ap.add_argument('--mode', choices=['image', 'text'], default='image')
    ap.add_argument('--key', help='정답표 PDF (없으면 문제 아래 `정답:` 줄에서 읽음)')
    ap.add_argument('--key-match', help='정답표에서 이 글자가 있는 쪽만 (예: 과목명)')
    ap.add_argument('--round', help='회차·출처 이름 (예: "2026년 2회 한국사")')
    ap.add_argument('--pages', help='쓸 쪽 범위, 1부터 (예: 1-40)')
    ap.add_argument('--title'); ap.add_argument('--subtitle')
    ap.add_argument('--id', help='문제집 id (기본: 제목에서 만듦)')
    ap.add_argument('--append', action='store_true', help='--out 파일이 있으면 거기에 더한다')
    a = ap.parse_args()

    doc = pymupdf.open(a.pdf)
    rng = range(doc.page_count)
    if a.pages:
        s, _, e = a.pages.partition('-')
        rng = range(int(s) - 1, int(e or s))
    pages = [None] * doc.page_count
    for pi in rng:
        pages[pi] = Page(doc, pi)
    used = [p for p in pages if p]
    lines = stream(used)
    anchors = find_anchors(lines, pages)
    print('%s: %d쪽 · 2단 %d쪽 · 문제 번호 %d개'
          % (os.path.basename(a.pdf), len(used), sum(1 for p in used if p.split), len(anchors)))

    key = read_key(a.key, a.key_match) if a.key else None
    rnd = a.round or ''
    m = re.search(r'(\d{4})\s*년', rnd)
    year = m.group(1)[2:] if m else None
    prefix = 'm' + hashlib.sha1((a.pdf + rnd).encode()).hexdigest()[:6]
    media = Media(prefix)

    items, skipped = [], []
    for j, (i, no) in enumerate(anchors):
        end = anchors[j + 1][0] if j + 1 < len(anchors) else len(lines)
        nxt = lines[end] if end < len(lines) else None
        it, why = build_item(doc, pages, lines[i:end], nxt, no, a.mode, media, inline=key is None)
        if not it:
            skipped.append((no, why)); continue
        if key is not None:
            it['a'] = key.get(no)
        if not it.get('a'):
            skipped.append((no, '정답 없음')); continue
        if max(it['a']) >= len(it['o']):
            skipped.append((no, '정답 번호가 보기 수보다 큼')); continue
        # 회차만으로는 --append 로 모은 과목끼리 번호가 겹친다 — 파일 이름도 넣는다
        base = os.path.splitext(os.path.basename(a.pdf))[0]
        it['id'] = '%s#%d' % (rnd + '|' + base if rnd else base, no)
        it['r'] = [rnd] if rnd else []
        it['y'] = [year] if year else []
        items.append(it)

    nums = [n for _, n in anchors]
    gaps = [n for n in range(1, (max(nums) if nums else 0) + 1) if n not in set(nums)]
    multi = sum(1 for x in items if len(x['a']) > 1)
    print('  문제 %d개 (복수 정답 %d) · 그림 %d장 · 건너뜀 %d' % (len(items), multi, len(media.data), len(skipped)))
    if gaps:
        print('  ! 못 찾은 번호:', gaps[:20], '…' if len(gaps) > 20 else '')
    for no, why in skipped[:20]:
        print('  ! %d번: %s' % (no, why))

    deck = dict(items=[], media={})
    if a.append and os.path.exists(a.out):
        deck = json.load(open(a.out, encoding='utf-8'))
        have = {x['id'] for x in deck['items']}
        dup = [x['id'] for x in items if x['id'] in have]
        if dup:
            deck['items'] = [x for x in deck['items'] if x['id'] not in set(dup)]
            print('  같은 id %d개는 새것으로 바꿈' % len(dup))
    deck['items'] += items
    deck['media'].update(media.data)
    for i, x in enumerate(deck['items']):
        x['i'] = i
    if a.title:
        deck['title'] = a.title
    if a.subtitle is not None:
        deck['subtitle'] = a.subtitle
    deck['title'] = deck.get('title') or os.path.splitext(os.path.basename(a.pdf))[0]
    deck['id'] = a.id or deck.get('id') or slug(deck['title'])
    yc = collections.Counter(y for x in deck['items'] for y in x.get('y', []))
    deck['years'] = [{'y': y, 'n': yc[y]} for y in sorted(yc, reverse=True)]

    body = json.dumps(deck, ensure_ascii=False, separators=(',', ':'))
    open(a.out, 'w', encoding='utf-8').write(body)
    print('-> %s  문제 %d개 · %.2f MB' % (a.out, len(deck['items']), len(body.encode()) / 1e6))


def slug(s):
    s = re.sub(r'\s+', '-', s.strip())
    s = re.sub(r'[^\w\-가-힣]', '', s)
    return s[:40] or 'deck'


if __name__ == '__main__':
    main()
