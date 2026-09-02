/**
 * Reacting to a message.
 *
 * ## Why this is thin
 *
 * SDK 0.8.1 does the hard parts: a reaction rides its own emitter rather than a
 * marker inside `content`, one person holds at most one reaction per message so
 * reacting again replaces rather than appends, and withdrawing is expressible.
 * Everything here is display policy, which is why it is separable and testable
 * without a client.
 *
 * ## The six, and why these six
 *
 * A picker of everything is a worse picker. These cover the replies that would
 * otherwise be sent as a whole message — agreement, warmth, amusement,
 * sympathy, surprise, thanks — which is the point: a reaction exists so that
 * "👍" does not arrive as a notification-worthy message.
 *
 * The plus button opens the system emoji keyboard for anything else, so the
 * short list costs nothing.
 */

/** The defaults offered on long press, in order. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/** One emoji and who used it, as the SDK reports it. */
export interface ReactionGroup {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

/**
 * Order reaction chips under a message.
 *
 * Most-used first so the shape of a conversation is readable at a glance, and
 * ties broken by emoji so the same set never renders two different ways — a
 * row that reshuffles on every render looks like a bug even when the counts
 * are right.
 */
export function orderReactions(
  groups: readonly ReactionGroup[],
): readonly ReactionGroup[] {
  return [...groups]
    .filter((g) => g.count > 0)
    .sort((a, b) => (b.count - a.count) || a.emoji.localeCompare(b.emoji));
}

/**
 * What tapping a chip should do.
 *
 * Tapping your own reaction withdraws it; tapping anything else sets yours to
 * that. This is the whole interaction, and it is stated here rather than in a
 * component because "does tapping mine remove it or re-add it" is exactly the
 * kind of thing that ends up implemented twice, differently.
 */
export function nextAction(
  group: ReactionGroup,
): { readonly kind: "react"; readonly emoji: string } | { readonly kind: "unreact" } {
  return group.mine ? { kind: "unreact" } : { kind: "react", emoji: group.emoji };
}

/**
 * A line for a screen reader.
 *
 * The chip itself is an emoji and a number, which reads as nothing useful.
 */
export function describeReaction(group: ReactionGroup, peerName: string): string {
  if (group.mine && group.count === 1) return `You reacted ${group.emoji}`;
  if (group.mine) return `You and ${group.count - 1} other reacted ${group.emoji}`;
  if (group.count === 1) return `${peerName} reacted ${group.emoji}`;
  return `${group.count} reactions ${group.emoji}`;
}
