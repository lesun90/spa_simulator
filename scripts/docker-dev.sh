#!/bin/sh
set -eu

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci
fi

exec npm run dev -- --host 0.0.0.0
