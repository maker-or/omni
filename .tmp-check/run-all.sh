#!/bin/zsh
set +e
cd /Users/harshithpasupuleti/code/omni || exit 1
OUTDIR=/Users/harshithpasupuleti/code/omni/.tmp-check

echo "=== FMT START ===" > "$OUTDIR/all.log"
bun run fmt >> "$OUTDIR/all.log" 2>&1
echo "FMT_EXIT:$?" >> "$OUTDIR/all.log"

echo "=== LINT START ===" >> "$OUTDIR/all.log"
bun run lint >> "$OUTDIR/all.log" 2>&1
echo "LINT_EXIT:$?" >> "$OUTDIR/all.log"

echo "=== TEST START ===" >> "$OUTDIR/all.log"
bun run test -- src/lib/tab-shortcuts.test.ts >> "$OUTDIR/all.log" 2>&1
echo "TEST_EXIT:$?" >> "$OUTDIR/all.log"

echo DONE >> "$OUTDIR/all.log"
