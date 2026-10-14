/* ============ paperdeck — 문제집 카드 학습 ============ */
var DATA = null, IT = [], MED = {};
var PK = 'pd_prog';            /* 진도 — 문제집마다 'pd_prog:<id>' */
var LIBK = 'pd_lib', CURK = 'pd_cur';
var LEGACY = 'pd_ds';          /* 문제집을 하나만 두던 때의 IndexedDB 키 */
var prog = {}, LIB = [], CUR = null;
var CIRC = '①②③④⑤⑥⑦⑧⑨⑩';

/* ---------- IndexedDB (데이터셋은 수 MB 라 localStorage 불가) ---------- */
function idb() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open('paperdeck', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function idbGet(k) {
  return idb().then(function (db) {
    return new Promise(function (res, rej) {
      var q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error); };
    });
  });
}
function idbSet(k, v) {
  return idb().then(function (db) {
    return new Promise(function (res, rej) {
      var q = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
      q.onsuccess = function () { res(); };
      q.onerror = function () { rej(q.error); };
    });
  });
}
function idbDel(k) {
  return idb().then(function (db) {
    return new Promise(function (res) {
      db.transaction('kv', 'readwrite').objectStore('kv').delete(k).onsuccess = function () { res(); };
    });
  });
}
function dsKey(id) { return 'ds:' + id; }

function loadProg() {
  try { prog = JSON.parse(localStorage.getItem(PK) || '{}'); } catch (e) { prog = {}; }
}
/* 열린 문제집이 없으면 쓰지 않는다 — 지운 문제집의 진도가 닫힐 때 되살아나지 않게 */
function save() { if (!CUR) return; try { localStorage.setItem(PK, JSON.stringify(prog)); } catch (e) {} }
/* 문제마다 고유 id 가 있으면 그것으로, 없으면(전기기사 데이터) 제목·회차·페이지로 */
function key(it) { return it.id || (it.t + '|' + it.r.join(',') + '|' + it.p); }
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return [].slice.call((r || document).querySelectorAll(s)); }

/* ---------- 채점 ---------- */
function strip(s) {
  var d = document.createElement('div');
  d.innerHTML = String(s).replace(/<br\s*\/?>/gi, ' ');
  return d.textContent || '';
}
function norm(s) {
  s = strip(s).normalize('NFKC').toLowerCase();
  s = s.replace(/(\d)[,](?=\d{3}\b)/g, '$1');
  s = s.replace(/[·ㆍ•・･]/g, ',');
  s = s.replace(/[\[\]()（）{}「」『』《》〈〉]/g, ' ');
  s = s.replace(/[，、]/g, ',');
  s = s.replace(/[-–—−ー]/g, '-');
  s = s.replace(/[~∼〜]/g, '~');
  s = s.replace(/\s+/g, '');
  s = s.replace(/[.。]+$/, '');
  return s;
}
function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
                        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur.slice();
  }
  return prev[b.length];
}
function ratio(a, b) {
  var m = Math.max(a.length, b.length);
  return m ? 1 - lev(a, b) / m : 1;
}
function toks(s) { return norm(s).split(',').filter(Boolean); }

/* 한 칸 채점: ok | mb(애매) | no | blank */
function judge(user, ans) {
  var u = norm(user), a = norm(ans);
  if (!u) return 'blank';
  if (u === a) return 'ok';
  var ta = toks(ans), tu = toks(user);
  if (ta.length > 1 && ta.length === tu.length) {
    var sa = ta.slice().sort(), su = tu.slice().sort(), all = true;
    for (var i = 0; i < sa.length; i++) if (ratio(sa[i], su[i]) < 0.9) all = false;
    if (all) return 'ok';
  }
  var r = ratio(u, a);
  if (r >= 0.9) return 'ok';
  if (r >= 0.62) return 'mb';
  return 'no';
}
/* 나열형(같은 그룹의 ∎ 정답들): 순서 무관 매칭 */
function judgeSet(users, answers) {
  var left = answers.map(function (a, i) { return { a: a, i: i, used: false }; });
  return users.map(function (u) {
    if (!norm(u)) return { v: 'blank', a: null };
    var best = null, bv = -1;
    left.forEach(function (o) {
      if (o.used) return;
      var r = ratio(norm(u), norm(o.a));
      if (r > bv) { bv = r; best = o; }
    });
    if (!best) return { v: 'no', a: null };
    var v = judge(u, best.a);
    if (v !== 'no' && v !== 'blank') best.used = true;
    else if (bv >= 0.62) { v = 'mb'; best.used = true; }
    return { v: v, a: best.a };
  });
}

/* ---------- 렌더 ---------- */
function fillMedia(html) {
  return String(html).replace(/src="([\w.-]+\.(png|jpe?g|webp|gif))"/g, function (m, n, ext) {
    if (!MED[n]) return m;
    return 'src="data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + MED[n] + '"';
  });
}
function isMC(it) { return it.q === 'mc'; }
function xpHtml(it) {
  return it.x ? '<div class="xp"><b>해설</b>' + fillMedia(it.x) + '</div>' : '';
}
function optHtml(it, i, tag) {
  return '<' + tag + ' class="opt" data-o="' + i + '"' + (tag === 'button' ? ' type="button"' : '') + '>' +
         '<span class="oi">' + (CIRC[i] || i + 1) + '</span><span class="ot">' + fillMedia(it.o[i]) +
         '</span></' + tag + '>';
}
function renderQ(it) {
  if (isMC(it)) {
    return fillMedia(it.h) + '<div class="opts">' +
           it.o.map(function (o, i) { return optHtml(it, i, 'button'); }).join('') + '</div>' +
           (it.a.length > 1 ? '<div class="note mcn">답 ' + it.a.length + '개를 고르세요</div>' : '');
  }
  var h = fillMedia(it.h);
  h = h.replace(/<table class="tb">/g, '<div class="tw"><table class="tb">')
       .replace(/<\/table>/g, '</table></div>');
  h = h.replace(/<span class="bk" data-b="(\d+)"><\/span>/g, function (m, k) {
    var b = it.b[+k];
    if (b.t === 'img') {
      return '<span class="slot" data-b="' + k + '">' +
             '<span class="no">' + (+k + 1) + '</span>' +
             '<button class="fixbtn" data-show="' + k + '">정답 보기 (그림)</button></span>';
    }
    return '<span class="slot" data-b="' + k + '">' +
           '<span class="no">' + (+k + 1) + '</span>' +
           '<input class="ipt" data-b="' + k + '" type="text" autocomplete="off" ' +
           'autocapitalize="off" spellcheck="false" enterkeyhint="next"></span>';
  });
  return h;
}

/* 정답을 드러낸 채로 (기출 보기 전용) */
function renderSolved(it) {
  if (isMC(it)) {
    return fillMedia(it.h) + '<div class="opts done">' + it.o.map(function (o, i) {
      return optHtml(it, i, 'div').replace('class="opt"', 'class="opt' + (it.a.indexOf(i) >= 0 ? ' ok' : '') + '"');
    }).join('') + '</div>' + xpHtml(it);
  }
  var h = fillMedia(it.h);
  h = h.replace(/<table class="tb">/g, '<div class="tw"><table class="tb">')
       .replace(/<\/table>/g, '</table></div>');
  return h.replace(/<span class="bk" data-b="(\d+)"><\/span>/g, function (m, k) {
    var b = it.b[+k];
    if (!b) return '';
    return b.t === 'img' ? fillMedia(b.a)
                         : '<span class="sol-in">' + b.a + '</span>';
  }) + xpHtml(it);
}
function shortTitle(it) {
  return isMC(it) && it.no ? it.no + '. ' + it.t : it.t;
}

/* ---------- 묶음: 연도 → 회차·출처 → 번호순 50문제씩 ---------- */
function hasYears() { return IT.some(function (it) { return it.y.length; }); }
function hasRepeats() { return IT.some(function (it) { return it.r.length > 1; }); }
function allRounds() { return IT.length && IT.every(function (it) { return it.r.length; }); }
var CHUNK = 50;
function sets() {
  if (hasYears()) {
    var ys = {};
    IT.forEach(function (it) { it.y.forEach(function (y) { ys[y] = 1; }); });
    return Object.keys(ys).sort().reverse().map(function (y) {
      return { k: y, label: '20' + y, list: IT.filter(function (it) { return it.y.indexOf(y) >= 0; }) };
    });
  }
  if (allRounds()) {
    var g = {}, order = [];
    IT.forEach(function (it) {
      var r = it.r[0];
      if (!g[r]) { g[r] = []; order.push(r); }
      g[r].push(it);
    });
    return order.map(function (r) { return { k: r, label: r, list: g[r] }; });
  }
  var out = [];
  for (var i = 0; i < IT.length; i += CHUNK) {
    var list = IT.slice(i, i + CHUNK);
    out.push({ k: 'c' + (i / CHUNK), list: list,
               label: num(list[0], i + 1) + '~' + num(list[list.length - 1], i + list.length) + '번' });
  }
  return out;
}
function num(it, fallback) { return it.no || fallback; }
function setsName() { return hasYears() ? '연도별' : allRounds() ? '회차별' : '번호순'; }

/* ---------- 기출 보기 ---------- */
var CS = { mode: 'y', sort: 'n', q: '' };
try { CS.mode = localStorage.getItem('pd_bmode') || 'y'; } catch (e) {}

function rnum(r) { var m = /(\d+)\s*회/.exec(r); return m ? +m[1] : 0; }
function ryear(r) { var m = /(\d{4})/.exec(r); return m ? m[1].slice(2) : ''; }

/* 연도 → 회차 → 문제. 한 문제가 여러 회차에 나왔으면 각 회차에 모두 들어간다.
   회차 안의 순서는 책에 실린 순서(페이지 → 등장 순)를 그대로 따른다. */
function years() {
  var g = {};
  IT.forEach(function (it) {
    it.r.forEach(function (r) {
      var y = ryear(r);
      if (!y) return;
      g[y] = g[y] || {};
      (g[y][r] = g[y][r] || []).push(it);
    });
  });
  return Object.keys(g).sort().reverse().map(function (y) {
    var rounds = Object.keys(g[y]).sort(function (a, b) { return rnum(b) - rnum(a); })
      .map(function (r) {
        var list = g[y][r].slice().sort(function (a, b) {
          return (a.p - b.p) || ((a.i || 0) - (b.i || 0));
        });
        return { r: r, list: list };
      });
    var n = rounds.reduce(function (s, o) { return s + o.list.length; }, 0);
    var seen = [];
    rounds.forEach(function (o) {
      o.list.forEach(function (it) { if (seen.indexOf(it) < 0) seen.push(it); });
    });
    return { y: y, rounds: rounds, n: n, u: seen.length };
  });
}

function concepts() {
  var g = {};
  IT.forEach(function (it) { (g[it.t] = g[it.t] || []).push(it); });
  return Object.keys(g).map(function (t) {
    var list = g[t];
    var ys = [];
    list.forEach(function (it) { ys = ys.concat(it.y); });
    ys = ys.filter(function (v, i) { return ys.indexOf(v) === i; }).sort();
    return { t: t, list: list, n: list.length, lo: ys[0], hi: ys[ys.length - 1] };
  });
}

/* 같은 문제가 몇 번 출제됐는지(회차 수)로 묶는다. 많이 나온 묶음이 앞으로,
   묶음 안에서는 최근에 나온 문제가 앞으로. */
function latest(it) { return it.r.slice().sort().reverse()[0] || ''; }
function freqs() {
  var g = {};
  IT.forEach(function (it) { (g[it.r.length] = g[it.r.length] || []).push(it); });
  return Object.keys(g).map(Number).sort(function (a, b) { return b - a; }).map(function (k) {
    var list = g[k].slice().sort(function (a, b) {
      return latest(b).localeCompare(latest(a)) || (a.p - b.p);
    });
    return { k: k, list: list };
  });
}

/* 전체를 빈출순으로 한 줄로 */
function byFreq() {
  return freqs().reduce(function (a, o) { return a.concat(o.list); }, []);
}

/* 이 문제집에서 쓸 수 있는 보기 방식. 제목이 거의 다 다르면 개념별은 의미가 없다. */
function browseModes() {
  var m = [];
  if (hasYears()) m.push(['y', '연도별']); else m.push(['g', setsName()]);
  /* 객관식의 제목은 문제 첫머리라 개념으로 묶을 수 없다 */
  if (!IT.every(isMC) && concepts().length <= IT.length * 0.85) m.push(['c', '개념별']);
  if (hasRepeats()) m.push(['f', '빈출순']);
  return m;
}

function paintBrowse() {
  var modes = browseModes();
  if (!modes.some(function (m) { return m[0] === CS.mode; })) CS.mode = modes[0][0];
  $('#cmode').innerHTML = modes.map(function (m) {
    return '<button data-m="' + m[0] + '"' + (m[0] === CS.mode ? ' class="on"' : '') + '>' + m[1] + '</button>';
  }).join('');
  $('.moderow').style.display = modes.length > 1 ? '' : 'none';
  $$('#cmode button').forEach(function (b) {
    b.onclick = function () {
      CS.mode = b.dataset.m;
      try { localStorage.setItem('pd_bmode', CS.mode); } catch (e) {}
      paintBrowse();
    };
  });
  var byConcept = CS.mode === 'c';
  $('#csearch').style.display = byConcept ? '' : 'none';
  $('#csortrow').style.display = byConcept ? '' : 'none';
  if (CS.mode === 'y') paintYears();
  else if (CS.mode === 'g') paintSets();
  else if (CS.mode === 'f') paintFreqs();
  else paintConcepts();
}

function paintSets() {
  var all = sets();
  $('#csub').textContent = '묶음 ' + all.length + '개 · 문제 ' + IT.length + '개 · 답이 다 보입니다';
  $('#clist').innerHTML = all.map(function (o, i) {
    var d = o.list.filter(function (it) { return prog[key(it)]; }).length;
    return '<div class="crow" data-i="' + i + '">' +
           '<span class="cname">' + esc(o.label) + '</span>' +
           '<span class="cmeta"><b>' + o.list.length + '문제</b>푼 문제 ' + d + '</span></div>';
  }).join('');
  $$('#clist .crow').forEach(function (r) {
    r.onclick = function () { openSet(all[+r.dataset.i]); };
  });
}

function paintFreqs() {
  var all = freqs();
  var rep = IT.filter(function (it) { return it.r.length > 1; }).length;
  $('#csub').textContent = '문제 ' + IT.length + '개 · 두 번 이상 나온 문제 ' + rep +
                           '개 · 같은 문제가 출제된 횟수 기준, 답이 다 보입니다';
  $('#clist').innerHTML = all.map(function (o) {
    var ys = o.list.map(function (it) { return ryear(latest(it)); }).sort();
    return '<div class="crow" data-k="' + o.k + '">' +
           '<span class="cname">' + o.k + '회 출제</span>' +
           '<span class="cmeta"><b>' + o.list.length + '문제</b>' +
           (ys[ys.length - 1] ? '최근 20' + ys[ys.length - 1] : '') + '</span></div>';
  }).join('');
  $$('#clist .crow').forEach(function (r) {
    r.onclick = function () { openFreq(+r.dataset.k); };
  });
}

function paintYears() {
  var all = years();
  var nr = all.reduce(function (s, o) { return s + o.rounds.length; }, 0);
  var slots = all.reduce(function (s, o) { return s + o.n; }, 0);
  $('#csub').textContent = '연도 ' + all.length + '개 · 회차 ' + nr + '개 · 문제 ' +
    IT.length + '개' +
    (slots !== IT.length ? ' (여러 회차에 나온 것까지 세면 ' + slots + '개)' : '') +
    ' · 나온 순서 그대로, 답이 다 보입니다';
  $('#clist').innerHTML = all.map(function (o) {
    var rs = o.rounds.map(function (x) { return rnum(x.r) ? rnum(x.r) + '회' : x.r; }).join(' · ');
    return '<div class="crow" data-y="' + o.y + '">' +
           '<span class="cname">20' + o.y + '년</span>' +
           '<span class="cmeta"><b>' + o.n + '문제</b>' + esc(rs) + '</span></div>';
  }).join('');
  $$('#clist .crow').forEach(function (r) {
    r.onclick = function () { openYear(r.dataset.y); };
  });
}

function paintConcepts() {
  var all = concepts();
  $('#csub').textContent = '개념 ' + all.length + '개 · 문제 ' + IT.length +
                           '개 · 답이 다 보입니다';
  var q = CS.q.replace(/\s/g, '').toLowerCase();
  var rows = all.filter(function (c) {
    return !q || c.t.replace(/\s/g, '').toLowerCase().indexOf(q) >= 0;
  });
  rows.sort(function (a, b) {
    if (CS.sort === 'a') return a.t.localeCompare(b.t, 'ko');
    if (CS.sort === 'y') return (b.hi || '').localeCompare(a.hi || '') || b.n - a.n;
    return b.n - a.n || a.t.localeCompare(b.t, 'ko');
  });
  $('#clist').innerHTML = rows.length ? rows.map(function (c) {
    var span = !c.lo ? '' : c.lo === c.hi ? '20' + c.hi : '20' + c.lo + '~20' + c.hi;
    return '<div class="crow" data-t="' + esc(c.t).replace(/"/g, '&quot;') + '">' +
           '<span class="cname">' + esc(c.t) + '</span>' +
           '<span class="cmeta"><b>' + c.n + '문제</b>' + span + '</span></div>';
  }).join('') : '<div class="cempty">찾는 개념이 없습니다</div>';
  $$('#clist .crow').forEach(function (r) {
    r.onclick = function () { openConcept(r.dataset.t); };
  });
}

function wireJumps() {
  $$('#cdetail [data-jump]').forEach(function (a) {
    a.onclick = function (ev) {
      ev.preventDefault();
      var el = document.getElementById(a.dataset.jump);
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.pageYOffset - 56);
    };
  });
}

/* 한 해에 나온 문제를 회차별로, 실린 순서 그대로 */
function openYear(y) {
  var o = years().filter(function (x) { return x.y === y; })[0];
  if (!o) return;
  var h = ['<div class="chead"><h1>20' + y + '년 기출</h1>' +
           '<div class="sub1">' + o.n + '문제' +
           (o.u !== o.n ? ' (서로 다른 문제 ' + o.u + '개)' : '') +
           ' · 나온 순서 그대로 · 답이 다 보입니다</div></div>'];

  /* 그 해에 나온 개념을 한눈에 — 누르면 그 문제로 간다 */
  h.push('<div class="cidx">' + o.rounds.map(function (rd, ri) {
    return '<div class="cidxr"><b>' + (rnum(rd.r) ? rnum(rd.r) + '회' : '') + '</b><span>' +
      rd.list.map(function (it, i) {
        return '<a href="#" data-jump="q' + ri + '_' + i + '">' +
               esc(isMC(it) && it.no ? it.no + '번' : it.t) + '</a>';
      }).join('') + '</span></div>';
  }).join('') + '</div>');

  o.rounds.forEach(function (rd, ri) {
    h.push('<div class="cyear"><b>' + esc(rd.r) + '</b><i></i>' +
           '<span>' + rd.list.length + '문제</span></div>');
    rd.list.forEach(function (it, i) {
      var other = it.r.filter(function (r) { return r !== rd.r; });
      h.push('<div class="citem" id="q' + ri + '_' + i + '"><div class="cnum">' + (it.no || i + 1) + '</div>' +
             renderSolved(it) +
             (other.length ? '<div class="note" style="margin:10px 0 0">같은 문제: ' +
               esc(other.join(' · ')) + '</div>' : '') + '</div>');
    });
  });
  $('#cdetail').innerHTML = h.join('');
  wireJumps();
  $('#tt').textContent = '20' + y + '년';
  $('#ts').textContent = o.n + '문제 · ' + o.rounds.length + '개 회차';
  $('#pbar').style.width = '100%';
  show('concept');
}

/* 묶음 하나(회차 또는 번호 구간)를 실린 순서대로 */
function openSet(o) {
  var h = ['<div class="chead"><h1>' + esc(o.label) + '</h1>' +
           '<div class="sub1">' + o.list.length + '문제 · 실린 순서대로 · 답이 다 보입니다</div></div>',
           '<button class="btn pri" id="fgo">이 ' + o.list.length + '문제 풀기' +
           '<small>답을 가리고 채점합니다</small></button>'];
  o.list.forEach(function (it, i) {
    h.push('<div class="citem"><div class="cnum">' + (it.no || i + 1) + '</div>' +
           renderSolved(it) + '</div>');
  });
  $('#cdetail').innerHTML = h.join('');
  $('#fgo').onclick = function () { startSession(o.list, o.label); };
  $('#tt').textContent = o.label;
  $('#ts').textContent = o.list.length + '문제';
  $('#pbar').style.width = '100%';
  show('concept');
}

/* k번 출제된 문제를 최근 출제순으로 */
function openFreq(k) {
  var o = freqs().filter(function (x) { return x.k === k; })[0];
  if (!o) return;
  var h = ['<div class="chead"><h1>' + k + '회 출제된 문제</h1>' +
           '<div class="sub1">' + o.list.length + '문제 · 최근 출제순 · 답이 다 보입니다</div></div>',
           '<button class="btn pri" id="fgo">이 ' + o.list.length + '문제 풀기' +
           '<small>답을 가리고 채점합니다</small></button>'];

  /* 한 번만 나온 문제는 수가 많아 목차를 생략한다 */
  if (k > 1) {
    h.push('<div class="cidx"><div class="cidxr"><span>' + o.list.map(function (it, i) {
      var r = latest(it);
      return '<a href="#" data-jump="f' + i + '">' + esc(shortTitle(it)) +
             '<i>' + ryear(r) + '년 ' + rnum(r) + '회</i></a>';
    }).join('') + '</span></div></div>');
  }
  o.list.forEach(function (it, i) {
    h.push('<div class="cyear"><b>' + esc(latest(it)) + '</b><i></i>' +
           (k > 1 ? '<span>' + k + '회 출제</span>' : '') + '</div>');
    h.push('<div class="citem" id="f' + i + '"><div class="cnum">' + (i + 1) + '</div>' +
           renderSolved(it) +
           (k > 1 ? '<div class="note" style="margin:10px 0 0">출제: ' +
             esc(it.r.join(' · ')) + '</div>' : '') + '</div>');
  });
  $('#cdetail').innerHTML = h.join('');
  wireJumps();
  $('#fgo').onclick = function () { startSession(o.list, k + '회 출제'); };
  $('#tt').textContent = k + '회 출제';
  $('#ts').textContent = '빈출순 · ' + o.list.length + '문제';
  $('#pbar').style.width = '100%';
  show('concept');
}

function openConcept(title) {
  var list = IT.filter(function (it) { return it.t === title; });
  /* 최근 회차가 앞으로 */
  function newest(it) { return it.y.slice().sort().reverse()[0] || '00'; }
  list.sort(function (a, b) { return newest(b).localeCompare(newest(a)); });

  var h = ['<div class="chead"><h1>◇ ' + esc(title) + '</h1>' +
           '<div class="sub1">' + list.length + '문제 · 답이 다 보입니다</div></div>'];
  list.forEach(function (it) {
    h.push('<div class="cyear"><b>' + esc(it.r[0] || '') + '</b><i></i>' +
           (it.r.length > 1 ? '<span>같은 문제 ' + it.r.length + '회 출제</span>' : '') +
           '</div>');
    h.push('<div class="citem">' + renderSolved(it) +
           (it.r.length > 1 ? '<div class="note" style="margin:10px 0 0">출제: ' +
             esc(it.r.join(' · ')) + '</div>' : '') + '</div>');
  });
  $('#cdetail').innerHTML = h.join('');
  $('#tt').textContent = title;
  $('#ts').textContent = '개념 · ' + list.length + '문제';
  $('#pbar').style.width = '100%';
  show('concept');
}

/* ---------- 상태 ---------- */
var S = { list: [], pos: 0, graded: false, marks: {}, label: '' };

function startSession(list, label) {
  if (!list.length) return;
  S = { list: list, pos: 0, graded: false, marks: {}, label: label };
  show('study'); paint();
}
/* ---------- 화면 히스토리: 폰의 뒤로가기가 사이트를 나가지 않고 이전 화면으로 ---------- */
var DEPTH = { load: 0, home: 0, concepts: 1, study: 1, done: 1, concept: 2 };
var progGo = false;   /* 코드가 history.go 를 부른 경우 — 풀이 중단 확인을 건너뛴다 */
var goTo = null;      /* 그때 실제로 띄운 화면. 돌아간 히스토리 칸에 이 화면을 적는다 */
function navTo(n) {
  var d = DEPTH[n], cur = history.state, d0 = cur && cur.d || 0;
  try {
    if (d > d0) history.pushState({ s: n, d: d }, '');
    else if (d === d0) history.replaceState({ s: n, d: d }, '');
    else { progGo = true; goTo = { s: n, d: d }; history.go(d - d0); }
  } catch (e) {}
}
function show(n, pop) {
  if (!pop) navTo(n);
  $$('.scr').forEach(function (e) { e.classList.toggle('on', e.id === 'scr-' + n); });
  /* 상단바가 필요 없는 화면 */
  var bare = (n === 'home' || n === 'load' || n === 'concepts');
  $('#top').style.display = bare ? 'none' : '';
  $('#bot').style.display = (n === 'study') ? '' : 'none';
  if (n === 'done') {
    $('#tt').textContent = '결과';
    $('#ts').textContent = S.label + ' · ' + S.list.length + '문제';
    $('#pbar').style.width = '100%';
  }
  $$('.tabs button[data-go]').forEach(function (b) {
    b.classList.toggle('on', b.dataset.go === (n === 'concept' ? 'concepts' : n));
  });
  window.scrollTo(0, 0);
}

function paint() {
  var it = S.list[S.pos];
  S.graded = false; S.marks = {};
  $('#tt').textContent = isMC(it) ? (it.no ? it.no + '번 문제' : '문제') : it.t;
  $('#ts').textContent = S.label + ' · ' + (S.pos + 1) + '/' + S.list.length +
                         (it.r.length ? ' · ' + it.r.join(', ') : '');
  $('#pbar').style.width = (S.pos / S.list.length * 100) + '%';
  $('#q').innerHTML = renderQ(it);
  $('#act').textContent = '채점하기';
  $('#skip').style.display = '';
  $('#res').textContent = '';
  if (isMC(it)) {
    $$('#q .opt').forEach(function (b) {
      b.onclick = function () {
        if (S.graded) return;
        if (it.a.length === 1) $$('#q .opt').forEach(function (x) { if (x !== b) x.classList.remove('sel'); });
        b.classList.toggle('sel');
      };
    });
    return;
  }
  $$('#q [data-show]').forEach(function (b) {
    b.onclick = function () { revealImg(+b.dataset.show); };
  });
  var ins = $$('#q input.ipt');
  ins.forEach(function (el, i) {
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (ins[i + 1]) ins[i + 1].focus(); else doAct();
      }
    });
  });
}

function revealImg(k) {
  var it = S.list[S.pos], slot = $('#q .slot[data-b="' + k + '"]');
  if (!slot || slot.dataset.done) return;
  slot.dataset.done = '1';
  var wrap = document.createElement('span');
  wrap.innerHTML = '<span class="sol"><span class="lb">정답</span>' +
                   fillMedia(it.b[k].a) + '</span>' +
                   '<span class="selfg"><button class="g">맞음</button>' +
                   '<button class="b">틀림</button></span>';
  slot.parentNode.insertBefore(wrap, slot.nextSibling);
  $('button[data-show="' + k + '"]', slot).remove();
  var bs = wrap.querySelectorAll('.selfg button');
  bs[0].onclick = function () { S.marks[k] = 'ok'; wrap.querySelector('.selfg').innerHTML = '<span class="mark" style="color:var(--gr)">✓ 맞음 처리</span>'; tally(); };
  bs[1].onclick = function () { S.marks[k] = 'no'; wrap.querySelector('.selfg').innerHTML = '<span class="mark" style="color:var(--rd)">✕ 틀림 처리</span>'; tally(); };
}

function doAct() {
  if (!S.graded) gradeNow(); else next();
}

/* 객관식: 고른 보기가 정답과 정확히 같아야 맞음 (복수 정답이면 전부 골라야) */
function gradeMC(it) {
  var pick = $$('#q .opt.sel').map(function (b) { return +b.dataset.o; });
  var ok = pick.length === it.a.length && pick.every(function (i) { return it.a.indexOf(i) >= 0; });
  S.marks = { 0: ok ? 'ok' : 'no' };
  $$('#q .opt').forEach(function (b) {
    var i = +b.dataset.o;
    if (it.a.indexOf(i) >= 0) b.classList.add('ok');
    else if (b.classList.contains('sel')) b.classList.add('bad');
    b.disabled = true;
  });
  if (it.x) $('#q').insertAdjacentHTML('beforeend', xpHtml(it));
}

function gradeNow() {
  var it = S.list[S.pos];
  if (isMC(it)) {
    gradeMC(it);
  } else {
    /* 그룹별 나열형 묶기 */
    var setg = {};
    it.b.forEach(function (b) {
      if (b.s && b.t === 'txt') (setg[b.g] = setg[b.g] || []).push(b);
    });
    var done = {};
    Object.keys(setg).forEach(function (g) {
      var arr = setg[g];
      if (arr.length < 2) return;
      var us = arr.map(function (b) { var e = $('#q input[data-b="' + b.k + '"]'); return e ? e.value : ''; });
      var rs = judgeSet(us, arr.map(function (b) { return b.a; }));
      arr.forEach(function (b, i) { done[b.k] = rs[i]; });
    });
    it.b.forEach(function (b) {
      if (b.t === 'img') { if (!(b.k in S.marks)) S.marks[b.k] = 'skip'; return; }
      var el = $('#q input[data-b="' + b.k + '"]');
      var r = done[b.k] || { v: judge(el ? el.value : '', b.a), a: b.a };
      S.marks[b.k] = (r.v === 'ok') ? 'ok' : (r.v === 'blank' ? 'no' : r.v);
      paintBlank(b, r.v, r.a || b.a);
    });
    if (it.x) $('#q').insertAdjacentHTML('beforeend', xpHtml(it));
  }
  S.graded = true;
  record(true);
  $('#act').textContent = (S.pos + 1 < S.list.length) ? '다음 문제 →' : '결과 보기';
  $('#skip').style.display = 'none';
  tally();
}

function paintBlank(b, v, ans) {
  var slot = $('#q .slot[data-b="' + b.k + '"]');
  if (!slot) return;
  slot.classList.remove('ok', 'no2', 'mb');
  slot.classList.add(v === 'ok' ? 'ok' : (v === 'mb' ? 'mb' : 'no2'));
  var m = document.createElement('span');
  m.className = 'mark';
  m.textContent = v === 'ok' ? '✓' : (v === 'mb' ? '?' : '✕');
  slot.appendChild(m);
  if (v === 'ok') return;
  var sol = document.createElement('span');
  sol.className = 'sol';
  sol.innerHTML = '<span class="lb">정답</span>' + strip(ans) +
                  '<button class="fixbtn" data-fix="' + b.k + '">맞게 처리</button>';
  slot.parentNode.insertBefore(sol, slot.nextSibling);
  $('button[data-fix="' + b.k + '"]', sol).onclick = function () {
    S.marks[b.k] = 'ok';
    slot.classList.remove('no2', 'mb'); slot.classList.add('ok');
    $('.mark', slot).textContent = '✓';
    this.remove(); tally();
  };
}

/* 채점된 칸 수와 맞은 칸 수. 객관식은 한 문제가 한 칸. */
function score(it) {
  var ok = 0, tot = 0;
  if (isMC(it)) {
    if (S.marks[0]) { tot = 1; ok = S.marks[0] === 'ok' ? 1 : 0; }
    return { ok: ok, tot: tot };
  }
  it.b.forEach(function (b) {
    var m = S.marks[b.k];
    if (m === 'skip' || m === undefined) return;
    tot++; if (m === 'ok') ok++;
  });
  return { ok: ok, tot: tot };
}

function tally() {
  var it = S.list[S.pos], sc = score(it);
  if (isMC(it)) {
    $('#res').innerHTML = !sc.tot ? '' : sc.ok ? '<b class="g">맞았습니다</b>' :
      '<b class="r">틀렸습니다</b> · 정답 ' + it.a.map(function (i) { return CIRC[i]; }).join(' ');
  } else {
    $('#res').innerHTML = sc.tot ? ('맞은 칸 <b class="' + (sc.ok === sc.tot ? 'g' : 'r') + '">' +
                                    sc.ok + '</b> / ' + sc.tot) : '';
  }
  if (S.graded) record(false);
}

/* 채점하는 즉시 기록한다. '다음 문제' 를 누르지 않고 앱을 닫아도 남는다. */
function record(firstTime) {
  if (!S.list.length) return;
  var it = S.list[S.pos], k = key(it), sc = score(it);
  var p = prog[k] || { n: 0, ok: 0, last: 0 };
  if (firstTime) p.n++;
  p.last = Date.now();
  p.ok = (sc.tot && sc.ok === sc.tot) ? 1 : 0;
  p.rate = sc.tot ? Math.round(sc.ok / sc.tot * 100) : null;
  prog[k] = p; save();
}

function next() {
  record(false);
  if (S.pos + 1 < S.list.length) { S.pos++; paint(); }
  else finish();
}

function finish() {
  var ok = 0, rows = '';
  S.list.forEach(function (it) {
    var p = prog[key(it)];
    var good = p && p.ok;
    if (good) ok++;
    rows += '<div><i>' + (good ? '✅' : '❌') + '</i><span>' +
            '<span class="tag">' + (isMC(it) && it.no ? it.no + '번' : 'p' + it.p) + '</span>' +
            esc(it.t) +
            (!isMC(it) && p && p.rate != null ? ' <span style="color:var(--dim)">' + p.rate + '%</span>' : '') +
            '</span></div>';
  });
  $('#big').textContent = Math.round(ok / S.list.length * 100) + '%';
  $('#bigsub').textContent = S.list.length + '문제 중 ' + ok + '문제 ' +
                             (S.list.some(function (it) { return !isMC(it); }) ? '전부 정답' : '정답');
  $('#rlist').innerHTML = rows;
  show('done');
}
function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

/* ---------- 홈 ---------- */
function wrongList() {
  return IT.filter(function (it) { var p = prog[key(it)]; return p && !p.ok; });
}
function unseen() {
  return IT.filter(function (it) { return !prog[key(it)]; });
}
function shuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function home(pop) {
  $('#htitle').textContent = (DATA.title || '문제집');
  $('#hsub').textContent = (DATA.subtitle ? DATA.subtitle + ' · ' : '') +
      '문제 ' + IT.length + '개 · ' +
      (IT.every(isMC) ? '답을 고르면 채점해 드립니다' : '답을 적으면 채점해 드립니다');
  var done = IT.filter(function (it) { return prog[key(it)]; });
  var good = IT.filter(function (it) { var p = prog[key(it)]; return p && p.ok; });
  $('#s1').innerHTML = '<b>' + done.length + '</b><span>푼 문제</span>';
  $('#s2').innerHTML = '<b>' + good.length + '</b><span>' + (IT.every(isMC) ? '맞힘' : '전부 맞음') + '</span>';
  $('#s3').innerHTML = '<b>' + (done.length ? Math.round(good.length / done.length * 100) : 0) +
                       '%</b><span>정답률</span>';
  var w = wrongList(), u = unseen();
  $('#bw').innerHTML = '오답 다시 풀기<small>' + (w.length ? w.length + '문제' : '없음') + '</small>';
  $('#bw').disabled = !w.length;
  $('#bc').innerHTML = '이어서 풀기<small>' + (u.length ? '안 푼 ' + u.length + '문제' : '전부 풀었습니다') + '</small>';
  $('#bc').disabled = !u.length;
  /* 빈출순은 여러 회차에 반복 출제된 문제가 있을 때만 의미가 있다 */
  $('#bf').style.display = hasRepeats() ? '' : 'none';
  $('#bf').innerHTML = '빈출순으로 풀기<small>많이 나온 문제부터 · ' +
    (u.length ? '안 푼 ' + u.length + '문제' : '전부 풀어서 처음부터 ' + IT.length + '문제') + '</small>';
  var all = sets();
  $('#yrsec').textContent = setsName();
  $('#yr').classList.toggle('wide', !hasYears());
  $('#yr').innerHTML = all.map(function (o, i) {
    var d = o.list.filter(function (it) { var p = prog[key(it)]; return p && p.ok; }).length;
    return '<button data-i="' + i + '"><b>' + esc(o.label) + '</b><span>' + d + ' / ' + o.list.length +
           '</span><span class="pb"><i style="width:' + (d / o.list.length * 100) + '%"></i></span></button>';
  }).join('');
  paintRnd();
  $$('#yr button').forEach(function (b) {
    b.onclick = function () { var o = all[+b.dataset.i]; startSession(o.list, o.label); };
  });
  show('home', pop);
}

/* ---------- 배선 ---------- */
$('#act').onclick = doAct;
$('#skip').onclick = function () { gradeNow(); };
$('#back').onclick = function () {
  if (history.state && history.state.d > 0) history.back(); else home();
};
window.addEventListener('popstate', function (e) {
  var st = e.state || { s: DATA ? 'home' : 'load', d: 0 };
  /* 코드가 부른 이동 — 화면은 이미 show() 가 그렸다. 도착한 칸이 예전 화면
     (예: 기출 묶음 → 풀기일 때의 '기출 보기')이면 그걸 다시 그리지 않고 칸만 고친다. */
  if (progGo && goTo) {
    try { history.replaceState(goTo, ''); } catch (e2) {}
    progGo = false; goTo = null;
    return;
  }
  var studying = $('#scr-study').classList.contains('on');
  if (studying && st.s !== 'study' && !progGo && !confirm('풀이를 그만두고 홈으로 갈까요?')) {
    history.pushState({ s: 'study', d: 1 }, '');
    return;
  }
  progGo = false;
  if (!DATA || st.s === 'load') { paintLib(); show('load', true); return; }
  /* 새로고침 뒤에는 메모리 상태가 비어 있다 — 내용이 없는 화면은 홈으로 */
  var ready = { study: S.list.length, done: S.list.length, concept: $('#cdetail').innerHTML };
  if (st.s in ready && !ready[st.s]) {
    try { history.replaceState({ s: 'home', d: 0 }, ''); } catch (e) {}
    home(true);
  } else if (st.s === 'home') home(true);
  else if (st.s === 'concepts') { paintBrowse(); show('concepts', true); }
  else show(st.s, true);
});
$$('.tabs button[data-go]').forEach(function (b) {
  b.onclick = function () {
    if (b.dataset.go === 'home') home();
    else { paintBrowse(); show('concepts'); }
  };
});
$('#csearch').addEventListener('input', function () { CS.q = this.value; paintConcepts(); });
$$('#csort button').forEach(function (b) {
  b.onclick = function () {
    CS.sort = b.dataset.s;
    $$('#csort button').forEach(function (x) { x.classList.toggle('on', x === b); });
    paintConcepts();
  };
});
$('#bw').onclick = function () { startSession(shuffle(wrongList()), '오답'); };
$('#bc').onclick = function () { startSession(unseen(), '이어서'); };
/* 안 푼 문제를 많이 나온 것부터. 다 풀었으면 전체를 처음부터. */
$('#bf').onclick = function () {
  var all = byFreq(), left = all.filter(function (it) { return !prog[key(it)]; });
  startSession(left.length ? left : all, '빈출순');
};
/* ---------- 랜덤 설정 ---------- */
var RK = 'pd_rnd';
var rnd = { y1: null, y2: null, n: 20, only: false };
try { Object.assign(rnd, JSON.parse(localStorage.getItem(RK) || '{}')); } catch (e) {}
var COUNTS = [10, 20, 30, 50, 0];   /* 0 = 전체 */

/* 범위는 홈의 묶음(연도·회차·번호 구간) 단위. y1/y2 에 묶음 키를 담는다. */
function rndRange(all) {
  var keys = all.map(function (o) { return o.k; });
  var a = keys.indexOf(rnd.y1), b = keys.indexOf(rnd.y2);
  if (a < 0) a = keys.length - 1;
  if (b < 0) b = 0;
  return a <= b ? [a, b] : [b, a];
}
function rndPool() {
  var all = sets(), ab = rndRange(all), seen = {}, out = [];
  all.slice(ab[0], ab[1] + 1).forEach(function (o) {
    o.list.forEach(function (it) {
      var k = key(it);
      if (seen[k] || (rnd.only && prog[k])) return;
      seen[k] = 1; out.push(it);
    });
  });
  return out;
}
function rndLabel(all) {
  var ab = rndRange(all), lo = all[ab[1]].label, hi = all[ab[0]].label;
  if (all.length <= 1) return '전체';
  return lo === hi ? lo : lo + '~' + hi;
}
function rndSave() { try { localStorage.setItem(RK, JSON.stringify(rnd)); } catch (e) {} }

function paintRnd() {
  var all = sets(), ab = rndRange(all);
  rnd.y1 = all[ab[1]].k; rnd.y2 = all[ab[0]].k;
  $('#rrange').style.display = all.length > 1 ? '' : 'none';
  $('#rrange label').textContent = hasYears() ? '연도' : '범위';
  /* 목록은 오래된 것(뒤쪽)부터 */
  var rev = all.slice().reverse();
  ['#ry1', '#ry2'].forEach(function (sel, i) {
    var el = $(sel), cur = i ? rnd.y2 : rnd.y1;
    el.innerHTML = rev.map(function (o) {
      return '<option value="' + esc(o.k).replace(/"/g, '&quot;') + '"' + (o.k === cur ? ' selected' : '') + '>' +
             esc(o.label) + '</option>';
    }).join('');
  });
  $('#rn').innerHTML = COUNTS.map(function (c) {
    return '<button data-n="' + c + '"' + (c === rnd.n ? ' class="on"' : '') + '>' +
           (c ? c : '전체') + '</button>';
  }).join('');
  $$('#rn button').forEach(function (b) {
    b.onclick = function () { rnd.n = +b.dataset.n; rndSave(); paintRnd(); };
  });
  $('#ronly').checked = !!rnd.only;

  var pool = rndPool();
  var n = rnd.n ? Math.min(rnd.n, pool.length) : pool.length;
  $('#rgo').textContent = pool.length ? n + '문제 시작' : '해당하는 문제가 없습니다';
  $('#rgo').disabled = !pool.length;
  $('#brsub').textContent = rndLabel(all) + ' · ' +
    (rnd.n ? rnd.n + '문제' : '전체') + (rnd.only ? ' · 안 푼 것만' : '') +
    ' · 후보 ' + pool.length + '개';
}

$('#br').onclick = function () {
  var el = $('#rnd');
  el.hidden = !el.hidden;
  if (!el.hidden) paintRnd();
};
$('#ry1').onchange = function () { rnd.y1 = this.value; rndSave(); paintRnd(); };
$('#ry2').onchange = function () { rnd.y2 = this.value; rndSave(); paintRnd(); };
$('#ronly').onchange = function () { rnd.only = this.checked; rndSave(); paintRnd(); };
$('#rgo').onclick = function () {
  var pool = shuffle(rndPool());
  if (!pool.length) return;
  if (rnd.n) pool = pool.slice(0, rnd.n);
  startSession(pool, '랜덤 ' + rndLabel(sets()));
};
$('#again').onclick = function () { var w = wrongList(); w.length ? startSession(shuffle(w), '오답') : home(); };
$('#tohome').onclick = function () { home(); };
$('#reset').onclick = function () {
  if (confirm('이 문제집의 진도 기록을 모두 지웁니다. 계속할까요?')) { prog = {}; save(); home(); }
};

/* ---------- 문제집 목록 ---------- */
/* LIB: [{ id, title, subtitle, n, src: 'bundled'|'file', file, v, bv }]
   bundled = 사이트에 들어 있는 것(data/catalog.json), file = 사용자가 파일로 더한 것.
   데이터 본체는 IndexedDB 'ds:<id>', 진도는 localStorage 'pd_prog:<id>'. */
function libLoad() {
  try { LIB = JSON.parse(localStorage.getItem(LIBK) || 'null'); } catch (e) { LIB = null; }
}
function libSave() { try { localStorage.setItem(LIBK, JSON.stringify(LIB)); } catch (e) {} }
function libGet(id) { return LIB.filter(function (m) { return m.id === id; })[0]; }
function libPut(m) {
  var i = LIB.map(function (x) { return x.id; }).indexOf(m.id);
  if (i < 0) LIB.push(m); else LIB[i] = m;
  libSave();
}
function progCount(id) {
  try { return Object.keys(JSON.parse(localStorage.getItem('pd_prog:' + id) || '{}')).length; }
  catch (e) { return 0; }
}
function slugId(s) {
  return String(s || '').trim().replace(/\s+/g, '-').replace(/[^\w\-가-힣]/g, '').slice(0, 40) || 'deck';
}

/* 문제집을 하나만 두던 때의 데이터·진도를 목록으로 옮긴다 (한 번만) */
function migrate() {
  if (LIB) return Promise.resolve();
  LIB = [];
  return idbGet(LEGACY).then(function (d) {
    if (!d || !d.items) return;
    var id = d.id || (d.local ? slugId(d.title) : 'ek');
    d.id = id;
    return idbSet(dsKey(id), d).then(function () {
      LIB.push({ id: id, title: d.title, subtitle: d.subtitle, n: d.items.length, v: d.v,
                 src: d.local ? 'file' : 'bundled', file: d.local ? null : 'ek.json' });
      try {
        var old = localStorage.getItem('pd_prog');
        if (old && !localStorage.getItem('pd_prog:' + id)) localStorage.setItem('pd_prog:' + id, old);
        localStorage.setItem(CURK, id);
      } catch (e) {}
      return idbDel(LEGACY);
    });
  }).catch(function () {}).then(libSave);
}

/* 문제마다 빠질 수 있는 필드를 채운다 */
function normalize(d) {
  d.media = d.media || {};
  d.items.forEach(function (it, i) {
    it.r = it.r || []; it.y = it.y || []; it.b = it.b || [];
    if (it.i == null) it.i = i;
    /* id 도 쪽 번호도 없는 문제는 진도 키가 겹치지 않게 순번을 id 로 */
    if (it.id == null && it.p == null) it.id = 'n' + i;
  });
  return d;
}

function setData(d) {
  DATA = normalize(d); IT = d.items; MED = d.media;
  document.title = (d.title || '문제집') + ' — paperdeck';
}
function activate(d) {
  var changed = CUR !== d.id;
  setData(d);
  CUR = d.id;
  try { localStorage.setItem(CURK, CUR); } catch (e) {}
  PK = 'pd_prog:' + CUR;
  loadProg();
  if (changed) {
    S = { list: [], pos: 0, graded: false, marks: {}, label: '' };
    $('#cdetail').innerHTML = '';
    $('#rnd').hidden = true;
  }
}

/* 사이트에 들어 있는 문제집 목록. catalog.json 이 없는 예전 배포는 ek.json 하나. */
function fetchCatalog() {
  return fetch('data/catalog.json', { cache: 'no-store' }).then(function (r) {
    return r.ok ? r.json() : null;
  }).catch(function () { return null; }).then(function (c) {
    if (c && Array.isArray(c.decks)) return c.decks;
    return fetch('data/version.json', { cache: 'no-store' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (m) {
      return m && m.v ? [{ id: m.id || 'ek', file: 'ek.json', v: m.v, title: m.title, n: m.n }] : [];
    }).catch(function () { return []; });
  });
}
function mergeCatalog(list) {
  var ids = list.map(function (c) { return c.id; });
  list.forEach(function (c) {
    var m = libGet(c.id);
    if (m && m.src === 'file') return;          /* 같은 id 로 직접 더한 것이 있으면 그대로 둔다 */
    m = m || { id: c.id, src: 'bundled' };
    m.title = c.title || m.title; m.subtitle = c.subtitle != null ? c.subtitle : m.subtitle;
    m.n = c.n || m.n; m.file = c.file; m.bv = c.v;
    libPut(m);
  });
  /* 사이트에서 빠진 문제집은 받아 둔 적이 없을 때만 목록에서 지운다 */
  LIB = LIB.filter(function (m) { return m.src !== 'bundled' || ids.indexOf(m.id) >= 0 || m.v; });
  libSave();
}
function download(m) {
  return fetch('data/' + m.file, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw 0;
    return r.json();
  }).then(function (j) {
    if (!j || !Array.isArray(j.items)) throw 0;
    j.id = m.id;
    return idbSet(dsKey(m.id), j).then(function () {
      m.v = j.v; m.n = j.items.length; m.title = j.title || m.title; m.subtitle = j.subtitle || m.subtitle;
      libPut(m);
      return j;
    });
  });
}

/* 지금 문제집이 사이트에서 갱신됐으면 뒤에서 조용히 받아 바꾼다 */
function maybeUpdate() {
  var m = CUR && libGet(CUR);
  if (!m || m.src !== 'bundled' || !m.bv || m.bv === m.v) return;
  download(m).then(function (j) {
    if (CUR !== m.id) return;
    setData(j);
    if ($('#scr-home').classList.contains('on')) home(true);
  }).catch(function () {});
}

function openDeck(id) {
  var m = libGet(id), st = $('#lstat');
  if (!m) return Promise.resolve();
  st.textContent = '여는 중…';
  return idbGet(dsKey(id)).catch(function () { return null; }).then(function (d) {
    if (d && d.items) return d;
    if (m.src !== 'bundled') throw '저장된 데이터가 없습니다';
    st.textContent = '문제를 받는 중…';
    return download(m);
  }).then(function (d) {
    st.textContent = '';
    activate(d);
    home();
    maybeUpdate();
  }).catch(function () {
    st.textContent = '문제집을 열지 못했습니다. 인터넷 연결을 확인해 주세요.';
    paintLib();
  });
}

function paintLib() {
  var n = LIB ? LIB.length : 0;
  $('#libsec').style.display = n ? '' : 'none';
  $('#lib').innerHTML = (LIB || []).map(function (m) {
    var d = progCount(m.id), cur = m.id === CUR && DATA;
    return '<div class="crow lrow' + (cur ? ' cur' : '') + '" data-id="' + esc(m.id).replace(/"/g, '&quot;') + '">' +
           '<span class="cname">' + esc(m.title || m.id) +
           (m.subtitle ? '<small>' + esc(m.subtitle) + '</small>' : '') + '</span>' +
           '<span class="cmeta"><b>' + (m.n ? m.n + '문제' : '') + '</b>' +
           (cur ? '지금 보는 중' : d ? '푼 문제 ' + d : m.src === 'file' ? '직접 추가' : '') + '</span>' +
           (m.src === 'file' ? '<button class="fixbtn ldel" type="button">삭제</button>' : '') + '</div>';
  }).join('');
  $$('#lib .lrow').forEach(function (r) {
    r.onclick = function (ev) {
      var id = r.dataset.id;
      if (ev.target.classList.contains('ldel')) { removeDeck(id); return; }
      if (id === CUR && DATA) { $('#lback').click(); return; }
      openDeck(id);
    };
  });
  $('#lhint0').style.display = n ? 'none' : '';
  $('#lhint').style.display = '';
  $('#drop').style.display = '';
  $('#lback').style.display = DATA ? '' : 'none';
}

function removeDeck(id) {
  var m = libGet(id);
  if (!m || !confirm('"' + (m.title || id) + '" 문제집과 그 진도 기록을 이 기기에서 지웁니다.')) return;
  idbDel(dsKey(id)).then(function () {
    try { localStorage.removeItem('pd_prog:' + id); } catch (e) {}
    LIB = LIB.filter(function (x) { return x.id !== id; });
    libSave();
    if (CUR === id) {
      DATA = null; IT = []; MED = {}; CUR = null; prog = {};
      try { localStorage.removeItem(CURK); } catch (e) {}
    }
    paintLib();
  });
}

/* 목록 화면. 홈에서 들어오면 히스토리에 한 칸 쌓아 뒤로가기로 돌아간다. */
function showLib(fromHome) {
  $('#lstat').textContent = '';
  paintLib();
  if (fromHome) {
    show('load', true);
    try { history.pushState({ s: 'load', d: 1 }, ''); } catch (e) {}
  } else show('load');
}

function validItem(it) {
  if (!it || typeof it.h !== 'string') return false;
  if (it.q === 'mc') {
    return Array.isArray(it.o) && it.o.length > 1 && Array.isArray(it.a) && it.a.length > 0 &&
      it.a.every(function (i) { return i >= 0 && i < it.o.length; });
  }
  return Array.isArray(it.b);
}

function acceptFile(f) {
  if (!f) return;
  var st = $('#lstat');
  st.textContent = '읽는 중… (' + Math.round(f.size / 1e6 * 10) / 10 + ' MB)';
  var fr = new FileReader();
  fr.onerror = function () { st.textContent = '파일을 읽지 못했습니다.'; };
  fr.onload = function () {
    var j;
    try { j = JSON.parse(fr.result); }
    catch (e) { st.textContent = 'JSON 파일이 아닙니다.'; return; }
    if (!j || !Array.isArray(j.items) || !j.items.length) {
      st.textContent = 'paperdeck 데이터 형식이 아닙니다. (items 필드가 필요합니다)'; return;
    }
    var bad = j.items.filter(function (it) { return !validItem(it); }).length;
    if (bad) {
      st.textContent = 'paperdeck 데이터 형식이 아닙니다. (형식이 맞지 않는 문제 ' + bad + '개)'; return;
    }
    var id = j.id || slugId(j.title || f.name.replace(/\.json$/i, ''));
    var had = libGet(id);
    /* 사이트에 들어 있는 문제집과 id 가 겹치면 따로 둔다 */
    if (had && had.src === 'bundled') id += '-file';
    had = libGet(id);
    if (had && !confirm('"' + (had.title || id) + '" 문제집이 이미 있습니다. 새 파일로 바꿀까요? (진도 기록은 남습니다)')) {
      st.textContent = ''; return;
    }
    j.id = id;
    j.title = j.title || f.name.replace(/\.json$/i, '');
    st.textContent = '저장 중…';
    idbSet(dsKey(id), j).then(function () {
      st.textContent = '';
      libPut({ id: id, title: j.title, subtitle: j.subtitle, n: j.items.length, src: 'file' });
      activate(j);
      home();
    }).catch(function (e) { st.textContent = '저장 실패: ' + e; });
  };
  fr.readAsText(f);
}

function boot() {
  libLoad();
  migrate().then(function () {
    var cur = null;
    try { cur = localStorage.getItem(CURK); } catch (e) {}
    var opened = cur && libGet(cur) ? idbGet(dsKey(cur)).then(function (d) {
      if (d && d.items) { activate(d); home(); return true; }
      return false;
    }).catch(function () { return false; }) : Promise.resolve(false);
    return opened.then(function (ok) {
      if (!ok) { show('load'); $('#lstat').textContent = '문제집 목록을 받는 중…'; }
      return fetchCatalog().then(function (list) {
        mergeCatalog(list);
        if (ok) { maybeUpdate(); return; }
        $('#lstat').textContent = '';
        /* 고를 것이 하나뿐이면 바로 연다 */
        if (LIB.length === 1) return openDeck(LIB[0].id);
        paintLib();
      });
    });
  });
}

$('#file').addEventListener('change', function () { acceptFile(this.files[0]); this.value = ''; });
$('#drop').addEventListener('click', function () { $('#file').click(); });
['dragenter', 'dragover'].forEach(function (e) {
  $('#drop').addEventListener(e, function (ev) { ev.preventDefault(); this.classList.add('over'); });
});
['dragleave', 'drop'].forEach(function (e) {
  $('#drop').addEventListener(e, function (ev) { ev.preventDefault(); this.classList.remove('over'); });
});
$('#drop').addEventListener('drop', function (ev) {
  acceptFile(ev.dataTransfer.files && ev.dataTransfer.files[0]);
});
$('#swap').onclick = function () { showLib(true); };
$('#lback').onclick = function () {
  if (history.state && history.state.d > 0) history.back(); else home();
};

/* 탭을 닫거나 백그라운드로 보낼 때 안전망 */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') save();
});
window.addEventListener('pagehide', save);

/* ---------- 테마: 자동(시스템) → 라이트 → 다크 ---------- */
var THEMES = ['auto', 'light', 'dark'];
var THEME_LABEL = { auto: '◐ 자동', light: '☀ 라이트', dark: '☾ 다크' };
var themeNow = 'auto';
try { themeNow = localStorage.getItem('pd_theme') || 'auto'; } catch (e) {}
if (THEMES.indexOf(themeNow) < 0) themeNow = 'auto';
function paintTheme() {
  var root = document.documentElement;
  if (themeNow === 'auto') root.removeAttribute('data-t'); else root.setAttribute('data-t', themeNow);
  var dark = themeNow === 'dark' || (themeNow === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  $$('meta[name="theme-color"]').forEach(function (m) {
    if (!m.dataset.c) m.dataset.c = m.content;
    m.content = themeNow === 'auto' ? m.dataset.c : (dark ? '#232629' : '#ffffff');
  });
  $$('.thm').forEach(function (b) {
    b.textContent = THEME_LABEL[themeNow];
    b.setAttribute('aria-label', '화면 테마: ' + THEME_LABEL[themeNow].slice(2));
  });
}
$$('.thm').forEach(function (b) {
  b.onclick = function () {
    themeNow = THEMES[(THEMES.indexOf(themeNow) + 1) % THEMES.length];
    try {
      if (themeNow === 'auto') localStorage.removeItem('pd_theme'); else localStorage.setItem('pd_theme', themeNow);
    } catch (e) {}
    paintTheme();
  };
});
paintTheme();

try { history.replaceState({ s: 'home', d: 0 }, ''); } catch (e) {}
boot();
