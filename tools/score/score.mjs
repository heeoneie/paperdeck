/* 시험 세트 채점 — 앱의 PDF 변환기(public/pdfdeck.js)를 실제 브라우저에서 돌려
   corpus/expected/*.json 답안지와 비교한다.

     cd tools/score && npm i      # 처음 한 번 (playwright-core, 이 컴퓨터의 Chrome 을 씀)
     node score.mjs               # 전부
     node score.mjs kor hist      # 이름에 이 글자가 들어간 것만
     node score.mjs --json        # 결과를 corpus/results/<시각>.json 에도 남김

   점수
     찾음  답안지의 문제 중 변환기가 만든 문제(번호가 순서대로 맞는 것)
     정답  찾은 문제 중 정답까지 맞는 것
     엉뚱  답안지에 없는(또는 순서가 어긋난) 문제
   PDF 는 저작권 때문에 저장소에 없다 — corpus/ 에 직접 받아 둔다(corpus/README.md). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CORPUS = path.join(ROOT, 'corpus');
const args = process.argv.slice(2);
const saveJson = args.includes('--json');
const filters = args.filter(a => !a.startsWith('--'));

/* ---------- 답안지 ---------- */
const sets = fs.readdirSync(path.join(CORPUS, 'expected'))
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(CORPUS, 'expected', f), 'utf8')))
  .filter(e => !filters.length || filters.some(q => e.pdf.includes(q)))
  .filter(e => {
    const ok = fs.existsSync(path.join(CORPUS, e.pdf)) && fs.existsSync(path.join(CORPUS, e.key));
    if (!ok) console.log(`  - ${e.pdf}: PDF 없음, 건너뜀`);
    return ok;
  });
if (!sets.length) { console.log('채점할 시험지가 없습니다.'); process.exit(1); }

/* ---------- 정적 서버: public/ 과 corpus/ ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.pdf': 'application/pdf', '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u === '/public/__score.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><meta charset="utf-8"><title>score</title>');
  }
  const top = u.split('/')[1];
  const f = path.join(ROOT, path.normalize(u));
  if (!['public', 'corpus'].includes(top) || !f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ---------- 브라우저에서 변환 ---------- */
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(base + '/public/__score.html');

async function convert(e) {
  return page.evaluate(async ({ e }) => {
    const m = await import('/public/pdfdeck.js');
    const file = async (n) => {
      const b = await (await fetch('/corpus/' + encodeURIComponent(n))).blob();
      return new File([b], n, { type: 'application/pdf' });
    };
    const t = performance.now();
    try {
      const r = await m.convert(await file(e.pdf), { key: await file(e.key), keyMatch: e.keyMatch, round: e.round });
      return {
        ms: Math.round(performance.now() - t),
        items: r.deck.items.map(it => ({ no: it.no, a: it.a, n: (it.o || []).length })),
        report: { found: r.report.found, skipped: r.report.skipped, warn: r.report.warn }
      };
    } catch (err) {
      return { ms: Math.round(performance.now() - t), error: String(err && err.message || err), items: [] };
    }
  }, { e });
}

/* ---------- 채점 ---------- */
const same = (x, y) => Array.isArray(x) && Array.isArray(y) && x.length === y.length &&
  x.slice().sort().every((v, i) => v === y.slice().sort()[i]);

/* 변환 결과를 순서대로 따라가며 답안지의 같은 번호(앞으로 몇 칸 안)에 짝짓는다 */
function score(e, out) {
  const exp = [];
  e.sections.forEach(s => s.items.forEach(([no, a]) => exp.push({ sec: s.name, no, a })));
  const WIN = 12;
  let j = 0, found = 0, right = 0, extra = 0;
  const wrong = [], hit = new Set();
  for (const it of out.items) {
    let k = -1;
    for (let q = j; q < Math.min(exp.length, j + WIN); q++) if (exp[q].no === it.no) { k = q; break; }
    if (k < 0) { extra++; continue; }
    found++; hit.add(k); j = k + 1;
    if (same(exp[k].a, it.a)) right++;
    else wrong.push(it.no);
  }
  const missing = exp.filter((_, i) => !hit.has(i));
  return { n: exp.length, found, right, extra, wrong, missing, short: exp.filter(x => typeof x.a === 'string').length };
}

const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '-';
const pad = (s, n) => { s = String(s); const w = [...s].reduce((t, c) => t + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0); return s + ' '.repeat(Math.max(0, n - w)); };
const ranges = (ns) => {
  const out = []; let a = null, b = null;
  for (const n of ns) { if (a !== null && n === b + 1) b = n; else { if (a !== null) out.push(a === b ? a : a + '-' + b); a = b = n; } }
  if (a !== null) out.push(a === b ? a : a + '-' + b);
  return out.join(',');
};

console.log(pad('시험지', 22) + pad('찾음', 12) + pad('정답', 12) + pad('엉뚱', 6) + '시간');
const all = { n: 0, found: 0, right: 0, extra: 0 }, results = [];
for (const e of sets) {
  const out = await convert(e);
  const s = score(e, out);
  results.push({ pdf: e.pdf, ...s, missing: s.missing.map(x => x.sec + ' ' + x.no), ms: out.ms, error: out.error, report: out.report });
  for (const k in all) all[k] += s[k];
  console.log(pad(e.pdf.replace(/\.pdf$/, ''), 22) + pad(`${s.found}/${s.n} ${pct(s.found, s.n)}`, 12) +
              pad(`${s.right}/${s.found} ${pct(s.right, s.found)}`, 12) + pad(s.extra, 6) + (out.ms / 1000).toFixed(1) + 's');
  if (out.error) console.log('    ! 오류: ' + out.error);
  const bySec = {};
  s.missing.forEach(x => (bySec[x.sec] = bySec[x.sec] || []).push(x.no));
  const ms = Object.entries(bySec).map(([k, v]) => (e.sections.length > 1 ? k + ' ' : '') + ranges(v)).join(' · ');
  if (ms) console.log('    못 찾음: ' + ms + (s.short ? `  (단답형 ${s.short}개 포함)` : ''));
  if (s.wrong.length) console.log('    정답 틀림: ' + s.wrong.join(','));
  /* 변환기가 문제를 찾고도 버린 이유 */
  const why = {};
  ((out.report || {}).skipped || []).forEach(([no, w]) => (why[w] = why[w] || []).push(no));
  for (const [w, ns] of Object.entries(why)) console.log(`    버림(${w}): ${ranges(ns)}`);
  ((out.report || {}).warn || []).forEach(w => console.log('    경고: ' + w));
}
console.log('-'.repeat(60));
console.log(pad('전체', 22) + pad(`${all.found}/${all.n} ${pct(all.found, all.n)}`, 12) +
            pad(`${all.right}/${all.found} ${pct(all.right, all.found)}`, 12) + all.extra);

if (saveJson) {
  const dir = path.join(CORPUS, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(f, JSON.stringify({ total: all, results }, null, 1));
  console.log('-> ' + path.relative(ROOT, f));
}
await browser.close();
server.close();
