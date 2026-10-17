/* ============ paperdeck — 브라우저 안 PDF -> 문제집 변환 ============
   tools/pdf2deck.py 를 PDF.js 로 옮긴 것. PDF 는 기기 밖으로 나가지 않는다.

   번호 매긴 객관식 문제집을 다룬다.
   - 문제는 줄 맨 앞의 `1.` `2.` …, 보기는 ①~⑩ 으로 시작한다. 1단·2단 조판 모두.
   - 정답은 문제 아래 `정답: 2` 줄(`■ 정답：2, 4` 처럼 복수 정답도) 또는 따로 받은 정답표 PDF.
   - 2단 시험지(박스·도표가 많다)는 문제를 원본 그대로 그림으로 잘라 넣고,
     1단 문제집은 글자로 넣고 문제 속 그림만 잘라 붙인다. */

var BASE = new URL('vendor/pdfjs/', document.baseURI).href;
var L = null;
var CIRC = '①②③④⑤⑥⑦⑧⑨⑩';
/* 보기 번호로 쓰이는 다른 동그라미 숫자(➀ ❶ ⓵ …)와 ① 대신 잘못 친 ⓛ */
var ALT = {};
for (var c = 0; c < 10; c++) {
  ALT[String.fromCharCode(0x2780 + c)] = CIRC[c];
  ALT[String.fromCharCode(0x2776 + c)] = CIRC[c];
  ALT[String.fromCharCode(0x24F5 + c)] = CIRC[c];
}
ALT['ⓛ'] = '①';
var ALT_RE = new RegExp('[' + Object.keys(ALT).join('') + ']', 'g');

var ANCHOR = /^\s*(\d{1,4})\s*[.．]\s*(?!\d)(.*)$/;
var ANS = /^\s*[■□▶◆●\[]?\s*정\s*답\s*\]?\s*[:：]?\s*(.*)$/;
var EXP = /^\s*[■□▶◆●\[]?\s*(?:해\s*설|풀\s*이)\s*\]?\s*[:：]?\s*(.*)$/;
var SCALE = 2;          /* 그림으로 자를 때 배율 (144dpi) */
var MAXW = 720;         /* 앱에 넣는 그림 최대 폭(px) */

async function pdfjs() {
  if (!L) {
    L = await import(BASE + 'pdf.min.mjs');
    L.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';
  }
  return L;
}
async function openPdf(file) {
  await pdfjs();
  var data = new Uint8Array(await file.arrayBuffer());
  var task = L.getDocument({
    data: data, cMapUrl: BASE + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: BASE + 'standard_fonts/', wasmUrl: BASE + 'wasm/'
  });
  var doc;
  try { doc = await task.promise; }
  catch (e) {
    try { task.destroy(); } catch (e2) {}
    throw /password/i.test(e && e.name || '') ? new Error('암호가 걸린 PDF 는 열 수 없습니다.') : e;
  }
  doc.closeAll = function () { try { task.destroy(); } catch (e) {} };
  return doc;
}

function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
function squash(s) { return s.replace(/\s+/g, ' ').trim(); }
function circDigits(s) {
  var out = [];
  (s.match(/[①-⑩]|\d+/g) || []).forEach(function (ch) {
    var k = CIRC.indexOf(ch) >= 0 ? CIRC.indexOf(ch) + 1 : +ch;
    if (k >= 1 && k <= 10 && out.indexOf(k - 1) < 0) out.push(k - 1);
  });
  return out;
}
/* 읽는 순서상의 위치 [쪽, 단, y] 비교 */
function cmp(a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; }

/* ---------------------------------------------------------------- 쪽 읽기 */
async function readPage(doc, pn) {
  var page = await doc.getPage(pn + 1);
  var vp = page.getViewport({ scale: 1 });
  var pg = { pn: pn, page: page, W: vp.width, H: vp.height, lines: [], imgs: [] };

  /* 글자 조각 -> 같은 기준선에서 가까이 붙은 것끼리 한 줄 */
  var tc = await page.getTextContent();
  var runs = [];
  tc.items.forEach(function (it) {
    if (!it.str) return;
    var m = L.Util.transform(vp.transform, it.transform);
    var fs = Math.hypot(m[2], m[3]) || Math.abs(it.height) || 10;
    if (Math.abs(m[1]) > Math.abs(m[0])) return;          /* 세로 글자는 건너뜀 */
    var w = it.width * vp.scale;
    runs.push({ t: it.str, x0: m[4], x1: m[4] + w, base: m[5], fs: fs });
  });
  runs.sort(function (a, b) { return a.base - b.base || a.x0 - b.x0; });
  var rows = [];
  runs.forEach(function (r) {
    var row = rows.length && rows[rows.length - 1];
    if (row && Math.abs(r.base - row.base) < Math.max(row.fs, r.fs) * 0.4) row.runs.push(r);
    else rows.push({ base: r.base, fs: r.fs, runs: [r] });
  });
  rows.forEach(function (row) {
    row.runs.sort(function (a, b) { return a.x0 - b.x0; });
    var cur = null;
    row.runs.forEach(function (r) {
      var gap = cur ? r.x0 - cur.x1 : 0;
      if (cur && gap < Math.max(cur.fs, r.fs) * 1.6) {
        var sp = gap > Math.min(cur.fs, r.fs) * 0.18 && !/\s$/.test(cur.t) && !/^\s/.test(r.t);
        cur.t += (sp ? ' ' : '') + r.t;
        cur.x1 = Math.max(cur.x1, r.x1); cur.fs = Math.max(cur.fs, r.fs);
        cur.base = Math.max(cur.base, r.base);
      } else {
        if (cur) pushLine(pg, cur);
        cur = { t: r.t, x0: r.x0, x1: r.x1, base: r.base, fs: r.fs };
      }
    });
    if (cur) pushLine(pg, cur);
  });

  /* 그림 위치: 연산 목록을 따라가며 변환 행렬을 추적 */
  var ops = await page.getOperatorList(), O = L.OPS;
  var ctm = [1, 0, 0, 1, 0, 0], stack = [];
  var paint = [O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject,
               O.paintImageXObjectRepeat, O.paintInlineImageXObjectGroup, O.paintImageMaskXObjectGroup];
  for (var i = 0; i < ops.fnArray.length; i++) {
    var fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm.slice());
    else if (fn === O.restore) ctm = stack.pop() || ctm;
    else if (fn === O.transform) ctm = L.Util.transform(ctm, args);
    else if (fn === O.paintFormXObjectBegin) {
      stack.push(ctm.slice());
      if (args && args[0]) ctm = L.Util.transform(ctm, args[0]);
    } else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (paint.indexOf(fn) >= 0) {
      var t = L.Util.transform(vp.transform, ctm);
      var xs = [t[4], t[0] + t[4], t[2] + t[4], t[0] + t[2] + t[4]];
      var ys = [t[5], t[1] + t[5], t[3] + t[5], t[1] + t[3] + t[5]];
      var b = { x0: Math.min.apply(0, xs), x1: Math.max.apply(0, xs),
                y0: Math.min.apply(0, ys), y1: Math.max.apply(0, ys), pi: pn };
      if (b.x1 - b.x0 > 12 && b.y1 - b.y0 > 12 && b.x1 > 0 && b.y1 > 0 && b.x0 < pg.W && b.y0 < pg.H) pg.imgs.push(b);
    }
  }
  pg.split = columns(pg);
  page.cleanup();          /* 연산 목록·그림 디코딩 결과를 놓는다 (큰 문제집에서 메모리) */
  return pg;
}
function pushLine(pg, r) {
  var t = r.t.replace(ALT_RE, function (c) { return ALT[c]; });
  if (!t.trim()) return;
  pg.lines.push({ t: t, x0: r.x0, x1: r.x1, y0: r.base - r.fs * 0.9, y1: r.base + r.fs * 0.25, pi: pg.pn });
}

/* 2단이면 단 경계 x, 1단이면 null */
function columns(pg) {
  var mid = pg.W / 2;
  var body = pg.lines.filter(function (l) { return l.y0 > pg.H * 0.06 && l.y0 < pg.H * 0.94; });
  if (body.length < 8) return null;
  var cross = body.filter(function (l) { return l.x0 < mid - 4 && l.x1 > mid + 4; }).length;
  var left = body.filter(function (l) { return l.x1 <= mid + 4; }).length;
  var right = body.filter(function (l) { return l.x0 >= mid - 4; }).length;
  return cross <= 0.06 * body.length && left >= 4 && right >= 4 ? mid : null;
}
function colOf(pg, o) {
  if (pg.split == null) return 0;
  if (o.x0 < pg.split - 4 && o.x1 > pg.split + 4) return -1;   /* 단을 가로지름 = 머리말·꼬리말 */
  return (o.x0 + o.x1) / 2 < pg.split ? 0 : 1;
}
function colX(pg, c) {
  if (pg.split == null) return [0, pg.W];
  return c === 0 ? [0, pg.split] : [pg.split, pg.W];
}
/* 단에서 글줄이 실제로 시작하는 x. 여백 폭은 문서마다 달라 쪽 가장자리로 재면 안 된다.
   머리말·꼬리말을 뺀 줄들의 왼쪽 끝 중 아래쪽 10% 지점(튀는 줄 몇 개는 무시) */
function colEdge(pg, c) {
  pg.edge = pg.edge || {};
  if (c in pg.edge) return pg.edge[c];
  var xs = pg.lines.filter(function (l) {
    return l.y0 > pg.H * 0.1 && l.y1 < pg.H * 0.9 && colOf(pg, l) === c;
  }).map(function (l) { return l.x0; }).sort(function (a, b) { return a - b; });
  return (pg.edge[c] = xs.length >= 3 ? xs[Math.floor(xs.length * 0.1)] : colX(pg, c)[0]);
}

/* 여러 쪽에 같은 자리에 반복되는 줄(쪽 번호·머리말) — 숫자는 무시하고 비교 */
function repeated(pages) {
  var cnt = {};
  pages.forEach(function (pg) {
    var seen = {};
    pg.lines.forEach(function (l) {
      if (l.y0 < pg.H * 0.1 || l.y1 > pg.H * 0.9) {
        var k = l.t.trim().replace(/\d+/g, '#');
        if (!seen[k]) { seen[k] = 1; cnt[k] = (cnt[k] || 0) + 1; }
      }
    });
  });
  var n = pages.length, out = {};
  Object.keys(cnt).forEach(function (k) { if (n >= 3 && cnt[k] >= Math.max(3, n * 0.3)) out[k] = 1; });
  return out;
}

/* 읽는 순서(쪽 -> 단 -> 위에서 아래)로 줄을 늘어놓는다 */
function stream(pages) {
  var rep = repeated(pages), out = [], first = false;
  pages.forEach(function (pg) {
    var ls = [];
    pg.lines.forEach(function (l) {
      var c = colOf(pg, l);
      if (c < 0) return;
      if ((l.y0 < pg.H * 0.1 || l.y1 > pg.H * 0.9) && rep[l.t.trim().replace(/\d+/g, '#')]) return;
      l.c = c; ls.push(l);
    });
    ls.sort(function (a, b) { return a.c - b.c || Math.round(a.y0 / 3) - Math.round(b.y0 / 3) || a.x0 - b.x0; });
    /* 시험지 제목처럼 머리에만 있는 것: 첫 문제 번호가 나오는 쪽에서만 그 번호보다 위의 줄을 버린다.
       다른 쪽 위쪽에는 앞 문제의 보기가 이어질 수 있다(반복되는 머리말은 위에서 걸러짐). */
    var tops = ls.filter(function (l) { return ANCHOR.test(l.t); }).map(function (l) { return l.y0; });
    if (tops.length && !first) {
      first = true;
      var top = Math.min.apply(0, tops);
      if (top < pg.H * 0.2) ls = ls.filter(function (l) { return !(l.y1 < top - 1); });
    }
    out = out.concat(ls);
  });
  return out;
}

/* 문제 번호 줄. 번호가 앞 번호보다 크고(빠진 번호는 몇 개까지) 단의 글줄 왼쪽 끝 가까이에 있어야 한다. */
function anchors(lines, pages) {
  var last = 0, out = [];
  lines.forEach(function (l, i) {
    var m = ANCHOR.exec(l.t);
    if (!m) return;
    /* 번호는 글줄 시작에 붙어 있다 — 글자 한 자 넘게 들여 쓴 '1.' 은 지문 속 목록 */
    var n = +m[1], pg = pages[l.pi];
    if (l.x0 - colEdge(pg, l.c) > (l.y1 - l.y0) * 0.9) return;
    if (n > last && n <= last + 6) { out.push([i, n]); last = n; }
  });
  return out;
}

function splitChoices(lines) {
  var txt = lines.map(function (l) { return l.t.trim(); }).join(' ');
  var parts = txt.split(/([①-⑩])/), out = {};
  for (var i = 1; i < parts.length - 1; i += 2) out[CIRC.indexOf(parts[i])] = squash(parts[i + 1]);
  return out;
}
function joinText(lines) { return squash(lines.map(function (l) { return l.t.trim(); }).join(' ')); }

function objectsBetween(pages, a, b) {
  var ka = [a.pi, a.c, a.y0 - 2], kb = b ? [b.pi, b.c, b.y0 - 2] : [1e9, 0, 0], out = [];
  for (var pi = a.pi; pi <= (b ? b.pi : pages.length - 1); pi++) {
    var pg = pages[pi];
    if (!pg) continue;
    pg.imgs.forEach(function (o) {
      var c = colOf(pg, o);
      if (c < 0) return;
      /* 그림이 문제 번호 줄보다 살짝 위에서 시작하기도 해서 세로 가운데로 가른다 */
      var k = [o.pi, c, (o.y0 + o.y1) / 2];
      if (cmp(ka, k) <= 0 && cmp(k, kb) < 0) out.push(Object.assign({ c: c }, o));
    });
  }
  return out;
}

/* ---------------------------------------------------------------- 그림 */
var MAXPX = 16e6;        /* 사파리 캔버스 한도(약 1,670만 화소) 안으로 */
function Renderer() { this.cache = new Map(); }
/* pin: 지금 자르는 중이라 버리면 안 되는 쪽 번호들 */
Renderer.prototype.canvas = async function (pg, pin) {
  if (this.cache.has(pg.pn)) return this.cache.get(pg.pn);
  for (var it = this.cache.keys(), k = it.next(); this.cache.size >= 3 && !k.done; k = it.next()) {
    if (pin && pin.indexOf(k.value) >= 0) continue;
    this.drop(k.value);
  }
  var sc = Math.min(SCALE, Math.sqrt(MAXPX / (pg.W * pg.H)));
  var vp = pg.page.getViewport({ scale: sc });
  var cv = document.createElement('canvas');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  var ctx = cv.getContext('2d');
  if (!ctx) throw new Error(pg.pn + 1 + '쪽을 그릴 메모리가 부족합니다.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  /* intent 'print': 화면용 렌더는 requestAnimationFrame 에 묶여 있어 탭이 가려지면 멈춘다 */
  await pg.page.render({ canvas: cv, canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  cv.sc = sc;
  this.cache.set(pg.pn, cv);
  return cv;
};
Renderer.prototype.drop = function (pn) {
  var cv = this.cache.get(pn);
  if (!cv) return;
  cv.width = cv.height = 0;
  this.cache.delete(pn);
};
Renderer.prototype.done = function () {
  var self = this;
  Array.from(this.cache.keys()).forEach(function (pn) { self.drop(pn); });
};
/* [{pg, x0,y0,x1,y1}] 를 잘라 세로로 이어 붙인다 */
async function cropStack(R, pieces) {
  var parts = [], pin = pieces.map(function (p) { return p.pg.pn; });
  for (var i = 0; i < pieces.length; i++) {
    var p = pieces[i], cv = await R.canvas(p.pg, pin), sc = cv.sc;
    var x0 = Math.max(0, p.x0) * sc, y0 = Math.max(0, p.y0) * sc;
    var w = Math.min(cv.width - x0, (p.x1 - p.x0) * sc), h = Math.min(cv.height - y0, (p.y1 - p.y0) * sc);
    if (w > 2 && h > 2) parts.push({ cv: cv, x: x0, y: y0, w: w, h: h });
  }
  if (!parts.length) return null;
  var gap = 12 * SCALE / 2, W = Math.max.apply(0, parts.map(function (p) { return p.w; }));
  var H = parts.reduce(function (s, p) { return s + p.h; }, 0) + gap * (parts.length - 1);
  var k = W > MAXW ? MAXW / W : 1;
  var out = document.createElement('canvas');
  out.width = Math.round(W * k); out.height = Math.round(H * k);
  var ctx = out.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = 'high';
  var y = 0;
  parts.forEach(function (p) {
    ctx.drawImage(p.cv, p.x, p.y, p.w, p.h, 0, y * k, p.w * k, p.h * k);
    y += p.h + gap;
  });
  return out;
}
/* 둘 다 만들어 보고 고른다: 글자·선 그림은 PNG 가 작고 또렷하고, 사진·그러데이션은 JPEG 가 훨씬 작다.
   PNG 가 JPEG 의 1.5배 안이면 또렷한 PNG. */
function encode(cv) {
  var png = cv.toDataURL('image/png'), jpg = cv.toDataURL('image/jpeg', 0.8);
  return png.length <= jpg.length * 1.5 ? ['png', png] : ['jpg', jpg];
}
async function hash(s) {
  var b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [].map.call(new Uint8Array(b).slice(0, 6), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
}
function Media(prefix) { this.prefix = prefix; this.data = {}; this.n = 0; }
Media.prototype.add = async function (cv) {
  if (!cv) return '';
  var e = encode(cv), b64 = e[1].slice(e[1].indexOf(',') + 1);
  cv.width = cv.height = 0;
  var key = this.prefix + '_' + (await hash(b64)) + '.' + e[0];
  if (!this.data[key]) this.n++;
  this.data[key] = b64;
  return key;
};

/* 같은 쪽·단끼리 묶어 자를 영역. 가로는 단 폭 전체(글자 밖의 상자·도표까지 담기게). */
function pieces(pages, items, bottomCut, pad) {
  var g = [], by = {};
  items.forEach(function (o) {
    var k = o.pi + ':' + o.c;
    if (!by[k]) { by[k] = []; g.push(k); }
    by[k].push(o);
  });
  return g.map(function (k) {
    var os = by[k], pg = pages[os[0].pi], c = os[0].c, cx = colX(pg, c);
    var colLines = pg.lines.filter(function (l) { return l.c === c; });
    var x0 = Math.min.apply(0, colLines.map(function (l) { return l.x0; }).concat(os.map(function (o) { return o.x0; })));
    var x1 = Math.max.apply(0, colLines.map(function (l) { return l.x1; }).concat(os.map(function (o) { return o.x1; })));
    var y0 = Math.min.apply(0, os.map(function (o) { return o.y0; })) - 4;
    var y1 = Math.max.apply(0, os.map(function (o) { return o.y1; })) + pad;
    if (bottomCut && bottomCut.pi === os[0].pi && bottomCut.c === c) y1 = Math.min(y1, bottomCut.y0 - 2);
    return { pg: pg, x0: Math.max(cx[0], x0 - 6), x1: Math.min(cx[1], x1 + 6), y0: y0, y1: y1 };
  });
}

/* ---------------------------------------------------------------- 문제 한 개 */
async function buildItem(R, pages, seg, nxt, no, opt, media, inline) {
  var qend = seg.length, ans = null, exp = [];
  if (inline) {
    for (var i = 1; i < seg.length; i++) {
      var m = ANS.exec(seg[i].t);
      if (!m) continue;
      qend = i; ans = circDigits(m[1]);
      var rest = seg.slice(i + 1);
      for (var j = 0; j < rest.length; j++) {
        var e = EXP.exec(rest[j].t);
        if (e) { exp = [e[1]].concat(rest.slice(j + 1).map(function (x) { return x.t.trim(); })); break; }
      }
      break;
    }
  }
  var q = seg.slice(0, qend), stop = qend < seg.length ? seg[qend] : nxt;
  var ci = -1;
  for (var k = 1; k < q.length; k++) if (CIRC.indexOf(q[k].t.trim()[0]) >= 0) { ci = k; break; }
  var stem = ci >= 0 ? q.slice(0, ci) : q, chl = ci >= 0 ? q.slice(ci) : [];
  var hints = chl.filter(function (l) { return l.t.trim()[0] === '■'; });
  chl = chl.filter(function (l) { return hints.indexOf(l) < 0; });
  var choices = splitChoices(chl), keys = Object.keys(choices).map(Number);
  var nch = keys.length ? Math.max.apply(0, keys) + 1 : 0;
  if (nch < 2) return { why: '보기를 찾지 못함' };

  var stemTxt = joinText([{ t: ANCHOR.exec(stem[0].t)[2] }].concat(stem.slice(1)));
  var title = stemTxt.slice(0, 48) + (stemTxt.length > 48 ? '…' : '');
  var imgs = objectsBetween(pages, seg[0], stop);
  var textOk = true;
  for (var c = 0; c < nch; c++) if (!choices[c]) textOk = false;
  var twoCol = pages[seg[0].pi].split != null;
  var h, opts;

  if (!opt.image && !twoCol && textOk) {
    /* 글자로: 문제 · 상황 설명(■) · 문제 속 그림 */
    h = '<div class="qs">' + esc(stemTxt) + '</div>';
    if (hints.length) h += '<ul class="qh">' + hints.map(function (l) {
      return '<li>' + esc(l.t.trim().replace(/^■\s*/, '')) + '</li>';
    }).join('') + '</ul>';
    for (var a = 0; a < imgs.length; a++) {
      var o = imgs[a];
      h += '<img class="qi" src="' + (await media.add(await cropStack(R, [{ pg: pages[o.pi], x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1 }]))) + '">';
    }
    opts = []; for (c = 0; c < nch; c++) opts.push(esc(choices[c]));
  } else {
    /* 그림으로: 보기 글자를 읽을 수 있으면 보기 앞까지만, 아니면 보기까지 */
    var body, cut = null;
    if (textOk) {
      cut = chl[0] || stop;
      body = stem.concat(hints).concat(imgs.filter(function (o) {
        return cmp([o.pi, o.c, (o.y0 + o.y1) / 2], [cut.pi, cut.c, cut.y0 - 2]) < 0;
      }));
      opts = []; for (c = 0; c < nch; c++) opts.push(esc(choices[c]));
    } else {
      body = q.concat(imgs);
      opts = []; for (c = 0; c < nch; c++) opts.push(CIRC[c]);
    }
    var cv = await cropStack(R, pieces(pages, body, cut, textOk ? 6 : 8));
    h = '<img class="qimg" src="' + (await media.add(cv)) + '" alt="' + esc(stemTxt.slice(0, 200)).replace(/"/g, '&quot;') + '">';
  }
  var it = { q: 'mc', no: no, t: title, h: h, o: opts, p: seg[0].pi + 1 };
  if (ans) it.a = ans;
  /* 풀이: 글자 + 풀이 자리에 있는 그림 */
  var ximgs = qend < seg.length ? objectsBetween(pages, stop, nxt) : [];
  if (exp.length || ximgs.length) {
    var x = esc(squash(exp.join(' ')));
    for (var b = 0; b < ximgs.length; b++) {
      var xo = ximgs[b];
      x += '<img class="qi" src="' + (await media.add(await cropStack(R, [{ pg: pages[xo.pi], x0: xo.x0, y0: xo.y0, x1: xo.x1, y1: xo.y1 }]))) + '">';
    }
    it.x = x;
  }
  return { it: it };
}

/* ---------------------------------------------------------------- 정답표 */
async function readKey(file, match, progress) {
  var doc = await openPdf(file), texts = [];
  try {
    for (var i = 0; i < doc.numPages; i++) {
      var p = await doc.getPage(i + 1), tc = await p.getTextContent();
      texts.push(tc.items.map(function (x) { return x.str; }).join(' ').replace(ALT_RE, function (c) { return ALT[c]; }));
      progress('정답표 ' + (i + 1) + '/' + doc.numPages + '쪽');
    }
  } finally { doc.closeAll(); }
  var pick = texts.filter(function (t) { return !match || t.indexOf(match) >= 0; });
  if (!pick.length) throw new Error('정답표에서 "' + match + '" 가 들어 있는 쪽을 찾지 못했습니다.');
  var toks = pick[0].match(/[①-⑩]+|\d+/g) || [], key = {};
  for (var j = 0; j < toks.length - 1; j++) {
    if (/^\d/.test(toks[j]) && CIRC.indexOf(toks[j + 1][0]) >= 0) { key[+toks[j]] = circDigits(toks[j + 1]); j++; }
  }
  return { key: key, pages: pick.length };
}

/* ---------------------------------------------------------------- 변환
   opt: { title, round, image(항상 그림으로), key(정답표 File), keyMatch, onProgress,
          cancelled() — true 를 돌려주면 쪽·문제 사이에서 멈추고 'cancelled' 를 던진다 } */
export async function convert(file, opt) {
  opt = opt || {};
  var cancelled = opt.cancelled || function () { return false; };
  var progress = function (s) { if (cancelled()) throw new Error('cancelled'); (opt.onProgress || function () {})(s); };
  progress('PDF 여는 중…');
  var doc = await openPdf(file);
  try { return await run(doc, file, opt, progress, cancelled); }
  finally { doc.closeAll(); }
}

async function run(doc, file, opt, progress, cancelled) {
  var pages = [];
  for (var i = 0; i < doc.numPages; i++) {
    if (cancelled()) throw new Error('cancelled');
    pages.push(await readPage(doc, i));
    if (i % 5 === 4 || i === doc.numPages - 1) progress('읽는 중 ' + (i + 1) + '/' + doc.numPages + '쪽');
  }
  var lines = stream(pages), anc = anchors(lines, pages);
  var warn = [];
  var key = null;
  if (opt.key) {
    var k = await readKey(opt.key, opt.keyMatch, progress);
    key = k.key;
    if (k.pages > 1) warn.push('정답표에서 해당하는 쪽이 ' + k.pages + '개라 첫 쪽만 썼습니다' + (opt.keyMatch ? '' : ' — 과목명을 넣어 보세요'));
  }
  var round = (opt.round || '').trim(), ym = /(\d{4})\s*년/.exec(round);
  var media = new Media('m' + (await hash(file.name + file.size + round)).slice(0, 6));
  var R = new Renderer(), items = [], skipped = [];
  try {
    for (var a = 0; a < anc.length; a++) {
      if (cancelled()) throw new Error('cancelled');
      var s = anc[a][0], no = anc[a][1];
      var end = a + 1 < anc.length ? anc[a + 1][0] : lines.length;
      var nxt = end < lines.length ? lines[end] : null;
      var r = await buildItem(R, pages, lines.slice(s, end), nxt, no, opt, media, !key);
      if (a % 5 === 4 || a === anc.length - 1) progress('문제 만드는 중 ' + (a + 1) + '/' + anc.length);
      if (!r.it) { skipped.push([no, r.why]); continue; }
      var it = r.it;
      if (key) it.a = key[no];
      if (!it.a || !it.a.length) { skipped.push([no, '정답 없음']); continue; }
      if (Math.max.apply(0, it.a) >= it.o.length) { skipped.push([no, '정답 번호가 보기 수보다 큼']); continue; }
      it.id = (round || file.name.replace(/\.pdf$/i, '')) + '#' + no;
      it.r = round ? [round] : [];
      it.y = ym ? [ym[1].slice(2)] : [];
      items.push(it);
    }
  } finally {
    R.done();
  }
  var nums = anc.map(function (x) { return x[1]; }), max = nums.length ? Math.max.apply(0, nums) : 0, gaps = [];
  for (var n = 1; n <= max; n++) if (nums.indexOf(n) < 0) gaps.push(n);
  items.forEach(function (x, i) { x.i = i; });
  return {
    deck: { title: (opt.title || file.name.replace(/\.pdf$/i, '')).trim(), subtitle: round, items: items, media: media.data },
    report: {
      pages: pages.length, twoCol: pages.filter(function (p) { return p.split != null; }).length,
      found: anc.length, items: items.length, multi: items.filter(function (x) { return x.a.length > 1; }).length,
      images: media.n, gaps: gaps, skipped: skipped, warn: warn
    }
  };
}
