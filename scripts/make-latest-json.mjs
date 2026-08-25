#!/usr/bin/env node
/**
 * Build `latest.json` for the desktop updater.
 *
 * Tauri generates the `.sig` files during `tauri build`, but **not** this
 * manifest — it is the one release artifact you are expected to write by hand,
 * and hand-writing it is how the signature and the download URL end up
 * disagreeing. The failure is silent: the app fetches the endpoint, fails to
 * verify or 404s, and reports "couldn't check for updates" forever.
 *
 *   node scripts/make-latest-json.mjs [--notes "..."] [--out latest.json]
 *
 * Reads the version from `src-tauri/tauri.conf.json` — the same source the
 * frontend compiles in — finds the built installer and its signature, and
 * writes a manifest whose URL points at the release this version will be
 * published under.
 *
 * **Publishing repo is not the code repo** (Q13, deliberate): releases go to
 * `EchoIt-Messenger`, development lives in `EchoIt-CB`. The URL below is
 * derived from the same `tauri.conf.json` endpoint the app checks, so the two
 * cannot drift.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const version = conf.version;
const endpoint = conf.plugins?.updater?.endpoints?.[0];
if (!endpoint) {
  console.error('No plugins.updater.endpoints[0] in tauri.conf.json — nothing to point at.');
  process.exit(1);
}

// ".../releases/latest/download/latest.json" -> ".../releases/download/v<version>"
// A manifest served from /latest/download must hand out URLs for a specific
// tag; pointing them back at /latest would make every release advertise
// whatever is newest, which stops being true the moment the next one ships.
const base = endpoint.replace(/\/releases\/latest\/download\/latest\.json$/, '');
if (base === endpoint) {
  console.error(`Endpoint is not the expected .../releases/latest/download/latest.json shape:\n  ${endpoint}`);
  process.exit(1);
}
const downloadBase = `${base}/releases/download/v${version}`;

/** Find the built Windows installer and its detached signature. */
function windowsArtifact() {
  const roots = [
    'src-tauri/target/release/bundle/nsis',
    'src-tauri/target/release/bundle/msi',
  ];
  for (const dir of roots) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir);
    // Match the artifact to THIS version. Older builds are left behind in the
    // bundle directory, and taking whichever .sig comes first published a
    // manifest that advertised the new version while pointing at the previous
    // installer -- a URL that does not exist under the new tag, so every
    // update fails. Caught only because the signature then did not match.
    const sig = files.find((f) => f.endsWith('.sig') && f.includes(version));
    if (!sig) continue;
    const installer = sig.replace(/\.sig$/, '');
    if (!files.includes(installer)) continue;
    return {
      installer,
      signature: readFileSync(join(dir, sig), 'utf8').trim(),
    };
  }
  return null;
}

const win = windowsArtifact();
if (!win) {
  console.error(
    [
      'No signed Windows installer found under src-tauri/target/release/bundle/.',
      '',
      'Most likely the build ran without the signing key, in which case Tauri',
      'produces an installer but no .sig and the updater has nothing to verify.',
      'Build with both set:',
      '',
      '  TAURI_SIGNING_PRIVATE_KEY_PATH=src-tauri/echoit-updater.key \\',
      '  TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<from src-tauri/updater.properties> \\',
      '  npx tauri build',
    ].join('\n'),
  );
  process.exit(1);
}

const manifest = {
  version,
  notes: argOf('--notes', `EchoIt ${version}`),
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: win.signature,
      url: `${downloadBase}/${encodeURIComponent(win.installer)}`,
    },
  },
};

const out = argOf('--out', 'latest.json');
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Wrote ${out} for v${version}`);
console.log(`  installer : ${win.installer}`);
console.log(`  url       : ${manifest.platforms['windows-x86_64'].url}`);
console.log('');
console.log('Upload BOTH the installer and this latest.json as assets on the');
console.log(`release tagged v${version} in the publishing repo:`);
console.log(`  gh release create v${version} --repo mrsarthi/EchoIt-Messenger \\`);
console.log(`      "src-tauri/target/release/bundle/nsis/${win.installer}" ${out}`);
console.log('');
console.log('Android is not in this manifest by design: Tauri v2 has no Android');
console.log('updater, and that half of Q21 is the release page plus a reinstall.');
