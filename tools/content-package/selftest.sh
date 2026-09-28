#!/usr/bin/env bash
#
# ADR-021 Content Package v0.2 — selftest (CI + local).
#
#   bash tools/content-package/selftest.sh
#
# Chain:
#   1. compile   the full committed corpus → dist/content-package
#   2. verify    the package (independent re-derivation, all V-gates incl. V9 KG)
#   3. restore   clean-environment reconstruction + semantic equivalence (R-gates)
#   4. determinism  compile twice → content.sqlite must be byte-identical
#                  and buildId stable (measured claim, CONTENT_PACKAGE_V0_1 §8)
#   5. tamper    flip one byte in a copied artifact → verify MUST fail
#                (the fail-closed proof — a green verify on a tampered
#                package would make every other green meaningless)
#   6. distribution  the v0.2 forward gate (CONTENT_PACKAGE_V0_2.md): scoped
#                pilot compile (--courses=igcse-chemistry-19 — the only
#                KG-bearing course, the concrete bounded package §6 wanted)
#                → verify → bundle to a deterministic zip → extract →
#                verify the extracted package (full V-gates on the unpacked
#                tree) → restore from the extracted package
#   7. zip layer  determinism (bundle the SAME package dir twice →
#                byte-identical zips) + zip tamper (corrupt one byte →
#                extraction MUST fail closed on CRC)
set -euo pipefail
cd "$(dirname "$0")/../.."

PKG=dist/content-package
SCOPED=dist/content-package-scoped
BUNDLE_OUT=dist/bundles
EXTRACT=dist/bundle-extract
KEEP="${KEEP_SELFTEST:-0}"

echo "═══ 1/7 compile (full corpus) ═══"
bun tools/content-package/compile.ts

echo "═══ 2/7 verify ═══"
bun tools/content-package/verify.ts

echo "═══ 3/7 restore (clean-environment reconstruction) ═══"
bun tools/content-package/restore.ts

echo "═══ 4/7 determinism ═══"
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

echo "═══ 5/7 tamper detection (fail-closed proof) ═══"
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

echo "═══ 6/7 distribution (scoped pilot package → zip → extract → verify) ═══"
# the pilot is the only KG-bearing course — the concrete bounded package the
# v0.1 spec §6 said would justify KG tables
rm -rf "$SCOPED"
bun tools/content-package/compile.ts --courses=igcse-chemistry-19 --out="$SCOPED"
bun tools/content-package/verify.ts "$SCOPED"
rm -rf "$BUNDLE_OUT" "$EXTRACT"
ZIP=$(bun tools/content-package/bundle.ts "$SCOPED" --out="$BUNDLE_OUT" | grep '^bundle: ' | grep -o '[^ ]*\.zip$' | head -1)
if [ -z "$ZIP" ] || [ ! -f "$ZIP" ]; then
  echo "DISTRIBUTION FAIL: bundle did not produce a zip"
  exit 1
fi
echo "bundle produced: $ZIP"
PKG_DIR_NAME=$(basename "$ZIP" .zip)
bun tools/content-package/bundle.ts --extract "$ZIP" "$EXTRACT"
# the extract carries the package under its top-level dir
bun tools/content-package/verify.ts "$EXTRACT/$PKG_DIR_NAME"
# and the extracted package restores (clean-env reconstruction from the zip)
bun tools/content-package/restore.ts "$EXTRACT/$PKG_DIR_NAME" dist/restore-from-zip

echo "═══ 7/7 zip layer: determinism + tamper ═══"
ZIP_HASH_1=$(sha256sum "$ZIP" | cut -d' ' -f1)
ZIP2=$(bun tools/content-package/bundle.ts "$SCOPED" --out="$BUNDLE_OUT" | grep '^bundle: ' | grep -o '[^ ]*\.zip$' | head -1)
ZIP_HASH_2=$(sha256sum "$ZIP2" | cut -d' ' -f1)
if [ "$ZIP_HASH_1" != "$ZIP_HASH_2" ]; then
  echo "ZIP DETERMINISM FAIL: same package dir bundled twice differs ($ZIP_HASH_1 vs $ZIP_HASH_2)"
  exit 1
fi
echo "zip determinism ok: same package dir → byte-identical zip ($ZIP_HASH_1)"
# zip tamper: flip one byte mid-archive → extraction must fail closed (CRC)
BADZIP=dist/bundles/tampered.zip
python3 - "$ZIP" "$BADZIP" << 'EOF'
import sys
src, dst = sys.argv[1], sys.argv[2]
b = bytearray(open(src, "rb").read())
b[len(b) // 2] ^= 0x01  # flip one bit in the archive body
open(dst, "wb").write(bytes(b))
EOF
if bun tools/content-package/bundle.ts --extract "$BADZIP" dist/bundle-tamper-extract > /dev/null 2>&1; then
  echo "ZIP TAMPER FAIL: extraction PASSED on a corrupted zip — the CRC gate is broken"
  rm -rf "$BADZIP" dist/bundle-tamper-extract
  exit 1
fi
echo "zip tamper ok: corrupted zip fails extraction (CRC/structure, exit nonzero)"
rm -rf "$BADZIP" dist/bundle-tamper-extract

if [ "$KEEP" != "1" ]; then
  rm -rf dist/restore-test dist/restore-from-zip
fi
echo ""
echo "SELFTEST PASSED — package compiles, verifies, restores, is deterministic, fails closed on tampering; the v0.2 distribution gate holds (scoped package → deterministic zip → CRC-verified extract → verify + restore)"
