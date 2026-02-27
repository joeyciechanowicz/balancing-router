#!/usr/bin/env bash
set -euo pipefail

ROUTES_MODULE="./bench/routes-generic.mjs"
if [[ "${1:-}" != "" && "${1:-}" != -* ]]; then
  ROUTES_MODULE="$1"
  shift
fi

echo "[bench] generating static urls for ${ROUTES_MODULE}"
BENCH_STATIC_ROUTES_MODULE="${ROUTES_MODULE}" \
  node scripts/bench/generate-static-urls.mjs

URLS_MODULE="$(node -e "const p=process.argv[1];const path=require('node:path');const r=path.resolve(process.cwd(),p);console.log(path.join(path.dirname(r),path.basename(r,'.mjs')+'.urls.mjs'));" "${ROUTES_MODULE}")"

echo "[bench] running benchmark with routes=${ROUTES_MODULE}"
BENCH_ROUTES_MODULE="${ROUTES_MODULE}" \
BENCH_PRECOMPUTED_URLS_MODULE="${URLS_MODULE}" \
npm run bench -- "$@"
