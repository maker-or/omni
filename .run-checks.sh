#!/usr/bin/env bash
# Local helper: run the same gates as .github/workflows/ci.yml
set -euo pipefail
cd "$(dirname "$0")"

echo "=== bun install ==="
bun install --frozen-lockfile

echo "=== fmt:check ==="
bun run fmt:check

echo "=== lint ==="
bun run lint

echo "=== test ==="
bun run test

echo "=== all checks passed ==="
