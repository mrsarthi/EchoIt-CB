/**
 * Your name, your picture and a line about you — published to contacts.
 *
 * ## What "saved" is allowed to say
 *
 * `setMyProfile` reports how many *connected* peers received the profile, and
 * zero is the ordinary case: most edits happen with nobody online. So the
 * confirmation says the profile is saved and will reach people, and mentions a
 * number only when there is one worth mentioning. Reporting "sent to 0
 * contacts" would read as a failure of something that worked.
 *
 * ## Clearing a field has to be possible
 *
 * The SDK keeps any field left undefined, which is right for partial updates
 * and wrong for a form: someone who deletes their bio and presses Save means
 * to delete it. `publishProfile` converts an emptied field to an explicit
 * clear, and the picture has its own Remove for the same reason.
 */

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../context/AppContext";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { AlertBanner } from "../ui/AlertBanner";
import { Avatar } from "./Avatar";
import { fileToAvatar, type Avatar as AvatarBytes } from "../../services/avatar";
import { MAX_BIO_LENGTH, MAX_DISPLAY_NAME_LENGTH } from "../../services/profile-format";

export function MyProfileEditor() {
  const { myProfile, saveMyProfile } = useApp();

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  /** `undefined` keeps what is published; `null` removes it. */
  const [avatar, setAvatar] = useState<AvatarBytes | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  // Seed the form from what is published, and re-seed if it changes under us
  // (another device, or the first load arriving after mount).
  useEffect(() => {
    setName(myProfile?.displayName ?? "");
    setBio(myProfile?.bio ?? "");
    setAvatar(undefined);
  }, [myProfile?.updatedAt]);

  // What the preview should show: a newly chosen picture, an explicit removal,
  // or whatever is currently published.
  const preview = avatar === undefined
    ? myProfile
    : avatar === null
      ? { updatedAt: 0 }
      : { updatedAt: 0, avatar };

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
      // Let the same file be chosen again after a failure.
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const save = async () => {
    setError(undefined);
    setSaved(undefined);
    setBusy(true);
    try {
      const reached = await saveMyProfile({ displayName: name, bio, avatar });
      setAvatar(undefined);
      // The verb has to agree too. "sent to 1 contact who are online" shipped
      // to a device before this line was written down properly.
      setSaved(reached > 0
        ? `Saved, and sent to ${reached} ${reached === 1 ? "contact who is" : "contacts who are"} online now.`
        : "Saved. Your contacts will see it next time you are both online.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      setBusy(false);
    }
  };

  const label = {
    fontSize: "var(--font-size-label)",
    fontWeight: "var(--font-weight-semibold)",
    color: "var(--color-text-muted)",
    letterSpacing: "0.04em",
  } as const;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <span style={label}>YOUR PROFILE</span>

      {/*
        Wraps rather than sitting in fixed columns. A row of picture + buttons
        is exactly the shape that overflowed the theme selector at a large
        system font; flex-wrap means the buttons drop below the picture instead
        of running off the screen.
      */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", flexWrap: "wrap" }}>
        <Avatar profile={preview} name={name || "You"} size={72} />
        <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
            {preview?.avatar ? "Change picture" : "Add picture"}
          </Button>
          {preview?.avatar && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setAvatar(null)}>
              Remove
            </Button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>

      <Input
        label="Name"
        placeholder="What people should call you"
        value={name}
        maxLength={MAX_DISPLAY_NAME_LENGTH}
        onChange={(e) => setName(e.target.value)}
        hint="Contacts who gave you their own name for you will keep seeing that one."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ fontSize: "var(--font-size-body-sm)", fontWeight: "var(--font-weight-medium)" }}>
          About you
        </label>
        <textarea
          value={bio}
          maxLength={MAX_BIO_LENGTH}
          rows={3}
          placeholder="A line about you. Optional."
          onChange={(e) => setBio(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "var(--space-sm)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface)",
            color: "var(--color-text)",
            font: "inherit",
            resize: "vertical",
          }}
        />
        <span style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)" }}>
          {bio.length}/{MAX_BIO_LENGTH}
        </span>
      </div>

      {error && <AlertBanner variant="warning">{error}</AlertBanner>}
      {saved && <AlertBanner variant="success">{saved}</AlertBanner>}

      <div>
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "Working..." : "Save profile"}
        </Button>
      </div>

      <p style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)", margin: 0 }}>
        Your profile goes only to people you have paired with. A ticket you
        share does not carry it, so a stranger who dials you learns nothing
        about you from it.
      </p>
    </section>
  );
}
