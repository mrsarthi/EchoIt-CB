#!/usr/bin/env node
/**
 * The server claim in the app matches the server claim in the document.
 *
 *   npm run check:claims
 *
 * ## Why this exists
 *
 * `PRODUCT.md` §1 ends with a list headed **"Do not write, anywhere, ever"**,
 * and until now nothing enforced it. A sentence on that list — *"it's the only
 * time the app talks to a server"* — was specified by §4.3, written into the
 * Settings screen, shipped, found to be false (Finding 18), and then sat there
 * for nine days. A prohibition nobody checks is a comment.
 *
 * Two rules, because the failure had two halves.
 *
 *  1. **No banned sentence appears in shipped copy.** Grep-level, over `src/`
 *     only. The documents are excluded deliberately: §1 and §4.3 *quote* these
 *     sentences in order to forbid them, and a checker that cannot tell a
 *     prohibition from an assertion would fail on the very file it protects.
 *
 *  2. **The disclosure the app shows is the one §4.4 approved**, word for word.
 *     This is the stronger half. Rule 1 catches a false claim being added;
 *     rule 2 catches an approved claim being quietly softened, reworded, or
 *     deleted — which is the likelier drift, since nobody edits copy intending
 *     to lie.
 *
 * Rule 2 compares text, not markup: JSX entities are decoded and runs of
 * whitespace collapsed, so reflowing a paragraph is allowed and changing a word
 * is not.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PRODUCT = 'design/PRODUCT.md';
const SETTINGS = 'src/screens/tabs/SettingsTab.tsx';

/** §1's "Do not write, anywhere, ever" list, as matchable text. */
const BANNED = [
  'never connects to a server',
  'nothing ever leaves your device',
  'no data is ever transmitted',
  'only time the app talks to a server',
  'only thing EchoIt asks a server',
];

const failures = [];

/** Collapse markup differences so the comparison is about words. */
const normalise = (text) => text
  .replace(/&apos;|&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"')
  .replace(/\s+/g, ' ')
  .trim();

// ── Rule 1 ────────────────────────────────────────────────────────────────
// Shipped strings only. `git grep` keeps this honest about what is tracked.
for (const phrase of BANNED) {
  let hits = '';
  try {
    hits = execFileSync('git', ['grep', '-n', '-i', '-F', phrase, '--', 'src/'], { encoding: 'utf8' });
  } catch {
    continue; // git grep exits 1 when there is no match, which is the good case
  }
  for (const line of hits.trim().split('\n')) {
    // A comment explaining that the sentence is banned is not the sentence.
    if (/^\s*[^:]*:\d+:\s*(\/\/|\*|\{\/\*)/.test(line)) continue;
    failures.push(`banned sentence in shipped copy: ${line.trim()}`);
  }
}

// ── Rule 2 ────────────────────────────────────────────────────────────────
const product = readFileSync(PRODUCT, 'utf8');

/** Pull the `> *"…"*` UI Copy blockquote out of one §4 subsection. */
function approvedCopy(headingStartsWith) {
  const lines = product.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('### ') && l.slice(4).startsWith(headingStartsWith));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith('### '));
  if (end === -1) end = lines.length;
  const section = lines.slice(start, end);
  const from = section.findIndex((l) => l.includes('**UI Copy**'));
  if (from === -1) return null;
  const quote = [];
  for (const line of section.slice(from + 1)) {
    if (!line.trimStart().startsWith('>')) break;
    quote.push(line.trim().replace(/^>\s?/, ''));
  }
  // The blockquote is wrapped in *"…"* — the emphasis and quotes are markup.
  const body = normalise(quote.join(' ')).replace(/^\*"/, '').replace(/"\*$/, '').trim();
  /*
   * §4 writes its UI copy as "Label — sentence.", and the label ships as a
   * section heading rather than as part of the paragraph. §4.3 does the same
   * thing ("Check for updates — EchoIt asks GitHub…"), so this is the house
   * style and not a one-off.
   *
   * Only a genuine label is stripped: short, and not itself a sentence. A
   * paragraph that happens to use an em dash keeps all of its words, which
   * matters — this check is worth nothing if it can be talked out of comparing
   * the part that carries the meaning.
   */
  const dash = body.indexOf(' — ');
  if (dash > 0 && dash < 40 && !/[.?!]/.test(body.slice(0, dash))) {
    return body.slice(dash + 3).trim();
  }
  return body;
}

const helperCopy = approvedCopy('4. The connection helper');
if (!helperCopy) {
  failures.push(`could not find the UI Copy blockquote under §4.4 in ${PRODUCT} — has the section been renamed?`);
} else {
  const settings = readFileSync(SETTINGS, 'utf8');
  const shipped = normalise(settings.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<[^>]+>/g, ' '));
  if (!shipped.includes(helperCopy)) {
    failures.push('the Settings screen does not carry §4.4\'s approved wording verbatim.');
    failures.push(`  §4.4 says : ${helperCopy}`);
    failures.push('  Fix whichever one is wrong — but if it is the document, the wording is the user\'s to approve.');
  }
}

console.log('─'.repeat(64));
if (failures.length) {
  console.log('FAIL  the server claim has drifted\n');
  for (const f of failures) console.log(`  ${f}`);
} else {
  console.log(`PASS  no banned sentence in src/, and Settings matches ${PRODUCT} §4.4`);
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
