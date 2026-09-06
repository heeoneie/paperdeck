# -*- coding: utf-8 -*-
"""전기기사 단답형 서브노트 PDF -> Anki 공통 코어"""
import pymupdf, re, statistics, hashlib, io
import numpy as np
from scipy import ndimage

LX0, LX1 = 37.3, 289.6
OFF = 267.5
RX0, RX1 = LX0 + OFF, LX1 + OFF
BEIGE = (0.9804, 0.9529, 0.8588)
BTOL = 0.02

# 확인된 한컴 수식 글리프 매핑 (숫자는 E034=1 부터 순차, E03D=0)
GLYPH = {
    0xE034: "1", 0xE035: "2", 0xE036: "3", 0xE037: "4", 0xE038: "5",
    0xE039: "6", 0xE03A: "7", 0xE03B: "8", 0xE03C: "9", 0xE03D: "0",
    0xE046: "-", 0xE047: "=", 0xE048: "+", 0xE055: "<", 0xE056: ">",
}
SUP = {"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹",
       "-":"⁻","+":"⁺","=":"⁼"}
SUB = {"0":"₀","1":"₁","2":"₂","3":"₃","4":"₄","5":"₅","6":"₆","7":"₇","8":"₈","9":"₉",
       "-":"₋","+":"₊","=":"₌"}
DIGITS = set("0123456789")

def is_pua(ch):
    return 0xE000 <= ord(ch) <= 0xF8FF


# ---------------------------------------------------------------- 선분/행
def prims(page):
    """가로/세로 선분 목록. H=(x0,x1,y), V=(x,y0,y1)"""
    H, V = [], []
    for dr in page.get_drawings():
        if dr["type"] != "s":
            continue
        for it in dr["items"]:
            if it[0] == "l":
                a, b = it[1], it[2]
                if abs(a.y - b.y) < 0.6 and abs(a.x - b.x) > 2:
                    H.append((min(a.x, b.x), max(a.x, b.x), (a.y + b.y) / 2))
                elif abs(a.x - b.x) < 0.6 and abs(a.y - b.y) > 2:
                    V.append(((a.x + b.x) / 2, min(a.y, b.y), max(a.y, b.y)))
            elif it[0] == "re":
                r = it[1]
                if r.height < 0.6 and r.width > 2:
                    H.append((r.x0, r.x1, (r.y0 + r.y1) / 2))
                elif r.width < 0.6 and r.height > 2:
                    V.append(((r.x0 + r.x1) / 2, r.y0, r.y1))
    return H, V


def row_bounds(page):
    """왼쪽 단 전체 폭을 가로지르는 가로 실선의 y = 행 경계"""
    H, _ = prims(page)
    ys = set()
    for a, b, y in H:
        if a < LX0 + 2 and b > LX1 - 2:
            ys.add(round(y, 1))
    return sorted(ys)


def beige_rects(page, x0, x1):
    """지정 x 범위 안의 베이지 채움 사각형"""
    out = []
    for dr in page.get_drawings():
        f = dr.get("fill")
        if not f or len(f) < 3:
            continue
        if all(abs(f[i] - BEIGE[i]) < BTOL for i in range(3)):
            r = dr["rect"]
            if r.x0 > x0 - 2 and r.x1 < x1 + 2 and r.width > 1 and r.height > 1:
                out.append(pymupdf.Rect(r))
    return out


# ---------------------------------------------------------------- 텍스트
def spans_in(page, rect):
    """rect 안의 스팬. 흰색 글자 제외. (텍스트, bbox, origin_y, size) 를 줄 단위로."""
    out = []
    d = page.get_text("dict", clip=rect)
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            ss = []
            for s in l["spans"]:
                if s["color"] == 0xFFFFFF:
                    continue
                if not s["text"]:
                    continue
                ss.append(s)
            if ss:
                out.append(ss)
    out.sort(key=lambda ss: (round(ss[0]["bbox"][1], 1), ss[0]["bbox"][0]))
    return out


def render_line(spans):
    """한 줄의 스팬들을 텍스트로. PUA 는 매핑+위/아래첨자 판정.
    반환 (텍스트, 미매핑글리프있음, x0)"""
    base = [s["origin"][1] for s in spans if any(not is_pua(c) for c in s["text"])]
    med = statistics.median(base) if base else None
    parts, bad = [], False
    for s in spans:
        t = s["text"]
        if not any(is_pua(c) for c in t):
            parts.append(t)
            continue
        oy = s["origin"][1]
        rel = 0
        if med is not None:
            if oy < med - 1.2:
                rel = 1
            elif oy > med + 1.2:
                rel = -1
        for ch in t:
            o = ord(ch)
            if not is_pua(ch):
                parts.append(ch)
            elif o in (0xE05C, 0xE06D):      # 근호 계열 – 복원 불가
                bad = True
            elif o in GLYPH:
                m = GLYPH[o]
                if rel == 1 and m in SUP:
                    parts.append(SUP[m])
                elif rel == -1 and m in SUB:
                    parts.append(SUB[m])
                else:
                    parts.append(m)
            else:
                bad = True
    return "".join(parts), bad, spans[0]["bbox"][0]


def rect_lines(page, rect):
    """rect 의 줄 목록 [(text, bad, x0, y0)]"""
    res = []
    for ss in spans_in(page, rect):
        t, bad, x0 = render_line(ss)
        if t.strip() or bad:
            res.append((t.rstrip(), bad, x0, ss[0]["bbox"][1]))
    return res


def rect_text(page, rect):
    ls = rect_lines(page, rect)
    return " ".join(l[0].strip() for l in ls).strip(), any(l[1] for l in ls)


# ---------------------------------------------------------------- 잉크 비교
_PIXCACHE = {}

def _pix(page, rect, dpi=200):
    key = (page.number, round(rect.x0, 1), round(rect.y0, 1), round(rect.x1, 1), round(rect.y1, 1), dpi)
    if key in _PIXCACHE:
        return _PIXCACHE[key]
    m = pymupdf.Matrix(dpi / 72, dpi / 72)
    p = page.get_pixmap(matrix=m, clip=rect, colorspace=pymupdf.csGRAY, alpha=False)
    a = np.frombuffer(p.samples, dtype=np.uint8).reshape(p.height, p.width)
    if len(_PIXCACHE) > 400:
        _PIXCACHE.clear()
    _PIXCACHE[key] = a
    return a


def ink_compare(page, y0, y1, dpi=200):
    """왼쪽/오른쪽 크롭의 잉크 비교. (L_only, R_ink, L_ink)"""
    L = _pix(page, pymupdf.Rect(LX0, y0, LX1, y1), dpi) < 175
    R = _pix(page, pymupdf.Rect(RX0, y0, RX1, y1), dpi) < 175
    h = min(L.shape[0], R.shape[0]); w = min(L.shape[1], R.shape[1])
    L = L[:h, :w]; R = R[:h, :w]
    Rd = ndimage.binary_dilation(R, structure=np.ones((9, 9), bool))
    return int((L & ~Rd).sum()), int(R.sum()), int(L.sum())


# ---------------------------------------------------------------- 이미지
def crop_png(page, rect, dpi=200, pad=1.5):
    r = pymupdf.Rect(rect.x0 - pad, rect.y0 - pad, rect.x1 + pad, rect.y1 + pad) & page.rect
    m = pymupdf.Matrix(dpi / 72, dpi / 72)
    p = page.get_pixmap(matrix=m, clip=r, alpha=False)
    return p.tobytes("png")


def trim_png(data, thr=248):
    from PIL import Image
    im = Image.open(io.BytesIO(data)).convert("RGB")
    a = np.asarray(im)
    mask = (a < thr).any(axis=2)
    if not mask.any():
        return data
    ys, xs = np.where(mask)
    b = 4
    box = (max(0, xs.min() - b), max(0, ys.min() - b),
           min(a.shape[1], xs.max() + 1 + b), min(a.shape[0], ys.max() + 1 + b))
    out = io.BytesIO()
    im.crop(box).save(out, format="PNG", optimize=True)
    return out.getvalue()


def media_name(data):
    return "ek_" + hashlib.md5(data).hexdigest()[:12] + ".png"


def iou(a, b):
    ix = max(0.0, min(a.x1, b.x1) - max(a.x0, b.x0))
    iy = max(0.0, min(a.y1, b.y1) - max(a.y0, b.y0))
    inter = ix * iy
    u = a.get_area() + b.get_area() - inter
    return inter / u if u > 0 else 0.0


# ---------------------------------------------------------------- 페이지 캐시
_PC = {}

class PageCache:
    def __init__(self, page):
        self.page = page
        H, V = prims(page)
        self.H, self.V = H, V
        self.beige = []
        for dr in page.get_drawings():
            f = dr.get("fill")
            if f and len(f) >= 3 and all(abs(f[i] - BEIGE[i]) < BTOL for i in range(3)):
                r = dr["rect"]
                if r.width > 1 and r.height > 1:
                    self.beige.append(pymupdf.Rect(r))
        ys = set()
        for a, b, y in H:
            if a < LX0 + 2 and b > LX1 - 2:
                ys.add(round(y, 1))
        self.rows = sorted(ys)
        # 줄 단위 스팬 (흰색 제외)
        self.lines = []
        for blk in page.get_text("dict")["blocks"]:
            if blk["type"] != 0:
                continue
            for l in blk["lines"]:
                ss = [s for s in l["spans"] if s["color"] != 0xFFFFFF and s["text"]]
                if not ss:
                    continue
                x0 = min(s["bbox"][0] for s in ss)
                x1 = max(s["bbox"][2] for s in ss)
                y0 = min(s["bbox"][1] for s in ss)
                y1 = max(s["bbox"][3] for s in ss)
                t, bad, _ = render_line(ss)
                self.lines.append(dict(text=t.rstrip(), bad=bad, x0=x0, x1=x1,
                                       y0=y0, y1=y1, spans=ss))
        self.lines.sort(key=lambda d: (round(d["y0"], 1), d["x0"]))

    def lines_in(self, rect):
        out = []
        for d in self.lines:
            cx = (d["x0"] + d["x1"]) / 2
            cy = (d["y0"] + d["y1"]) / 2
            if rect.x0 <= cx <= rect.x1 and rect.y0 <= cy <= rect.y1:
                out.append(d)
        return out

    def beige_in(self, rect):
        out = []
        for r in self.beige:
            cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
            if rect.x0 - 1 <= cx <= rect.x1 + 1 and rect.y0 - 1 <= cy <= rect.y1 + 1:
                out.append(r)
        return out


def pc(page):
    k = (id(page.parent), page.number)
    if k not in _PC:
        if len(_PC) > 8:
            _PC.clear()
        _PC[k] = PageCache(page)
    return _PC[k]


# ---------------------------------------------------------------- 시각 줄 병합
def visual_lines(cache, rect, ytol=6.0):
    """rect 안의 PDF 줄들을 baseline 근접도로 묶어 시각적 한 줄로. x 순 정렬."""
    ls = [d for d in cache.lines_in(rect)]
    ls.sort(key=lambda d: ((d["y0"] + d["y1"]) / 2, d["x0"]))
    out = []
    for d in ls:
        cy = (d["y0"] + d["y1"]) / 2
        if out and abs(cy - out[-1]["cy"]) <= ytol:
            g = out[-1]
            g["pieces"].append(d)
            g["cy"] = (g["cy"] * (len(g["pieces"]) - 1) + cy) / len(g["pieces"])
        else:
            out.append(dict(cy=cy, pieces=[d]))
    for g in out:
        g["pieces"].sort(key=lambda d: d["x0"])
    return out


def covers(b, r, frac=0.55):
    """베이지 b 가 조각 r 을 덮는가 (가로 기준)"""
    ix = max(0.0, min(b.x1, r["x1"]) - max(b.x0, r["x0"]))
    iy = max(0.0, min(b.y1, r["y1"]) - max(b.y0, r["y0"]))
    if iy <= 1:
        return 0.0
    w = max(1e-6, r["x1"] - r["x0"])
    return ix / w


# ---------------------------------------------------------------- 격자 폴백
def _snap(v, q=0.5):
    return round(round(v / q) * q, 2)


def _covered(segs, a, b, tol=1.5):
    """[a,b] 구간이 segs 중 하나에 (거의) 포함되는가"""
    for s0, s1 in segs:
        if s0 <= a + tol and s1 >= b - tol:
            return True
    # 여러 조각의 합집합으로도 인정
    pts = sorted((max(s0, a), min(s1, b)) for s0, s1 in segs if s1 > a and s0 < b)
    cov, cur = 0.0, a
    for s0, s1 in pts:
        if s1 <= cur:
            continue
        cov += s1 - max(s0, cur)
        cur = max(cur, s1)
    return cov >= (b - a) - tol


def grid_cells(cache, rect):
    """선분에서 표 격자를 직접 복원. [(r,c,rs,cs,Rect)]
    표 자신의 세로선이 만드는 영역만 격자로 본다 (블록 외곽 테두리 배제)."""
    V = [(v[0], v[1], v[2]) for v in cache.V
         if rect.x0 - 2 <= v[0] <= rect.x1 + 2
         and v[1] >= rect.y0 - 2 and v[2] <= rect.y1 + 2]
    if len(V) < 2:
        return []
    tx0 = min(v[0] for v in V); tx1 = max(v[0] for v in V)
    ty0 = min(v[1] for v in V); ty1 = max(v[2] for v in V)
    if tx1 - tx0 < 8 or ty1 - ty0 < 8:
        return []
    H = [(h[0], h[1], h[2]) for h in cache.H if ty0 - 2 <= h[2] <= ty1 + 2]

    xs = sorted({_snap(v[0]) for v in V})
    hseg, vseg = {}, {}
    for a, b, y in H:
        hseg.setdefault(_snap(y), []).append((a, b))
    for x, a, b in V:
        vseg.setdefault(_snap(x), []).append((a, b))
    ys = sorted({y for y in hseg if _covered(hseg[y], tx0, tx1)})
    if len(ys) < 2 or len(xs) < 2:
        return []

    nR, nC = len(ys) - 1, len(xs) - 1
    used = [[False] * nC for _ in range(nR)]
    cells = []
    for i in range(nR):
        for j in range(nC):
            if used[i][j]:
                continue
            if not _covered(hseg.get(ys[i], []), xs[j], xs[j + 1]):
                continue
            if not _covered(vseg.get(xs[j], []), ys[i], ys[i + 1]):
                continue
            cs = 1
            while j + cs < nC and not _covered(vseg.get(xs[j + cs], []), ys[i], ys[i + 1]):
                cs += 1
            if j + cs > nC or not _covered(vseg.get(xs[j + cs], []), ys[i], ys[i + 1]):
                continue
            rs = 1
            while i + rs < nR and not _covered(hseg.get(ys[i + rs], []), xs[j], xs[j + cs]):
                rs += 1
            if i + rs > nR or not _covered(hseg.get(ys[i + rs], []), xs[j], xs[j + cs]):
                continue
            for a in range(i, min(nR, i + rs)):
                for b in range(j, min(nC, j + cs)):
                    used[a][b] = True
            cells.append((i, j, rs, cs,
                          pymupdf.Rect(xs[j], ys[i], xs[j + cs], ys[i + rs])))
    return cells
