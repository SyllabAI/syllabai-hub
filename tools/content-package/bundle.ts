/**
 * ADR-021 Content Package v0.2 — deterministic distribution bundle.
 *
 *   bun tools/content-package/bundle.ts [packageDir] [--out=<dir>]
 *   bun tools/content-package/bundle.ts --extract <zip> <outDir>
 *
 * Wraps a verified package directory into the §7 distribution form
 * (CONTENT_PACKAGE_V0_2.md):
 *
 *   syllabai-content-<scopeId>-<packageVersion>-<buildId12>.zip
 *
 * The zip layer is DETERMINISTIC BY CONSTRUCTION — no external zip binary:
 *   - entries sorted by path, fixed DOS timestamp (1980-01-01 00:00:00)
 *   - deflate at a fixed level; no extra fields, no comments, ASCII names
 *   - same package directory → byte-identical zip (proven in selftest)
 * Cross-COMPILE determinism is the package layer's contract (byte-identical
 * content.sqlite + stable buildId); MANIFEST.createdAt is wall-clock
 * informational, so zips of two independent compiles differ only in those
 * bytes — never in content identity. Two-layer determinism, stated exactly.
 *
 * The zip wraps the package under a single top-level directory named
 * syllabai-content-<scopeId>-<packageVersion>-<buildId12>/ (the §2 layout
 * of CONTENT_PACKAGE_V0_1.md). Extracting MUST round-trip: every entry
 * CRC-verified on read, and --extract fails closed on any corruption.
 *
 * Import boundary (§12): distributing or importing a bundle NEVER publishes
 * content to learners and never confers serving eligibility — the zip is a
 * derived snapshot; production serving stays governed by the existing
 * validation gates over PostgreSQL.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { repoRoot, sha256File } from "./lib";

// ── crc32 (self-contained; deterministic) ────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── walk files (sorted, deterministic order) ─────────────────────────────
function walkFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isDirectory()) out.push(...walkFiles(join(dir, e.name), `${base}${e.name}/`));
    else out.push(`${base}${e.name}`);
  }
  return out;
}

// Fixed zip metadata — the determinism pins
const DOS_TIME = 0x0000; // 00:00:00
const DOS_DATE = 0x0021; // 1980-01-01 (ZIP epoch minimum)
const DEFLATE_LEVEL = 9;

interface Entry {
  name: string;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

function buildZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const entries: Entry[] = [];
  let offset = 0;
  for (const f of files) {
    const compressed = deflateRawSync(f.data, { level: DEFLATE_LEVEL });
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lh.writeUInt16LE(20, 4); // version needed (2.0 — deflate)
    lh.writeUInt16LE(0, 6); // flags (ASCII names, no extras)
    lh.writeUInt16LE(8, 8); // method: deflate
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(Buffer.byteLength(f.name), 26);
    lh.writeUInt16LE(0, 28); // extra len
    const nameBuf = Buffer.from(f.name, "utf8");
    locals.push(lh, nameBuf, compressed);
    entries.push({ name: f.name, crc, csize: compressed.length, usize: f.data.length, offset });
    offset += lh.length + nameBuf.length + compressed.length;
  }
  const centrals: Buffer[] = [];
  let cdSize = 0;
  for (const e of entries) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // central directory signature
    ch.writeUInt16LE(20, 4); // version made by
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0, 8); // flags
    ch.writeUInt16LE(8, 10); // method
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(e.crc, 16);
    ch.writeUInt32LE(e.csize, 20);
    ch.writeUInt32LE(e.usize, 24);
    ch.writeUInt16LE(Buffer.byteLength(e.name), 28);
    ch.writeUInt16LE(0, 30); // extra
    ch.writeUInt16LE(0, 32); // comment
    ch.writeUInt16LE(0, 34); // disk start
    ch.writeUInt16LE(0, 36); // internal attrs
    ch.writeUInt32LE(0, 38); // external attrs
    ch.writeUInt32LE(e.offset, 42);
    const nameBuf = Buffer.from(e.name, "utf8");
    centrals.push(ch, nameBuf);
    cdSize += ch.length + nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with cd
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len
  return Buffer.concat([...locals, ...centrals, eocd]);
}

/** Parse a zip written by buildZip (and common zips): central-directory
 *  driven read with per-entry CRC verification. Fails closed. */
function readZip(zip: Buffer): { name: string; data: Buffer }[] {
  // locate EOCD
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end-of-central-directory not found (corrupt or not a zip)");
  const count = zip.readUInt16LE(eocd + 10);
  let ptr = zip.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(ptr) !== 0x02014b50) throw new Error(`zip: central directory entry ${i} malformed`);
    const method = zip.readUInt16LE(ptr + 10);
    const crc = zip.readUInt32LE(ptr + 16);
    const csize = zip.readUInt32LE(ptr + 20);
    const usize = zip.readUInt32LE(ptr + 24);
    const nameLen = zip.readUInt16LE(ptr + 28);
    const extraLen = zip.readUInt16LE(ptr + 30);
    const commentLen = zip.readUInt16LE(ptr + 32);
    const lfhOffset = zip.readUInt32LE(ptr + 42);
    const name = zip.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    if (method !== 8 && method !== 0) throw new Error(`zip: entry ${name} method=${method} unsupported`);
    // local header: name/extra lengths may differ from central — read them
    if (zip.readUInt32LE(lfhOffset) !== 0x04034b50) throw new Error(`zip: local header for ${name} malformed`);
    const lNameLen = zip.readUInt16LE(lfhOffset + 26);
    const lExtraLen = zip.readUInt16LE(lfhOffset + 28);
    const dataStart = lfhOffset + 30 + lNameLen + lExtraLen;
    const raw = zip.subarray(dataStart, dataStart + csize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (data.length !== usize) throw new Error(`zip: entry ${name} size mismatch`);
    if (crc32(data) !== crc) throw new Error(`zip: entry ${name} CRC mismatch (corrupt)`);
    out.push({ name, data });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv[0] === "--extract") {
  // extract mode: fail-closed CRC-verified unpack
  const zipPath = argv[1];
  const outDir = argv[2] ? join(process.cwd(), argv[2]) : join(process.cwd(), "dist", "bundle-extract");
  if (!zipPath || !existsSync(zipPath)) {
    console.error("bundle: --extract <zip> <outDir> — zip missing");
    process.exit(1);
  }
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const entries = readZip(readFileSync(zipPath));
  for (const e of entries) {
    const dest = join(outDir, e.name);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, e.data);
  }
  console.log(`bundle: extracted ${entries.length} entries (all CRC-verified) → ${outDir}`);
  process.exit(0);
}

// bundle mode
const positional = argv.filter((a) => !a.startsWith("--"));
const outFlag = argv.find((a) => a.startsWith("--out="));
const pkgDir = positional[0] ? join(process.cwd(), positional[0]) : join(repoRoot(), "dist", "content-package");
const outDir = outFlag ? join(process.cwd(), outFlag.slice("--out=".length)) : join(repoRoot(), "dist");

const manifestPath = join(pkgDir, "MANIFEST.json");
if (!existsSync(manifestPath)) {
  console.error("bundle: MANIFEST.json missing — bundle a compiled package directory");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const scopeId = String(manifest.scopeId ?? "hub-corpus");
const version = String(manifest.packageVersion ?? "0.2");
const buildId = String(manifest.buildId ?? "");
if (!/^[0-9a-f]{64}$/.test(buildId)) {
  console.error("bundle: manifest.buildId malformed — refusing to name a bundle from it");
  process.exit(1);
}
const pkgName = `syllabai-content-${scopeId}-${version}-${buildId.slice(0, 12)}`;
const zipName = `${pkgName}.zip`;

// collect files under the top-level package directory (sorted)
const rels = walkFiles(pkgDir);
const files = rels.map((r) => ({ name: `${pkgName}/${r}`, data: readFileSync(join(pkgDir, r)) }));
const zip = buildZip(files);
const zipPath = join(outDir, zipName);
mkdirSync(outDir, { recursive: true });
writeFileSync(zipPath, zip);

// round-trip: read back, CRC-verify, byte-compare every entry
const back = readZip(readFileSync(zipPath));
if (back.length !== files.length) {
  console.error(`bundle: round-trip entry count mismatch (${back.length} != ${files.length})`);
  process.exit(1);
}
let mismatches = 0;
for (let i = 0; i < files.length; i++) {
  if (back[i].name !== files[i].name || !back[i].data.equals(files[i].data)) mismatches++;
}
if (mismatches > 0) {
  console.error(`bundle: round-trip mismatch on ${mismatches} entries`);
  process.exit(1);
}

const totalBytes = files.reduce((a, f) => a + f.data.length, 0);
console.log(`bundle: ${zipPath}`);
console.log(`bundle: name=${zipName} (${files.length} entries, ${(totalBytes / 1e6).toFixed(1)} MB uncompressed → ${(zip.length / 1e6).toFixed(1)} MB zip)`);
console.log(`bundle: round-trip verified (${files.length}/${files.length} entries CRC + byte-identical)`);
console.log(`bundle: sha256=${sha256File(zipPath)}`);
console.log(`bundle: import boundary — this artifact never publishes content and never confers serving eligibility (§12)`);
