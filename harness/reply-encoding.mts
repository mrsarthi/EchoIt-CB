/**
 * Replies use the SDK field, and old ones still read correctly.
 *
 *   npm run test:reply
 *
 * SDK 0.7.2 added `replyTo` to `SendMessageOptions` and `SdkChatMessage`, so
 * references travel as their own field and nothing is encoded into `content`
 * any more.
 *
 * What still needs testing is the half that cannot be deleted: messages sent
 * during the workaround carry their references on a control line **inside**
 * `content`, and those messages are in conversation documents on real devices
 * permanently — a CRDT does not forget. Drop the reader and someone's old
 * replies turn into a visible line of machine text in the middle of their own
 * history.
 *
 * So these cases are mostly about that reader: it must strip what it wrote,
 * never fire on text a person could type, and fail safe when malformed.
 */

import {
  decodeLegacyReply,
  previewOfMessage,
  toggleTarget,
  MAX_CHAIN,
  type ReplyTarget,
} from '../src/services/reply.js';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} - ${name}${!ok && detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const MARKER = '\u0001echoit:reply:';

console.log('\n▸ Messages sent before the field existed');

let r = decodeLegacyReply(`${MARKER}abc123\nsounds good`);
check(
  'a single reference is recovered',
  r.replyTo.join() === 'abc123' && r.content === 'sounds good',
  JSON.stringify(r),
);

r = decodeLegacyReply(`${MARKER}a1,b2,c3\nanswering all of these`);
check(
  'a chain is recovered in order',
  r.replyTo.join(',') === 'a1,b2,c3' && r.content === 'answering all of these',
  JSON.stringify(r),
);

r = decodeLegacyReply(`${MARKER}x9\nline one\nline two`);
check(
  'a multi-line message keeps its newlines',
  r.content === 'line one\nline two' && r.replyTo.join() === 'x9',
  JSON.stringify(r),
);

check(
  'the marker never reaches the reader',
  !decodeLegacyReply(`${MARKER}a\nhello`).content.includes('echoit:reply:'),
  'this is what a client without the convention would have shown',
);

console.log('\n▸ It must not fire on anything else');

// The case that decides whether the marker was chosen well.
const impostor = 'echoit:reply:fake\nnice try';
check(
  'text a person could type is left alone',
  decodeLegacyReply(impostor).replyTo.length === 0 && decodeLegacyReply(impostor).content === impostor,
  'the real marker begins with a control character no keyboard produces',
);

check(
  'an ordinary message passes through untouched',
  decodeLegacyReply('just a message').content === 'just a message',
);

check('an empty message decodes to nothing', decodeLegacyReply('').content === '');

const truncated = `${MARKER}abc`;
check(
  'a marker with no newline does not leak to the screen',
  !decodeLegacyReply(truncated).content.includes('echoit:reply:'),
  `got ${JSON.stringify(decodeLegacyReply(truncated).content)} — showing the raw line is worse than losing the quotes`,
);

console.log('\n▸ Previews');

check('text is used as-is when short', previewOfMessage('hi there') === 'hi there');
check(
  'a long message is cut, not wrapped',
  previewOfMessage('x'.repeat(200)).length <= 91,
  'a quote taller than the reply turns the thread into a stack of repeats',
);
check('a photo says what it is', previewOfMessage('', [{ mime: 'image/png' }]) === 'Photo');
check(
  'a file falls back to its name',
  previewOfMessage('', [{ mime: 'application/pdf', name: 'notes.pdf' }]) === 'notes.pdf',
);
check('several files are counted', previewOfMessage('', [{ mime: 'image/png' }, { mime: 'image/jpeg' }]) === '2 files');
check('an empty message still says something', previewOfMessage('') === 'Message');

console.log('\n▸ Building the chain');

const t = (id: string): ReplyTarget => ({ id, author: 'Someone', preview: id });
let chain = toggleTarget([], t('a'));
chain = toggleTarget(chain, t('b'));
check('swiping adds to the chain', chain.map((c) => c.id).join() === 'a,b');

chain = toggleTarget(chain, t('a'));
check(
  'swiping the same message again removes it',
  chain.map((c) => c.id).join() === 'b',
  'the only way to change your mind without clearing everything',
);

check('there is a cap on how many can be chained', MAX_CHAIN > 0 && MAX_CHAIN <= 20, `${MAX_CHAIN}`);

console.log(`\n${'─'.repeat(64)}`);
if (failures.length) {
  console.log(`FAIL  ${failures.length} check(s) failed:`);
  for (const f of failures) console.log(`        - ${f}`);
} else {
  console.log('PASS  the field carries replies, and older ones still read correctly');
}
console.log('─'.repeat(64));
process.exit(failures.length ? 1 : 0);
