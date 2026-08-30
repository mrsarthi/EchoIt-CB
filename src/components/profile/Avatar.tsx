/**
 * Someone's picture, or their initials when they have not published one.
 *
 * ## Why the object URL is made here and not by the caller
 *
 * An avatar arrives as bytes. Showing it needs an object URL, and an object
 * URL lives until it is revoked — so a component that built one during render
 * would leak one on every render, and a profile that updates while a chat is
 * open re-renders plenty. Creating it in an effect keyed on the bytes, and
 * revoking on the way out, is the only arrangement where the number of live
 * URLs stays equal to the number of avatars on screen.
 *
 * The identity of a `Uint8Array` is not a useful effect key — the SDK may hand
 * back an equal array on every read — so the effect keys on the avatar's
 * `updatedAt`, which is the version the profile service itself uses to decide
 * whether something is new.
 */

import { useEffect, useState } from "react";
import { avatarUrl } from "../../services/avatar";
import { initialsOf, type PeerProfile } from "../../services/profile-format";

export interface AvatarProps {
  /** The subject's profile, if we hold one. */
  profile?: PeerProfile;
  /** What we call them — used for the initials, and for the alt text. */
  name: string;
  size?: number;
  /**
   * What `size` is measured in.
   *
   * `px` for a fixed circle — a profile header, a contact row. `em` where it
   * sits beside text and must grow with it: Android scales CSS px for *text*
   * and not for boxes, so a fixed-size indicator next to a label shrinks
   * relative to it as someone raises their system font. Measured at scale 1.5:
   * 18px text beside a 12px circle.
   */
  unit?: "px" | "em";
  /** Ring colour, for the read-status treatment. */
  ring?: string;
  /** Render the picture without colour. Used to mean "delivered, not read". */
  muted?: boolean;
}

export function Avatar({ profile, name, size = 40, ring, muted = false, unit = "px" }: AvatarProps) {
  const avatar = profile?.avatar;
  const version = profile?.updatedAt;
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!avatar) {
      setUrl(undefined);
      return;
    }
    const { url: made, revoke } = avatarUrl(avatar);
    setUrl(made);
    return revoke;
    // `version` stands in for the bytes; see the note at the top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, !avatar]);

  // In px the ring is clamped, because a fixed 2px/4px is right across the
  // whole range of pixel sizes used here. In em everything is already relative,
  // so the same fractions apply unclamped.
  const inner = unit === "em" ? size * 0.08 : Math.min(2, Math.max(1, Math.round(size * 0.08)));
  const outer = unit === "em" ? size * 0.16 : Math.min(4, Math.max(2, Math.round(size * 0.16)));
  const len = (n: number) => `${unit === "em" ? Number(n.toFixed(3)) : n}${unit}`;

  const box = {
    width: len(size),
    height: len(size),
    borderRadius: "50%",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    /*
     * The ring scales with the circle and is capped.
     *
     * Fixed at 2px and 4px it added 8px to the width whatever the size, so the
     * 16px read indicator occupied 24px inside an 18px row of 12px text — it
     * was the largest thing on the line. Measured on a phone, not guessed.
     */
    ...(ring
      ? {
        boxShadow: `0 0 0 ${len(inner)} var(--color-surface), 0 0 0 ${len(outer)} ${ring}`,
      }
      : {}),
  } as const;

  if (url) {
    return (
      <img
        src={url}
        alt={`${name}'s picture`}
        style={{
          ...box,
          objectFit: "cover",
          filter: muted ? "grayscale(1)" : undefined,
        }}
      />
    );
  }

  return (
    <div
      // Not an image, so it needs to say what it stands for.
      role="img"
      aria-label={`${name}, no picture`}
      style={{
        ...box,
        backgroundColor: "var(--color-primary-subtle)",
        color: "var(--color-primary)",
        fontWeight: "var(--font-weight-semibold)",
        // Initials have to shrink with the circle or they escape it, which is
        // the same class of bug as the theme buttons at a large system font.
        fontSize: unit === "em" ? len(size * 0.4) : Math.max(10, Math.round(size * 0.4)),
        filter: muted ? "grayscale(1)" : undefined,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}
