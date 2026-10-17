# 시험 세트

PDF 변환기(`public/pdfdeck.js`)를 채점하는 공개 기출 모음. **PDF 는 저작권 때문에 저장소에 없다**
(`*.pdf` 는 `.gitignore`). 아래에서 받아 이 폴더에 같은 이름으로 둔다. 저장소에는 답안지(`expected/`)만 있다.

```sh
cd tools/score && npm i        # 처음 한 번 — 이 컴퓨터의 Chrome 을 씀
node score.mjs                 # 전부 채점
node score.mjs kor             # 이름에 kor 가 들어간 것만
```

답안지는 `tools/corpus-keys.py` 가 공식 정답표에서 만든다(사람이 정답표와 대조해 확인한 뒤 커밋).

| 파일 | 시험지 | 볼 것 | 받는 곳 |
|---|---|---|---|
| `suneung2026-kor(-key).pdf` | 2026학년도 수능 국어 | 2단, 공통 지문, 선택과목(화작·언매), 홀수형+짝수형 한 파일 | 수능 홈페이지 기출문제 (suneung.re.kr, boardID 1500234) |
| `suneung2026-math(-key).pdf` | 수학 | 수식 보기, 단답형, 선택과목 3개 | 〃 |
| `suneung2026-eng(-key).pdf` | 영어 | 듣기 문항 | 〃 |
| `suneung2026-hist(-key).pdf` | 한국사 | 그림·자료 | 〃 |
| `suneung2026-ethics(-key).pdf` | 사회탐구 생활과 윤리 | 사탐 압축파일 01번 | 〃 |
| `suneung2026-geo(-key).pdf` | 사회탐구 한국지리 | 지도, 사탐 압축파일 03번 | 〃 |
| `suneung2025-hist(-key).pdf` | 2025학년도 한국사(홀수형) | **정답표에 글자가 없음**(그림) | 〃 |
| `gosi2026-9-kor.pdf` · `gosi2026-9-hist.pdf` · `gosi2026-9-key.pdf` | 2026 국가직 9급 국어·한국사(가책형) | 4지선다, 정답표가 과목별 한 줄 | 국가공무원 채용시스템 → 시험문제/정답 → 선택형 문제/정답 (gongmuwon.gosi.kr) |
| `ged2026-2-kor.pdf` · `-math` · `-soc` · `ged2026-2-key.pdf` | 2026년 2회 고졸 검정고시 | 쉬운 2단, 정답표가 과목별 한 쪽 | 평가원 → 초졸·중졸·고졸 검정고시 (kice.re.kr, boardID 1500211) |

운전면허 학과시험 문제은행(1단, 정답이 문제 아래)은 도로교통공단 사이트가 자동 접속을 막아 아직 없다.
