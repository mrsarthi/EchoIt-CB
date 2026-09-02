/**
 * Finding links in a message, and deciding what to say before opening one.
 *
 * ## Highlighting, deliberately not previewing
 *
 * A preview would mean this device asking a third-party web server for a page
 * — which is neither the update check nor "straight between your device and
 * theirs", and would need the CSP widened, the same CSP `PRODUCT.md` §1 cites
 * as its proof. Settled 2026-08-31 (D4): links are made readable and tappable,
 * and nothing is fetched. A bare URL you cannot read is the actual everyday
 * annoyance; the missing thumbnail is not.
 *
 * ## Why opening asks first
 *
 * A message is written by somebody else, and a link is the one part of it that
 * can act on you. Following one leaks an IP address and a time to whoever runs
 * the site, and the text of a link is not the same thing as its destination.
 * So the confirmation shows the **host**, which is the part that decides where
 * you are actually going.
 *
 * ## What is not attempted
 *
 * No shortener expansion, no reputation check, no "is this site safe" claim.
 * All three would need a network call to somebody, and a safety claim we
 * cannot stand behind is worse than none — §4.2's rule.
 */

/** A run of message text: either plain, or something tappable. */
export interface TextSegment {
  readonly kind: "text" | "link";
  readonly value: string;
  /** For links: the absolute URL to open, which may differ from `value`. */
  readonly href?: string;
}

/*
 * Matches http(s):// and bare www. hosts.
 *
 * Deliberately conservative. A pattern that tries to catch every "example.com"
 * written in prose turns ordinary sentences into links -- "see figure 1.a" and
 * file names being the usual casualties -- and a wrong link is worse than a
 * missed one, because it invites a tap somewhere unintended. A scheme or a
 * `www.` is a strong enough signal that somebody meant a link.
 */
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+/gi;

/** Trailing punctuation belongs to the sentence, not the URL. */
const TRAILING = /[.,;:!?)\]}>'"]+$/;

/**
 * Split message text into plain and linked runs.
 *
 * Always returns at least one segment for non-empty input, so a caller can
 * render the result without special-casing "no links found".
 */
export function segmentText(text: string): readonly TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;

  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    let raw = match[0];

    // "look at https://example.com." -- the full stop ends the sentence.
    const trimmed = raw.replace(TRAILING, "");
    const dropped = raw.length - trimmed.length;
    raw = trimmed;

    if (start > last) out.push({ kind: "text", value: text.slice(last, start) });
    out.push({
      kind: "link",
      value: raw,
      href: raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw,
    });
    last = start + raw.length + dropped - dropped;
  }

  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out.length > 0 ? out : [{ kind: "text", value: text }];
}

/** Whether a message has anything tappable in it. */
export function hasLink(text: string): boolean {
  return segmentText(text).some((s) => s.kind === "link");
}

/**
 * The host a URL actually goes to, or undefined if it cannot be read.
 *
 * The host is the part worth showing: link text can say anything, and a long
 * URL scrolled off the side of a dialog tells a reader nothing.
 */
export function hostOf(href: string): string | undefined {
  try {
    const host = new URL(href).hostname;
    return host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * What to ask before opening a link.
 *
 * Names the destination and says plainly what following it costs, without
 * claiming anything about whether the site is safe -- which we cannot know.
 */
export function describeOpen(href: string): string {
  const host = hostOf(href);
  if (!host) {
    return `Open this link?\n\n${href}\n\nEchoIt cannot tell where this goes. Only open links from people you trust.`;
  }
  return `Open ${host}?\n\n${href}\n\nThis leaves EchoIt and opens your browser. ${host} will be able to see your IP address and that you followed this link. Only open links from people you trust.`;
}
