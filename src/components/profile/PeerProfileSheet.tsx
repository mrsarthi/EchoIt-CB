/**
 * Who someone says they are, opened by tapping their name in a chat.
 *
 * ## Every line here is one of two kinds, and they are not mixed
 *
 * A profile is self-published: the name, the bio and the picture are all
 * claims, and a peer can change them to anything at any moment. The
 * fingerprint is derived from the identity the handshake proved and cannot be
 * chosen. Presenting the two in the same voice is how an app talks someone
 * into trusting a stranger who copied a contact's name, so the claimed parts
 * are grouped and labelled and the proven part is stated separately.
 *
 * The heading uses the name *you* gave them where there is one. See
 * `profile-format.ts` for why that ordering is not a preference.
 */

import { Modal } from "../ui/Modal";
import { Avatar } from "./Avatar";
import {
  displayNameFor,
  fingerprintOf,
  isClaimedName,
  type PeerProfile,
} from "../../services/profile-format";

export interface PeerProfileSheetProps {
  isOpen: boolean;
  onClose: () => void;
  peerDid: string;
  /** The name from your own contact list, if you gave one. */
  localName?: string;
  profile?: PeerProfile;
}

export function PeerProfileSheet({
  isOpen,
  onClose,
  peerDid,
  localName,
  profile,
}: PeerProfileSheetProps) {
  const heading = displayNameFor(localName, profile, peerDid);
  const claimed = profile?.displayName?.trim();
  const headingIsClaim = isClaimedName(localName, profile);

  const muted = {
    fontSize: "var(--font-size-label)",
    color: "var(--color-text-muted)",
  } as const;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Profile">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
          <Avatar profile={profile} name={heading} size={64} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: "var(--font-weight-semibold)", fontSize: "var(--font-size-h3)", overflowWrap: "anywhere" }}>
              {heading}
            </div>
            <div style={muted}>
              {headingIsClaim ? "the name they gave themselves" : "the name you gave them"}
            </div>
          </div>
        </div>

        {/*
          Shown even when the heading already uses it, because those are two
          different statements: the heading is what this app calls them, and
          this is what they call themselves. Someone checking whether a contact
          has renamed themselves needs to see both.
        */}
        {claimed && !headingIsClaim && (
          <div>
            <div style={muted}>THEY CALL THEMSELVES</div>
            <div style={{ overflowWrap: "anywhere" }}>{claimed}</div>
          </div>
        )}

        {profile?.bio?.trim() && (
          <div>
            <div style={muted}>ABOUT THEM</div>
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {profile.bio}
            </p>
          </div>
        )}

        <div>
          <div style={muted}>SAFETY CODE</div>
          <div style={{ fontFamily: "var(--font-family-mono, monospace)", fontSize: "var(--font-size-body)" }}>
            {fingerprintOf(peerDid)}
          </div>
          <p style={{ ...muted, margin: "4px 0 0" }}>
            This comes from their key and cannot be changed by them. Everything
            above it can. If you ever want to be sure who you are talking to,
            read this out to each other.
          </p>
        </div>

        {!profile && (
          <p style={{ ...muted, margin: 0 }}>
            They have not published a profile yet. It will appear here when they do.
          </p>
        )}
      </div>
    </Modal>
  );
}
