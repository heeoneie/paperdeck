/* ============ paperdeck — 문제집 카드 학습 ============ */
var DATA = null, IT = [], MED = {};
var PK = 'pd_prog', DSK = 'pd_ds';
var prog = {};

/* ---------- IndexedDB (데이터셋은 6MB 급이라 localStorage 불가) ---------- */
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

function loadProg() {
  try { prog = JSON.parse(localStorage.getItem(PK) || '{}'); } catch (e) { prog = {}; }
}
function save() { try { localStorage.setItem(PK, JSON.stringify(prog)); } catch (e) {} }
function key(it) { return it.t + '|' + it.r.join(',') + '|' + it.p; }
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
  return html.replace(/src="(ek_[0-9a-f]{12}\.png)"/g, function (m, n) {
    return MED[n] ? 'src="data:image/png;base64,' + MED[n] + '"' : m;
  });
}
function renderQ(it) {
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

/* ---------- 상태 ---------- */
var S = { list: [], pos: 0, graded: false, marks: {}, label: '' };

function startSession(list, label) {
  if (!list.length) return;
  S = { list: list, pos: 0, graded: false, marks: {}, label: label };
  show('study'); paint();
}
function show(n) {
  $$('.scr').forEach(function (e) { e.classList.toggle('on', e.id === 'scr-' + n); });
  $('#top').style.display = (n === 'home') ? 'none' : '';
  if (n === 'done') {
    $('#tt').textContent = '결과';
    $('#ts').textContent = S.label + ' · ' + S.list.length + '문제';
    $('#pbar').style.width = '100%';
  }
  $('#bot').style.display = (n === 'study') ? '' : 'none';
  if (n === 'load') $('#top').style.display = 'none';
  window.scrollTo(0, 0);
}

function paint() {
  var it = S.list[S.pos];
  S.graded = false; S.marks = {};
  $('#tt').textContent = it.t;
  $('#ts').textContent = S.label + ' · ' + (S.pos + 1) + '/' + S.list.length +
                         ' · ' + it.r.join(', ');
  $('#pbar').style.width = (S.pos / S.list.length * 100) + '%';
  $('#q').innerHTML = renderQ(it);
  $('#act').textContent = '채점하기';
  $('#skip').style.display = '';
  $('#res').textContent = '';
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

function gradeNow() {
  var it = S.list[S.pos];
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

function tally() {
  var it = S.list[S.pos], ok = 0, tot = 0;
  it.b.forEach(function (b) {
    var m = S.marks[b.k];
    if (m === 'skip' || m === undefined) return;
    tot++; if (m === 'ok') ok++;
  });
  $('#res').innerHTML = tot ? ('맞은 칸 <b class="' + (ok === tot ? 'g' : 'r') + '">' +
                               ok + '</b> / ' + tot) : '';
  if (S.graded) record(false);
}

/* 채점하는 즉시 기록한다. '다음 문제' 를 누르지 않고 앱을 닫아도 남는다. */
function record(firstTime) {
  if (!S.list.length) return;
  var it = S.list[S.pos], k = key(it), ok = 0, tot = 0;
  it.b.forEach(function (b) {
    var m = S.marks[b.k];
    if (m === 'skip' || m === undefined) return;
    tot++; if (m === 'ok') ok++;
  });
  var p = prog[k] || { n: 0, ok: 0, last: 0 };
  if (firstTime) p.n++;
  p.last = Date.now();
  p.ok = (tot && ok === tot) ? 1 : 0;
  p.rate = tot ? Math.round(ok / tot * 100) : null;
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
            '<span class="tag">p' + it.p + '</span>' + esc(it.t) +
            (p && p.rate != null ? ' <span style="color:var(--dim)">' + p.rate + '%</span>' : '') +
            '</span></div>';
  });
  $('#big').textContent = Math.round(ok / S.list.length * 100) + '%';
  $('#bigsub').textContent = S.list.length + '문제 중 ' + ok + '문제 전부 정답';
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
function home() {
  $('#htitle').textContent = (DATA.title || '문제집');
  $('#hsub').textContent = (DATA.subtitle || '') +
      ' · 문제 ' + IT.length + '개 · 답을 적으면 채점해 드립니다';
  var done = IT.filter(function (it) { return prog[key(it)]; });
  var good = IT.filter(function (it) { var p = prog[key(it)]; return p && p.ok; });
  $('#s1').innerHTML = '<b>' + done.length + '</b><span>푼 문제</span>';
  $('#s2').innerHTML = '<b>' + good.length + '</b><span>전부 맞음</span>';
  $('#s3').innerHTML = '<b>' + (done.length ? Math.round(good.length / done.length * 100) : 0) +
                       '%</b><span>정답률</span>';
  var w = wrongList(), u = unseen();
  $('#bw').innerHTML = '오답 다시 풀기<small>' + (w.length ? w.length + '문제' : '없음') + '</small>';
  $('#bw').disabled = !w.length;
  $('#bc').innerHTML = '이어서 풀기<small>' + (u.length ? '안 푼 ' + u.length + '문제' : '전부 풀었습니다') + '</small>';
  $('#bc').disabled = !u.length;
  var g = '';
  DATA.years.forEach(function (y) {
    var list = IT.filter(function (it) { return it.y.indexOf(y.y) >= 0; });
    var d = list.filter(function (it) { var p = prog[key(it)]; return p && p.ok; }).length;
    g += '<button data-y="' + y.y + '"><b>20' + y.y + '</b><span>' + d + ' / ' + list.length +
         '</span><span class="pb"><i style="width:' + (d / list.length * 100) + '%"></i></span></button>';
  });
  $('#yr').innerHTML = g;
  $$('#yr button').forEach(function (b) {
    b.onclick = function () {
      var y = b.dataset.y;
      startSession(IT.filter(function (it) { return it.y.indexOf(y) >= 0; }), '20' + y);
    };
  });
  show('home');
}

/* ---------- 배선 ---------- */
$('#act').onclick = doAct;
$('#skip').onclick = function () { gradeNow(); };
$('#back').onclick = function () { if (confirm('풀이를 그만두고 홈으로 갈까요?')) home(); };
$('#bw').onclick = function () { startSession(shuffle(wrongList()), '오답'); };
$('#bc').onclick = function () { startSession(unseen(), '이어서'); };
$('#br').onclick = function () { startSession(shuffle(IT).slice(0, 20), '랜덤 20'); };
$('#again').onclick = function () { var w = wrongList(); w.length ? startSession(shuffle(w), '오답') : home(); };
$('#tohome').onclick = home;
$('#reset').onclick = function () {
  if (confirm('진도 기록을 모두 지웁니다. 계속할까요?')) { prog = {}; save(); home(); }
};

/* ---------- 데이터셋 ---------- */
function setData(d) {
  DATA = d; IT = d.items; MED = d.media;
  document.title = (d.title || '문제집') + ' — paperdeck';
}
function fmtN(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

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
    if (!j || !Array.isArray(j.items) || !j.media) {
      st.textContent = 'paperdeck 데이터 형식이 아닙니다. (items / media 필드가 필요합니다)'; return;
    }
    st.textContent = '저장 중…';
    idbSet(DSK, j).then(function () { setData(j); loadProg(); home(); })
      .catch(function (e) { st.textContent = '저장 실패: ' + e; });
  };
  fr.readAsText(f);
}

/* 배포본에 데이터가 동봉돼 있으면 자동으로 받아 쓴다.
   (저장소에는 올리지 않고 Vercel CLI 배포에만 포함) */
var BUNDLED = 'data/ek.json';

function boot() {
  loadProg();
  idbGet(DSK).then(function (d) {
    if (d && d.items) { setData(d); home(); checkUpdate(d.v); return; }
    return tryBundled();
  }).catch(function () { return tryBundled(); });
}

/* 캐시된 데이터가 낡았는지 뒤에서 확인하고, 다르면 조용히 받아 교체한다.
   version.json 은 수십 바이트라 매번 받아도 부담이 없다. */
function checkUpdate(have) {
  fetch('data/version.json', { cache: 'no-store' }).then(function (r) {
    return r.ok ? r.json() : null;
  }).then(function (m) {
    if (!m || !m.v || m.v === have) return;
    return fetch(BUNDLED, { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !Array.isArray(j.items)) return;
        return idbSet(DSK, j).then(function () {
          setData(j);
          if ($('#scr-home').classList.contains('on')) home();
        });
      });
  }).catch(function () {});
}

function tryBundled() {
  var st = $('#lstat');
  show('load');
  st.textContent = '문제를 받는 중…';
  return fetch(BUNDLED, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw 0;
    return r.json();
  }).then(function (j) {
    if (!j || !Array.isArray(j.items)) throw 0;
    st.textContent = '준비하는 중…';
    setData(j);
    return idbSet(DSK, j).catch(function () {}).then(function () {
      home();
      checkUpdate(j.v);
    });
  }).catch(function () {
    st.textContent = '';
    $('#drop').style.display = '';
    $('#lhint').style.display = '';
    show('load');
  });
}

$('#file').addEventListener('change', function () { acceptFile(this.files[0]); });
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
$('#swap').onclick = function () {
  if (!confirm('다른 문제집 데이터로 바꿉니다. 진도 기록은 남아 있습니다.')) return;
  idbDel(DSK).then(function () { DATA = null; IT = []; MED = {}; $('#lstat').textContent = ''; show('load'); });
};

/* 탭을 닫거나 백그라운드로 보낼 때 안전망 */
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') save();
});
window.addEventListener('pagehide', save);

boot();
