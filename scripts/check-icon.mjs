#!/usr/bin/env node
/**
 * Does the built executable actually carry the icon on disk?
 *
 * This exists because the stock Tauri placeholder shipped unnoticed from the
 * day the project was scaffolded until a user pointed at their own taskbar.
 * Every other check in this repo asserts *behaviour* — delivery, CSP, layout,
 * fingerprints — and an app wearing the wrong icon behaves perfectly.
 *
 * Regenerating icons is not enough. Cargo can consider the build script's
 * output up to date and relink the previously compiled resource, so a rebuild
 * silently keeps the old icon and exits 0.
 *
 *   node scripts/check-icon.mjs [path-to-exe]
 *
 * Compares every frame in `src-tauri/icons/icon.ico` against the bytes of the
 * executable. Windows stores each icon size as its own `RT_ICON` resource, so a
 * frame that was embedded appears verbatim.
 *
 * **Do not substitute `ExtractAssociatedIcon`.** It consults the Windows shell
 * icon cache, which is keyed by path and stale — it reported the old icon for a
 * binary that had been correctly rebuilt, and reported it again from a copy at
 * a fresh path. Bytes do not lie.
 */

import { readFileSync, existsSync } from 'node:fs';

const ICO = 'src-tauri/icons/icon.ico';
const exePath = process.argv[2] ?? 'src-tauri/target/release/echoit.exe';

if (!existsSync(ICO)) {
  console.error(`No ${ICO}. Run: npx tauri icon src/assets/logo.png`);
  process.exit(1);
}
if (!existsSync(exePath)) {
  console.error(`No executable at ${exePath}. Build first, or pass a path.`);
  process.exit(1);
}

const ico = readFileSync(ICO);
const exe = readFileSync(exePath);

// ICONDIR: reserved(2) type(2) count(2), then count × ICONDIRENTRY(16).
const count = ico.readUInt16LE(4);
if (!count) {
  console.error(`${ICO} declares no frames — it is not a valid .ico`);
  process.exit(1);
}

let embedded = 0;
const rows = [];

for (let i = 0; i < count; i += 1) {
  const entry = 6 + i * 16;
  const w = ico[entry] || 256;
  const h = ico[entry + 1] || 256;
  const size = ico.readUInt32LE(entry + 8);
  const offset = ico.readUInt32LE(entry + 12);
  const frame = ico.subarray(offset, offset + size);

  // A 64-byte window is far past the point of coincidence, and cheap.
  const present = exe.includes(frame.subarray(0, Math.min(64, frame.length)));
  if (present) embedded += 1;
  rows.push(`  ${String(w).padStart(3)}x${String(h).padEnd(3)}  ${String(size).padStart(7)} bytes  ${present ? 'embedded' : 'MISSING'}`);
}

console.log(`icon.ico frames: ${count}`);
console.log(rows.join('\n'));
console.log('');

if (embedded === count) {
  console.log(`PASS — ${embedded} of ${count} frames embedded in ${exePath}`);
  process.exit(0);
}

console.log(`FAIL — only ${embedded} of ${count} frames embedded.`);
console.log('');
console.log('The binary carries a different icon than the one on disk. Cargo');
console.log('reused the previously compiled resource. Force it:');
console.log('');
console.log(`  rm -f  ${exePath}`);
console.log('  rm -rf src-tauri/target/release/build/echoit-*');
console.log('  touch  src-tauri/build.rs');
console.log('');
console.log('then rebuild and confirm "Compiling echoit" appears in the output.');
process.exit(1);
