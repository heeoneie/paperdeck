# -*- coding: utf-8 -*-
"""블록 -> 카드 HTML 조립"""
import re, html, pymupdf
import ekcore as E

CLZ_L, CLZ_R = "{{c1::", "}}"

def esc(s):
    return html.escape(s, quote=False)

def cloze(s):
    return CLZ_L + s + CLZ_R


class Media(dict):
    def add(self, data):
        data = E.trim_png(data)
        n = E.media_name(data)
        self[n] = data
        return n


# ---------------------------------------------------------------- 조각 렌더
def piece_text(d):
    return d["text"].strip()


def split_beige(page, d, beiges):
    """조각 d 를 베이지 여부로 분할 -> [(text, is_ans)]"""
    hit = [b for b in beiges if E.covers(b, d) > 0.05]
    t = piece_text(d)
    if not hit:
        return [(t, False)]
    frac = max(E.covers(b, d) for b in hit)
    if frac >= 0.80:
        return [(t, True)]
    # 단어 단위 분할
    words = page.get_text("words", clip=pymupdf.Rect(d["x0"] - 1, d["y0"] - 1,
                                                     d["x1"] + 1, d["y1"] + 1))
    words = [w for w in words if w[4].strip()]
    words.sort(key=lambda w: w[0])
    if not words:
        return [(t, frac >= 0.5)]
    out, cur, curf = [], [], None
    for w in words:
        r = dict(x0=w[0], y0=w[1], x1=w[2], y1=w[3])
        f = any(E.covers(b, r) >= 0.5 for b in hit)
        if curf is None or f == curf:
            cur.append(w[4]); curf = f
        else:
            out.append((" ".join(cur), curf)); cur = [w[4]]; curf = f
    if cur:
        out.append((" ".join(cur), curf))
    return out


def render_pieces(page, pieces, beiges, group_fn):
    """조각 리스트 -> html. group_fn() 은 새 정답 그룹 id 를 준다."""
    parts, has = [], False
    for d in pieces:
        for txt, isans in split_beige(page, d, beiges):
            if not txt:
                continue
            if isans:
                g = group_fn()
                parts.append('<span class="blank" data-g="%d">%s</span>'
                             % (g, cloze(esc(txt))))
                has = True
            else:
                parts.append(esc(txt))
    return " ".join(parts), has


# ---------------------------------------------------------------- 표
def render_table(page, cache, rect, media, slot, rowseq, stats):
    cells = E.grid_cells(cache, rect)
    if len(cells) < 2:
        tf = page.find_tables(clip=rect, strategy='lines')
        cells = []
        for t in tf.tables:
            for i, row in enumerate(t.rows):
                for j, bb in enumerate(row.cells):
                    if bb:
                        cells.append((i, j, 1, 1, pymupdf.Rect(bb)))
    if len(cells) < 2:
        return None, []

    nR = max(c[0] + c[2] for c in cells)
    nC = max(c[1] + c[3] for c in cells)
    at = {(c[0], c[1]): c for c in cells}

    # 1차: 각 셀의 내용/정답 여부
    info = {}
    for (i, j), (_, _, rs, cs, rc) in at.items():
        inner = pymupdf.Rect(rc.x0 + 1.2, rc.y0 + 1.2, rc.x1 - 1.2, rc.y1 - 1.2)
        vl = E.visual_lines(cache, inner)
        for g in vl:
            g["pieces"] = [p for p in g["pieces"]
                           if p["text"].strip() not in ('∎', 'ㆍ', '')]
        vl = [g for g in vl if g["pieces"]]
        bz = cache.beige_in(inner)
        txt = " ".join(p["text"].strip() for g in vl for p in g["pieces"]).strip()
        bad = any(p["bad"] for g in vl for p in g["pieces"])
        info[(i, j)] = dict(rect=rc, inner=inner, vl=vl, bz=bz, txt=txt,
                            bad=bad, rs=rs, cs=cs, isans=bool(bz))
    nans = sum(1 for v in info.values() if v['isans'])
    percell = nans >= 4

    # 정답 슬롯 (열 우선)
    order = sorted([k for k in info if info[k]['isans']], key=lambda k: (k[1], k[0]))
    if percell:
        gmap = {k: slot((rowseq, k[1], k[0])) for k in order}
    else:
        g0 = slot((rowseq, 0, 0)) if order else None
        gmap = {k: g0 for k in order}

    hdrow = (nR >= 2 and all(not info[(0, j)]['isans']
                             for j in range(nC) if (0, j) in info)
             and any((0, j) in info for j in range(nC)))

    occ = [[False] * nC for _ in range(nR)]
    out = ['<table class="tb">']
    for i in range(nR):
        tds = []
        for j in range(nC):
            if occ[i][j]:
                continue
            v = info.get((i, j))
            if not v:
                tds.append('<td class="empty"></td>')
                occ[i][j] = True
                continue
            for a in range(i, i + v['rs']):
                for b in range(j, j + v['cs']):
                    occ[a][b] = True
            sp = ''
            if v['rs'] > 1: sp += ' rowspan="%d"' % v['rs']
            if v['cs'] > 1: sp += ' colspan="%d"' % v['cs']
            cls = 'hd' if (hdrow and i == 0) else ''
            g = gmap.get((i, j))
            ga = ' data-g="%d"' % g if g is not None else ''

            if v['bad']:
                stats['cell_img'] += 1
                n = media.add(E.crop_png(page, v['inner'], dpi=220))
                body = '<img class="%s" src="%s">' % (
                    'sym' if v['inner'].height <= 55 else 'fig', n)
                if v['isans']:
                    body = cloze(body)
            elif not v['txt']:
                pm = E._pix(page, v['inner'], 150)
                if (pm < 175).sum() > 30:
                    n = media.add(E.crop_png(page, v['inner'], dpi=220))
                    body = '<img class="%s" src="%s">' % (
                        'sym' if v['inner'].height <= 55 else 'fig', n)
                    if v['isans']:
                        body = cloze(body)
                else:
                    body = ''
            else:
                pieces = [p for gg in v['vl'] for p in gg['pieces']]
                if v['isans']:
                    tot = sum(b.get_area() for b in v['bz'])
                    if tot >= 0.80 * v['inner'].get_area():
                        body = cloze(esc(v['txt']))
                    else:
                        segs = []
                        for p in pieces:
                            segs += split_beige(page, p, v['bz'])
                        body = " ".join(cloze(esc(t)) if f else esc(t)
                                        for t, f in segs if t)
                else:
                    body = esc(v['txt'])
            cattr = ' class="hd"' if cls else ''
            tds.append('<td%s%s%s>%s</td>' % (sp, cattr, ga, body))
        out.append('<tr>' + ''.join(tds) + '</tr>')
    out.append('</table>')
    return ''.join(out), sorted(set(gmap.values()))


# ---------------------------------------------------------------- 블록 -> 카드
BULLET_SUB = 'ㆍ'
BULLET_ANS = '∎'


def build_block(doc, blk, media, stats):
    """반환 dict(text=필드HTML, ngroups=int, imgpairs=[...], notes=[...])"""
    slots = []

    def slot(key):
        slots.append(key)
        return len(slots) - 1

    rows = blk['rows']
    # 대문제 판정: 첫 ㆍ 이후 다음 ㆍ 전까지 정답성 행이 없으면 대문제
    subidx = [i for i, r in enumerate(rows)
              if r['kind'] == 'Q' and r['text'].lstrip().startswith(BULLET_SUB)]
    qmain = None
    if len(subidx) >= 2:
        a, b = subidx[0], subidx[1]
        if not any(rows[k]['kind'] in ('ANS', 'FILL', 'IMGA', 'HL')
                   for k in range(a + 1, b)):
            qmain = a

    parts = ['<div class="title">◇ %s</div>' % esc(blk['title'])]
    cur_slot = None          # 현재 소문제 그룹
    imgs = []                # (rect, hash) 중복 방지
    imgpairs = []
    used_groups = set()

    for ri, r in enumerate(rows):
        page = doc[r['page']]
        cache = E.pc(page)
        lrect = pymupdf.Rect(E.LX0, r['y0'] + 0.5, E.LX1, r['y1'] - 0.5)
        rrect = pymupdf.Rect(E.RX0, r['y0'] + 0.5, E.RX1, r['y1'] - 0.5)
        beiges = [pymupdf.Rect(*b) for b in r['beige']]
        k = r['kind']

        if k == 'Q':
            vl = E.visual_lines(cache, lrect)
            ln = [" ".join(p['text'].strip() for p in g['pieces']).strip()
                  for g in vl]
            ln = [re.sub(r'^[ㆍ∎]\s*', '', x).strip() for x in ln if x.strip()]
            txt = "<br>".join(esc(x) for x in ln)
            if not txt.strip():
                continue
            if ri == qmain:
                parts.append('<div class="qmain">%s</div>' % txt)
            elif r['text'].lstrip().startswith(BULLET_SUB):
                parts.append('<div class="sub">%s</div>' % txt)
                cur_slot = None
            else:
                parts.append('<div class="qmain">%s</div>' % txt)

        elif k == 'ANS':
            vl = E.visual_lines(cache, lrect)
            groups = []
            for g in vl:
                line = " ".join(p['text'].strip() for p in g['pieces']).strip()
                if line.startswith(BULLET_ANS) or not groups:
                    groups.append([re.sub(r'^\s*∎\s*', '', line)])
                else:
                    groups[-1].append(line)
            if cur_slot is None:
                cur_slot = slot((ri, 0, 0))
            used_groups.add(cur_slot)
            for gl in groups:
                body = "<br>".join(esc(x) for x in gl if x.strip())
                if not body.strip():
                    continue
                if r['bad']:
                    stats['ans_img'] += 1
                    n = media.add(E.crop_png(page, lrect, dpi=220))
                    parts.append('<div class="ansimg" data-g="%d">%s</div>'
                                 % (cur_slot, cloze('<img src="%s">' % n)))
                    break
                parts.append('<div class="ans" data-g="%d">%s</div>'
                             % (cur_slot, cloze(body)))

        elif k == 'FILL':
            cells = E.grid_cells(cache, lrect)
            if len(cells) >= 2:
                htmlt, gs = render_table(page, cache, lrect, media, slot, ri, stats)
                if htmlt:
                    parts.append(htmlt)
                    used_groups.update(gs)
                    cur_slot = None
                    continue
            if beiges and not r['bad']:
                s0 = len(slots)
                vl = E.visual_lines(cache, lrect)
                for g in vl:
                    g["pieces"] = [p for p in g["pieces"]
                                   if p["text"].strip() not in ('∎', 'ㆍ', '')]
                vl = [g for g in vl if g["pieces"]]
                lines_html, any_ans = [], False
                for g in vl:
                    h, ha = render_pieces(page, g['pieces'], beiges,
                                          lambda: slot((ri, len(slots), 0)))
                    any_ans = any_ans or ha
                    h = re.sub(r'^\s*[ㆍ∎]\s*', '', h).strip()
                    if h:
                        lines_html.append(h)
                if any_ans:
                    used_groups.update(range(s0, len(slots)))
                    parts.append('<div class="para">%s</div>'
                                 % "<br>".join(x for x in lines_html if x.strip()))
                    cur_slot = None
                    continue
            # 폴백: 통짜 이미지
            stats['fill_img'] += 1
            qn = media.add(E.crop_png(page, rrect, dpi=200))
            an = media.add(E.crop_png(page, lrect, dpi=200))
            s = slot((ri, 0, 0)); used_groups.add(s)
            parts.append('<img src="%s">' % qn)
            parts.append('<div class="ansimg" data-g="%d">%s</div>'
                         % (s, cloze('<img src="%s">' % an)))
            imgpairs.append(dict(title=blk['title'], page=r['page'],
                                 y=(round(r['y0'], 1), round(r['y1'], 1)),
                                 why='FILL: 격자/베이지 인식 실패' +
                                     (' + 미매핑 수식' if r['bad'] else '')))
            cur_slot = None

        elif k == 'IMGQ':
            data = E.trim_png(E.crop_png(page, lrect, dpi=200))
            h = E.media_name(data)
            if any(h == hh for _, hh in imgs) or \
               any(E.iou(lrect, rr) > 0.6 for rr, _ in imgs):
                stats['img_dedup'] += 1
                continue
            imgs.append((lrect, h))
            media[h] = data
            parts.append('<img src="%s">' % h)

        elif k in ('IMGA', 'HL'):
            qdata = E.trim_png(E.crop_png(page, rrect, dpi=200))
            qh = E.media_name(qdata)
            adata = E.trim_png(E.crop_png(page, lrect, dpi=200))
            ah = E.media_name(adata)
            if not any(qh == hh for _, hh in imgs):
                media[qh] = qdata
                imgs.append((rrect, qh))
                parts.append('<img src="%s">' % qh)
            media[ah] = adata
            s = cur_slot if cur_slot is not None else slot((ri, 0, 0))
            cur_slot = s
            used_groups.add(s)
            parts.append('<div class="ansimg" data-g="%d">%s</div>'
                         % (s, cloze('<img src="%s">' % ah)))
            imgpairs.append(dict(title=blk['title'], page=r['page'],
                                 y=(round(r['y0'], 1), round(r['y1'], 1)),
                                 why='그림 정답 (회로도/도면 작도형)'))

    body = "\n".join(parts)
    # 슬롯 -> 실제 공개 순서
    live = sorted(used_groups, key=lambda i: slots[i])
    rank = {s: n + 1 for n, s in enumerate(live)}
    def sub(m):
        i = int(m.group(1))
        return 'data-g="%d"' % rank.get(i, 0)
    body = re.sub(r'data-g="(\d+)"', sub, body)
    body = re.sub(r'<div class="(ans|ansimg)" data-g="0">.*?</div>', '', body)
    return dict(text=body, ngroups=len(live), imgpairs=imgpairs)
