#!/usr/bin/env python3
"""문제집 JSON -> public/data/<id>.json + catalog.json(사이트에 들어 있는 문제집 목록)

앱은 catalog.json 의 v(버전)를 보고, 이미 받아 둔 문제집이 낡았으면 조용히 새로 받는다.
데이터를 바꿀 때마다 이 스크립트를 돌려야 이미 열어본 사람도 새 데이터를 받는다.

사용:
  python tools/publish-dataset.py <문제집.json> [제목] [부제] [--id ID]
  python tools/publish-dataset.py --remove ID            # 사이트 목록에서 빼기
  python tools/publish-dataset.py --list

  --id   문제집 id. 진도 기록이 이 id 에 묶이므로 한 번 정하면 바꾸지 말 것.
         전기기사 문제집은 ek (예전 배포와 진도가 이어지는 id).
  --site 데이터를 넣을 사이트 폴더 (기본: public)
"""
import argparse, hashlib, json, os, re, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def slug(s):
    s = re.sub(r'\s+', '-', s.strip())
    return re.sub(r'[^\w\-가-힣]', '', s)[:40] or 'deck'


def load_catalog(data):
    p = os.path.join(data, 'catalog.json')
    if os.path.exists(p):
        return json.load(open(p, encoding='utf-8'))
    cat = {'decks': []}
    # catalog.json 이전 배포: ek.json + version.json 하나
    v = os.path.join(data, 'version.json')
    if os.path.exists(v) and os.path.exists(os.path.join(data, 'ek.json')):
        m = json.load(open(v, encoding='utf-8'))
        cat['decks'].append({'id': 'ek', 'file': 'ek.json', 'v': m.get('v'),
                             'title': m.get('title'), 'n': m.get('n')})
    return cat


def save_catalog(data, cat):
    json.dump(cat, open(os.path.join(data, 'catalog.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src', nargs='?')
    ap.add_argument('title', nargs='?')
    ap.add_argument('subtitle', nargs='?')
    ap.add_argument('--id')
    ap.add_argument('--site', default=os.path.join(ROOT, 'public'))
    ap.add_argument('--remove')
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()

    data = os.path.join(a.site, 'data')
    os.makedirs(data, exist_ok=True)
    cat = load_catalog(data)

    if a.list:
        for d in cat['decks']:
            print('%-24s %-28s 문제 %-5s v=%s' % (d['id'], d.get('title'), d.get('n'), d.get('v')))
        return
    if a.remove:
        before = len(cat['decks'])
        cat['decks'] = [d for d in cat['decks'] if d['id'] != a.remove]
        if len(cat['decks']) == before:
            ap.exit(1, '목록에 %s 가 없습니다.\n' % a.remove)
        save_catalog(data, cat)
        print('목록에서 뺐습니다: %s (data/ 의 파일은 그대로)' % a.remove)
        return
    if not a.src:
        ap.exit(2, __doc__)

    d = json.load(open(a.src, encoding='utf-8'))
    if not isinstance(d.get('items'), list) or not d['items']:
        ap.exit(1, 'items 필드가 있는 paperdeck 데이터가 아닙니다.\n')
    if a.title:
        d['title'] = a.title
    if a.subtitle is not None:
        d['subtitle'] = a.subtitle
    d['title'] = d.get('title') or '문제집'
    d['id'] = a.id or d.get('id') or slug(d['title'])
    d.setdefault('media', {})
    d.pop('v', None); d.pop('local', None)

    body = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
    d['v'] = hashlib.sha256(body.encode()).hexdigest()[:16]
    body = json.dumps(d, ensure_ascii=False, separators=(',', ':'))

    fname = d['id'] + '.json'
    open(os.path.join(data, fname), 'w', encoding='utf-8').write(body)
    entry = {'id': d['id'], 'file': fname, 'v': d['v'], 'title': d['title'],
             'subtitle': d.get('subtitle', ''), 'n': len(d['items'])}
    cat['decks'] = [x for x in cat['decks'] if x['id'] != d['id']] + [entry]
    save_catalog(data, cat)
    # catalog.json 이전 앱(배포 직후 아직 새로 고치지 않은 탭)은 ek.json + version.json 을 본다.
    # 버전이 어긋나면 매번 다시 받으므로 ek 를 올릴 때 같이 맞춘다.
    if d['id'] == 'ek':
        json.dump({'v': d['v'], 'n': len(d['items']), 'title': d['title']},
                  open(os.path.join(data, 'version.json'), 'w', encoding='utf-8'), ensure_ascii=False)

    # 저장소 밖 보관용 사본 (datasets/ 는 .gitignore)
    if os.path.abspath(a.site) == os.path.join(ROOT, 'public'):
        os.makedirs(os.path.join(ROOT, 'datasets'), exist_ok=True)
        shutil.copy(os.path.join(data, fname), os.path.join(ROOT, 'datasets', d['title'].replace(' ', '-') + '.json'))

    print('%s · version %s · 문제 %d · %.2f MB' % (d['id'], d['v'], len(d['items']), len(body.encode()) / 1e6))
    print('사이트 문제집 %d개: %s' % (len(cat['decks']), ', '.join(x['id'] for x in cat['decks'])))
    print('다음: vercel deploy --prod --yes')


if __name__ == '__main__':
    main()
