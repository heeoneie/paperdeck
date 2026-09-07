#!/usr/bin/env python3
"""index.html 의 app.js / app.css 링크에 내용 해시를 붙인다.

index.html 은 항상 재검증되므로, 코드가 바뀌면 링크 URL 자체가 바뀌어
브라우저가 옛 코드를 계속 쓰는 일이 생기지 않는다. 배포 전에 실행할 것.
"""
import hashlib, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'public')

def h(name):
    return hashlib.sha256(open(os.path.join(PUB, name), 'rb').read()).hexdigest()[:10]

def main():
    idx = os.path.join(PUB, 'index.html')
    s = open(idx, encoding='utf-8').read()
    for name, pat in (('app.css', r'href="app\.css(?:\?v=[0-9a-f]+)?"'),
                      ('app.js',  r'src="app\.js(?:\?v=[0-9a-f]+)?"')):
        v = h(name)
        attr = 'href' if name.endswith('.css') else 'src'
        s = re.sub(pat, '%s="%s?v=%s"' % (attr, name, v), s)
        print('  %-8s v=%s' % (name, v))
    open(idx, 'w', encoding='utf-8').write(s)

if __name__ == '__main__':
    main()
