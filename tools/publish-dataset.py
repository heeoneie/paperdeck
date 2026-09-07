#!/usr/bin/env python3
"""appdata.json -> public/data/{ek.json, version.json} + datasets/ 사본

version.json 은 앱이 캐시 갱신 여부를 판단하는 데 씁니다.
데이터를 바꿀 때마다 이 스크립트를 돌려야 이미 열어본 사람도 새 데이터를 받습니다.

사용:  python tools/publish-dataset.py <appdata.json> [제목] [부제]
"""
import json, hashlib, os, sys, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    title = sys.argv[2] if len(sys.argv) > 2 else '문제집'
    subtitle = sys.argv[3] if len(sys.argv) > 3 else ''

    d = json.load(open(src, encoding='utf-8'))
    if not isinstance(d.get('items'), list) or 'media' not in d:
        sys.exit('items / media 필드가 있는 paperdeck 데이터가 아닙니다.')
    d['title'], d['subtitle'] = title, subtitle
    d.pop('v', None)

    body = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
    d['v'] = hashlib.sha256(body.encode()).hexdigest()[:16]
    body = json.dumps(d, ensure_ascii=False, separators=(',', ':'))

    os.makedirs(os.path.join(ROOT, 'public', 'data'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'datasets'), exist_ok=True)
    ek = os.path.join(ROOT, 'public', 'data', 'ek.json')
    open(ek, 'w', encoding='utf-8').write(body)
    json.dump({'v': d['v'], 'n': len(d['items']), 'title': title},
              open(os.path.join(ROOT, 'public', 'data', 'version.json'), 'w', encoding='utf-8'),
              ensure_ascii=False)
    shutil.copy(ek, os.path.join(ROOT, 'datasets', title.replace(' ', '-') + '.json'))

    print('version %s · 문제 %d · %.2f MB' % (d['v'], len(d['items']), len(body.encode()) / 1e6))
    print('다음: vercel deploy --prod --yes')

if __name__ == '__main__':
    main()
