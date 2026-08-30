/**
 * The one thing a new account is asked for before it starts messaging.
 *
 * ## Why this exists at all
 *
 * A brand-new account had no name, so the first thing every contact saw was
 * `Device ending in ...abc123`, and the only way to fix it was to find the
 * Profile tab and guess that the field there was the one other people read.
 * Most people never did. This asks once, at the moment the answer is obvious.
 *
 * ## Why the name is required and the rest is not
 *
 * A name is what the other person reads on a request card and in their contact
 * list; without one they are accepting six characters of a key. A picture and a
 * bio change nothing about whether pairing is comprehensible, so they are
 * offered here and skippable.
 *
 * ## What it is careful not to imply
 *
 * The name is a **claim**, exactly as a contact's name is a claim, and this
 * screen says so rather than letting someone believe that typing it here proves
 * anything. The line about the safety code is the honest version of the same
 * point, and it belongs here — the moment a person decides what to call
 * themselves is the moment the distinction is cheapest to explain.
 *
 * Shown when nothing has ever been published *and* no knock name was ever
 * typed, so an existing account never sees it. `saveMyProfile` writes both, so
 * finishing here means it never appears again.
 */

import { useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input, Textarea } from "../components/ui/Input";
import { AlertBanner } from "../components/ui/AlertBanner";
import { Avatar } from "../components/profile/Avatar";
import { Logo } from "../components/ui/Logo";
import { fileToAvatar, type Avatar as AvatarBytes } from "../services/avatar";
import { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH } from "../services/profile-format";

export interface ProfileSetupScreenProps {
  /** Called once a name has been published. */
  onDone: () => void;
}

export function ProfileSetupScreen({ onDone }: ProfileSetupScreenProps) {
  const { saveMyProfile } = useApp();

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState<AvatarBytes | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setBusy(true);
    try {
      setAvatar(await fileToAvatar(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That picture could not be used.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const finish = async () => {
    if (!trimmed) return;
    setError(undefined);
    setBusy(true);
    try {
      await saveMyProfile({ displayName: trimmed, bio, avatar });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that.");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        overflowY: "auto",
        backgroundColor: "var(--color-bg)",
        display: "flex",
        justifyContent: "center",
        padding: "var(--space-lg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
          <Logo size={28} />
          <h2 style={{ fontSize: "var(--font-size-h2)", margin: 0 }}>EchoIt</h2>
        </div>

        <div>
          <h1 style={{ fontSize: "var(--font-size-h1)", fontFamily: "var(--font-family-headline)", margin: "0 0 6px" }}>
            What should people call you?
          </h1>
          <p style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>
            This is what your contacts see when you ask to connect and in their
            list afterwards. You can change it whenever you like.
          </p>
        </div>

        <Card style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {/*
            Wraps rather than sitting in fixed columns -- picture beside buttons
            is the exact shape that ran off the screen at a large system font.
          */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
            <Avatar
              profile={avatar ? { updatedAt: 0, avatar } : { updatedAt: 0 }}
              name={trimmed || "You"}
              size={72}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                {avatar ? "Change picture" : "Add a picture"}
              </Button>
              <span style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)" }}>
                Optional
              </span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>

          <Input
            label="YOUR NAME"
            placeholder="e.g. Sarthi"
            value={name}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
          />

          <Textarea
            label="ABOUT YOU (OPTIONAL)"
            placeholder="A line about you"
            value={bio}
            maxLength={MAX_BIO_LENGTH}
            rows={2}
            onChange={(e) => setBio(e.target.value)}
          />

          {error && <AlertBanner variant="warning">{error}</AlertBanner>}

          <Button size="lg" loading={busy} disabled={!trimmed} onClick={finish}>
            Continue
          </Button>
        </Card>

        {/*
          The same distinction the request card makes, made once here where a
          person is choosing the name rather than reading someone else's. It is
          not a warning; it is the reason the safety code exists at all.
        */}
        <p style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>
          A name is something you choose, not something EchoIt checks — anyone
          can type anything. That is why every contact also has a short safety
          code you can read out to each other.
        </p>
      </div>
    </div>
  );
}
