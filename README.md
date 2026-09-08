# paperdeck

문제집을 카드로 바꿔 **풀고 · 채점하고 · 정답을 확인하는** 학습 도구.
설치 없이 브라우저에서 돌아가고, 폰에서 쓰도록 만들었습니다.

## 이 저장소에 문제는 들어 있지 않습니다

문제집 내용은 저작물이므로 저장소에도 배포본에도 포함하지 않습니다
(`datasets/*.json` 은 `.gitignore` 처리).
배포된 사이트를 처음 열면 **데이터 파일을 불러오는 화면**이 나옵니다.
한 번 불러오면 IndexedDB 에 저장되어 다음부터 바로 열립니다.
데이터도 진도도 브라우저 안에만 있고 서버로 전송되지 않습니다.

## 데이터 형식

```jsonc
{
  "title": "전기기사 실기 단답형",
  "subtitle": "2001~2026년 기출",
  "years":  [{ "y": "26", "n": 10 }],          // 연도별 문제 수
  "media":  { "ek_ab12….png": "<base64 PNG>" },
  "items": [{
    "t": "차단기 약호",                          // 제목
    "h": "<div class=\"title\">…<span class=\"bk\" data-b=\"0\"></span>…",  // 빈칸이 뚫린 본문
    "b": [{ "k": 0, "g": 1, "a": "ABB", "t": "txt", "s": 0 }],  // 빈칸: 번호·그룹·정답·종류·나열형여부
    "y": ["26"], "r": ["2026년 2회"], "p": 2, "n": 5
  }]
}
```

`b[].t` 가 `img` 면 자동 채점이 불가능한 그림 정답이라 자기채점으로 넘어갑니다.

## 채점 규칙 (`public/app.js` 의 `norm` / `judge` / `judgeSet`)

비교 전에 무시하는 것: 띄어쓰기, 대소문자, 전각/반각(NFKC), 가운뎃점(ㆍ·•)과 쉼표,
괄호류, 하이픈·물결표 변형, 천단위 콤마(`13,200` → `13200`), 끝 마침표.

| 판정 | 조건 | 화면 |
|---|---|---|
| 정답 | 정규화 후 일치, 또는 편집거리 유사도 ≥ 0.90 | 초록 ✓ |
| 애매 | 유사도 0.62 ~ 0.90 | 노랑 ? + 정답 + `맞게 처리` |
| 오답 | 유사도 < 0.62 또는 빈칸 | 빨강 ✕ + 정답 + `맞게 처리` |

- 같은 그룹의 나열형 정답(`s: 1`)은 **순서 무관**으로 매칭합니다.
- **자동 채점은 완전하지 않습니다.** 서술형 정답은 표현이 갈려 애매로 빠지는 일이 잦으므로
  `맞게 처리` 버튼이 항상 함께 나옵니다.

## 데이터 만들기

`tools/extract-ek/` 에 전기기사 서브노트 PDF → 데이터 변환기가 있습니다.

```bash
pip install pymupdf genanki scipy Pillow numpy
python s2_clean.py      # 워터마크 제거
python s5_parse.py      # 전 페이지 파싱 → blocks.pkl
python s12_appdata.py   # → appdata.json
```

> **이 변환기는 특정 책 전용입니다.** 좌우 2단(왼쪽 정답판 / 오른쪽 빈칸판), 베이지 정답 표시,
> `◇ㆍ∎` 마커, `과년도 [YY-N]` 태그, 한컴 수식 사용자정의 글리프 등 9가지 조판 가정에
> 의존합니다. 다른 문제집에는 동작하지 않습니다.
> 임의의 PDF를 받으려면 LLM 기반 추출 등 별도 구조가 필요합니다.

## 배포

**https://paperdeck-app.vercel.app**

정적 사이트라 빌드가 없습니다.

```bash
python tools/publish-dataset.py appdata.json "전기기사 실기 단답형" "2001~2026년 기출"
python tools/stamp-assets.py     # 코드를 고쳤다면
vercel deploy --prod --yes
```

`stamp-assets.py` 는 `index.html` 의 `app.js` / `app.css` 링크에 내용 해시를 붙입니다
(`app.js?v=52e622c5a1`). `index.html` 은 항상 재검증되므로 코드가 바뀌면 링크가 바뀌어
**브라우저가 옛 코드를 계속 실행하는 일이 생기지 않습니다.**

`publish-dataset.py` 는 `public/data/ek.json` 과 함께 **`version.json`** 을 만듭니다.
앱은 시작할 때 캐시된 데이터를 바로 쓰고, 뒤에서 `version.json` 을 확인해
버전이 다르면 조용히 새 데이터를 받아 교체합니다. 이 파일을 갱신하지 않으면
이미 앱을 열어본 사람은 **예전 데이터를 계속 보게 됩니다.**

### 주소 관련 함정

무료(Hobby) 플랜은 Vercel Authentication + Standard Protection 이 적용되어
**프로젝트 도메인만 공개**되고, 배포별 URL(`*-<해시>-*.vercel.app`)과
`vercel alias set` 으로 만든 alias 는 Vercel 로그인 화면으로 리다이렉트됩니다.

깔끔한 주소를 원하면 **alias 가 아니라 프로젝트 도메인으로 추가**해야 합니다.

```bash
vercel domains add paperdeck-app.vercel.app paperdeck-app   # 공개됨
vercel alias  set  <deployment> paperdeck-app.vercel.app    # 로그인 벽에 막힘
```

프로젝트 이름을 바꿔도(`vercel project rename`) 처음 배정된 도메인은 그대로입니다.

- `paperdeck.vercel.app` 은 **다른 사람의 서비스**입니다 (`/d/default` 로 리다이렉트).
- `paperdeck-kohl.vercel.app` 은 최초 자동 배정 도메인으로 아직 살아 있습니다.

## 랜덤 문제

홈의 **랜덤 문제**를 누르면 연도 범위(시작~끝)와 문항 수(10/20/30/50/전체),
`안 푼 문제만` 을 고를 수 있습니다. 고른 값은 `localStorage['pd_rnd']` 에 남아
다음에도 그대로 뜹니다. 후보보다 문항 수가 크면 후보 수만큼만 출제합니다.

## 진도 저장

문제를 **채점하는 즉시** `localStorage['pd_prog']` 에 기록됩니다.
'다음 문제' 를 누르지 않고 앱을 닫아도 남고, '맞게 처리' 로 정정하면 갱신됩니다.

```jsonc
{ "차단기 약호|2026년 2회|2": { "n": 1, "ok": 1, "rate": 100, "last": 1788763790391 } }
//  문제 키(제목|회차|페이지)      시도  전부맞음  정답률   마지막 시각
```

입력한 답 자체와 세션 중간 위치는 저장하지 않습니다.

## 알려진 한계

- 진도가 기기 사이에서 이어지지 않습니다 (localStorage / IndexedDB).
- 서술형·그림 문제는 자동 채점이 안 됩니다.
- 임의의 문제집 PDF 입력은 아직 지원하지 않습니다.

## 데이터를 배포에만 넣기

`public/data/ek.json` 은 `.gitignore` 대상이라 GitHub 에는 올라가지 않지만,
**Vercel CLI 배포에는 포함됩니다.** Vercel CLI 는 `.gitignore` 가 아니라
`.vercelignore` 만 보고 나머지 파일을 전부 업로드하기 때문입니다.

```bash
cp datasets/<이름>.json public/data/ek.json
vercel --prod            # 로컬 파일이 그대로 올라감
```

앱은 시작할 때 `data/ek.json` 을 먼저 찾고, 없으면 파일 불러오기 화면을 띄웁니다.

> **주의** — GitHub 연동(자동 배포)을 켜면 push 마다 저장소 내용으로 다시 배포되어
> `public/data/` 가 사라집니다. 데이터를 배포에 포함하려면 **CLI 배포만** 쓰세요.
>
> 배포 URL 은 링크를 아는 누구나 접근할 수 있습니다. `robots.txt` 와 `noindex` 로
> 검색 노출만 막아둔 상태이며, 접근 제한은 아닙니다.
