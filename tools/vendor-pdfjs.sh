#!/bin/sh
# PDF.js 를 public/vendor/pdfjs 에 넣는다 (브라우저 안 PDF 변환용).
# CDN 대신 파일로 두는 이유: 앱으로 감싸 출시하거나 오프라인에서도 돌게.
# 사용: sh tools/vendor-pdfjs.sh [버전]   (기본: latest)
set -e
V=${1:-latest}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
cd "$TMP"
npm pack "pdfjs-dist@$V" >/dev/null 2>&1
tar xzf pdfjs-dist-*.tgz
OUT="$ROOT/public/vendor/pdfjs"
rm -rf "$OUT"; mkdir -p "$OUT"
# 오래된 사파리에서도 돌도록 legacy 빌드
cp package/legacy/build/pdf.min.mjs package/legacy/build/pdf.worker.min.mjs package/LICENSE "$OUT/"
cp -r package/cmaps package/standard_fonts package/wasm "$OUT/"
node -e "console.log(require('./package/package.json').version)" > "$OUT/VERSION"
rm -rf "$TMP"
echo "pdfjs-dist $(cat "$OUT/VERSION") -> $OUT ($(du -sh "$OUT" | cut -f1))"
