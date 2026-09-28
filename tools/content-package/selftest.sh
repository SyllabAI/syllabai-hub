#!/usr/bin/env bash
#
# ADR-021 Content Package v0.1 — selftest (CI + local).
#
#   bash tools/content-package/selftest.sh
#
# Chain:
#   1. compile   the full committed corpus → dist/content-package
#   2. verify    the package (independent re-derivation, all V-gates)
#   3. restore   clean-environment reconstruction + semantic equivalence (R-gates)
#   4. determinism  compile twice → content.sqlite must be byte-identical
#                  and buildId stable (measured claim, CONTENT_PACKAGE_V0_1 §8)
#   5. tamper    flip one byte in a copied artifact → verify MUST fail
#                (the fail-closed proof — a green verify on a tampered
#                package would make every other green meaningless)
set -euo pipefail
cd "$(dirname "$0")/../.."

PKG=dist/content-package
KEEP="${KEEP_SELFTEST:-0}"

echo "═══ 1/5 compile ═══"
bun tools/content-package/compile.ts

echo "═══ 2/5 verify ═══"
bun tools/content-package/verify.ts

echo "═══ 3/5 restore (clean-environment reconstruction) ═══"
bun tools/content-package/restore.ts

echo "═══ 4/5 determinism ═══"
SQLITE_HASH_1=$(sha256sum "$PKG/database/content.sqlite" | cut -d' ' -f1)
BUILD_ID_1=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$PKG/MANIFEST.json','utf8')).buildId)")
bun tools/content-package/compile.ts > /dev/null
SQLITE_HASH_2=$(sha256sum "$PKG/database/content.sqlite" | cut -d' ' -f1)
BUILD_ID_2=$(bun -e "console.log(JSON.parse(require('fs').readFileSync('$PKG/MANIFEST.json','utf8')).buildId)")
if [ "$SQLITE_HASH_1" != "$SQLITE_HASH_2" ]; then
  echo "DETERMINISM FAIL: content.sqlite differs between compiles ($SQLITE_HASH_1 vs $SQLITE_HASH_2)"
  exit 1
fi
if [ "$BUILD_ID_1" != "$BUILD_ID_2" ]; then
  echo "DETERMINISM FAIL: buildId differs between compiles"
  exit 1
fi
echo "determinism ok: content.sqlite byte-identical ($SQLITE_HASH_1), buildId stable (${BUILD_ID_1:0:16}…)"
# re-verify the second compile too (belt + braces)
bun tools/content-package/verify.ts > /dev/null
echo "second compile verifies clean"

echo "═══ 5/5 tamper detection (fail-closed proof) ═══"
TAMPER=dist/tamper-test
rm -rf "$TAMPER"
cp -r "$PKG" "$TAMPER"
# flip one byte in one note body artifact — package must no longer verify
ART=$(ls "$TAMPER/content/content" | head -1)/notes.json
python3 - "$TAMPER/content/content/$ART" << 'EOF'
import sys, json
p = sys.argv[1]
s = open(p).read()
open(p, "w").write(s.replace('"title"', '"titel"', 1))  # subtle corruption
EOF
if bun tools/content-package/verify.ts "$TAMPER" > /dev/null 2>&1; then
  echo "TAMPER FAIL: verify PASSED on a corrupted package — the gate is broken"
  rm -rf "$TAMPER"
  exit 1
fi
echo "tamper ok: corrupted artifact fails verification (exit nonzero)"
rm -rf "$TAMPER"

if [ "$KEEP" != "1" ]; then
  rm -rf dist/restore-test
fi
echo ""
echo "SELFTEST PASSED — package compiles, verifies, restores, is deterministic, and fails closed on tampering"
