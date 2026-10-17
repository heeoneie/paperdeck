#!/usr/bin/env python3
"""시험 세트(corpus/)의 공식 정답표 PDF -> 답안지 corpus/expected/<이름>.json

변환기와 상관없이, 정답표 형식마다 따로 읽는다(변환기의 정답표 읽기를 채점하려는 것이라
같은 코드를 쓰면 안 된다). 한 번 만들고 사람이 정답표와 대조해 확인한 뒤 커밋한다.

답안지 모양
  { "pdf": "suneung2026-kor.pdf", "key": "suneung2026-kor-key.pdf", "round": "2026년 수능",
    "sections": [ { "name": "공통", "items": [[1, [2]], [2, [4]], …] }, … ] }
  items 는 문제지에 실린 순서. 답은 객관식이면 보기 번호(0부터) 목록, 단답형이면 문자열.

  python tools/corpus-keys.py          # 전부 다시 만든다
"""
import json, os, re, sys

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORPUS = os.path.join(ROOT, 'corpus')
CIRC = '①②③④⑤⑥⑦⑧⑨⑩'


def rows_of(page):
    """낱말을 줄(같은 높이)로 묶는다"""
    words = sorted(page.get_text('words'), key=lambda w: (round(w[1] / 4), w[0]))
    rows, cur, y = [], [], None
    for w in words:
        if y is None or abs(w[1] - y) > 4:
            if cur:
                rows.append(sorted(cur, key=lambda w: w[0]))
            cur, y = [], w[1]
        cur.append(w)
    if cur:
        rows.append(sorted(cur, key=lambda w: w[0]))
    return [[w[4] for w in r] for r in rows]


def ans(tok):
    if tok and all(c in CIRC for c in tok):
        return [CIRC.index(c) for c in tok]
    if re.fullmatch(r'\d+', tok):
        return tok          # 단답형
    raise ValueError('정답이 아님: %r' % tok)


def suneung_key(path, names):
    """수능 정답표: 한 줄에 (번호 정답 배점) 묶음이 열마다 하나씩. 홀수형 쪽만 쓴다.
    열은 왼쪽부터 이어 붙이고, 번호가 이어지지 않는 열은 새 구역(선택 과목)으로 본다."""
    doc = pymupdf.open(path)
    page = next((p for p in doc if '홀수' in p.get_text()), doc[0])   # 탐구는 과목마다 한 쪽
    cols = {}
    for r in rows_of(page):
        if not r or not all(re.fullmatch(r'\d+|[①-⑩]+', t) for t in r) or len(r) % 3:
            continue
        for c in range(len(r) // 3):
            no, a, _score = r[c * 3:c * 3 + 3]
            cols.setdefault(c, []).append([int(no), ans(a)])
    # 같은 번호로 시작하는 열이 또 있으면 선택 과목 — 각자 구역. 나머지는 이어지면 붙인다.
    firsts = [cols[c][0][0] for c in cols]
    secs = []
    for c in sorted(cols):
        items = cols[c]
        if secs and secs[-1][-1][0] + 1 == items[0][0] and firsts.count(items[0][0]) == 1:
            secs[-1] += items
        else:
            secs.append(list(items))
    assert len(secs) == len(names), (path, [s[0][0] for s in secs], names)
    return [{'name': n, 'items': s} for n, s in zip(names, secs)]


def by_hand(name, answers):
    """글자 정보가 없는 정답표(글자를 그림처럼 그린 PDF) — 사람이 보고 옮긴 것"""
    return lambda k: [{'name': name, 'items': [[i + 1, [CIRC.index(c)]] for i, c in enumerate(answers)]}]


def gosi_key(path, subject, form='가'):
    """국가직 정답표: 과목마다 한 줄 (연번 과목명 책형 1번…20번)"""
    doc = pymupdf.open(path)
    for p in doc:
        for r in rows_of(p):
            if len(r) >= 23 and r[1] == subject and r[2] == form:
                return [{'name': subject, 'items': [[i + 1, [int(c) - 1 for c in re.findall(r'\d', t)]]
                                                     for i, t in enumerate(r[3:23])]}]
    raise SystemExit('%s 에서 %s(%s) 줄을 못 찾음' % (path, subject, form))


def ged_key(path, subject):
    """검정고시 정답표: 과목마다 한 쪽, (번호 정답) 짝이 열마다"""
    doc = pymupdf.open(path)
    page = next(p for p in doc if re.search(subject + r'\s*정답표', p.get_text()))
    items = {}
    for r in rows_of(page):
        if r and all(re.fullmatch(r'\d+|[①-⑩]+', t) for t in r) and len(r) % 2 == 0:
            for c in range(0, len(r), 2):
                items[int(r[c])] = ans(r[c + 1])
    return [{'name': subject, 'items': [[n, items[n]] for n in sorted(items)]}]


SETS = [
    # 이름, 문제지, 정답표, 회차, 정답 읽기
    ('suneung2026-kor', '2026년 수능', lambda k: suneung_key(k, ['공통', '화법과 작문', '언어와 매체'])),
    ('suneung2026-math', '2026년 수능', lambda k: suneung_key(k, ['공통', '확률과 통계', '미적분', '기하'])),
    ('suneung2026-eng', '2026년 수능', lambda k: suneung_key(k, ['영어'])),
    ('suneung2026-hist', '2026년 수능', lambda k: suneung_key(k, ['한국사'])),
    # 정답표에 글자가 없어 그림을 보고 옮겼다(2026-10-17)
    ('suneung2025-hist', '2025년 수능', by_hand('한국사', '⑤①③③①④⑤②⑤③⑤④①③②②④③②①')),
    ('suneung2026-ethics', '2026년 수능', lambda k: suneung_key(k, ['생활과 윤리'])),
    ('suneung2026-geo', '2026년 수능', lambda k: suneung_key(k, ['한국지리'])),
    ('gosi2026-9-kor', '2026년 국가직 9급', lambda k: gosi_key(k, '국어')),
    ('gosi2026-9-hist', '2026년 국가직 9급', lambda k: gosi_key(k, '한국사')),
    ('ged2026-2-kor', '2026년 2회 고졸 검정고시', lambda k: ged_key(k, '국어')),
    ('ged2026-2-math', '2026년 2회 고졸 검정고시', lambda k: ged_key(k, '수학')),
    ('ged2026-2-soc', '2026년 2회 고졸 검정고시', lambda k: ged_key(k, '사회')),
]
KEYFILE = {'gosi2026-9-kor': 'gosi2026-9-key.pdf', 'gosi2026-9-hist': 'gosi2026-9-key.pdf',
           'ged2026-2-kor': 'ged2026-2-key.pdf', 'ged2026-2-math': 'ged2026-2-key.pdf',
           'ged2026-2-soc': 'ged2026-2-key.pdf'}
# 변환할 때 사용자가 앱에 넣을 값 — 정답표에 과목이 여럿이면 과목명을 적는다
KEYMATCH = {'gosi2026-9-kor': '국어', 'gosi2026-9-hist': '한국사',
            'ged2026-2-kor': '국어', 'ged2026-2-math': '수학', 'ged2026-2-soc': '사회'}


def main():
    out = os.path.join(CORPUS, 'expected')
    os.makedirs(out, exist_ok=True)
    for name, rnd, read in SETS:
        key = KEYFILE.get(name, name + '-key.pdf')
        if not os.path.exists(os.path.join(CORPUS, name + '.pdf')):
            print('  - %s: 문제지 PDF 없음, 건너뜀' % name); continue
        secs = read(os.path.join(CORPUS, key))
        for s in secs:
            nos = [n for n, _ in s['items']]
            assert nos == list(range(nos[0], nos[0] + len(nos))), (name, s['name'], nos)
        exp = {'pdf': name + '.pdf', 'key': key, 'round': rnd, 'sections': secs}
        if name in KEYMATCH:
            exp['keyMatch'] = KEYMATCH[name]
        json.dump(exp, open(os.path.join(out, name + '.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        print('  %-20s %s' % (name, ' · '.join('%s %d~%d' % (s['name'], s['items'][0][0], s['items'][-1][0])
                                               for s in secs)))


if __name__ == '__main__':
    main()
