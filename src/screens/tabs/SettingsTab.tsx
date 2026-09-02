import { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { SettingsIcon, ShieldIcon, SunIcon, MoonIcon, LockIcon } from "../../components/ui/Icons";
import { Input } from "../../components/ui/Input";
import {
  DEFAULT_RELAY,
  loadRelayUrl,
  saveRelayUrl,
  describeRelayProblem,
} from "../../services/relay";
import {
  APP_VERSION,
  checkForUpdate,
  installInPlace,
  openReleasePage,
  setUpdateChecksEnabled,
  updateChecksEnabled,
  type UpdateStatus,
} from "../../services/updates";

export function SettingsTab() {
  const {
    theme,
    setTheme,
    resetApp,
    keychainAvailable,
    acceptRequests,
    setAcceptRequests,
  } = useApp();
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [updatesOn, setUpdatesOn] = useState(true);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [relayInput, setRelayInput] = useState(() => loadRelayUrl() ?? "");
  const [relayNote, setRelayNote] = useState("");
  const [relayError, setRelayError] = useState(false);

  // Read once on mount rather than during render: `updateChecksEnabled` touches
  // localStorage, which throws in some webview configurations, and a render
  // that can throw is a blank screen.
  useEffect(() => {
    setUpdatesOn(updateChecksEnabled());
  }, []);

  const runCheck = async () => {
    setChecking(true);
    try {
      setUpdate(await checkForUpdate());
    } finally {
      setChecking(false);
    }
  };

  const getUpdate = async () => {
    if (!update) return;
    // Windows replaces itself; Android cannot, and neither can a desktop build
    // whose updater artifacts are missing. Falling back to the page means the
    // button always does something rather than appearing inert.
    if (!(await installInPlace())) {
      await openReleasePage(update.releasePage);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--color-bg)",
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "var(--space-lg) var(--space-lg) var(--space-md)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          backgroundColor: "var(--color-surface)",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "var(--radius-md)",
            backgroundColor: "var(--color-primary-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-primary)",
          }}
        >
          <SettingsIcon size={18} />
        </div>
        <h1
          style={{
            fontSize: "var(--font-size-h3)",
            fontFamily: "var(--font-family-headline)",
            margin: 0,
          }}
        >
          Settings
        </h1>
      </header>

      {/* Settings Sections */}
      <div
        style={{
          padding: "var(--space-lg)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xl)",
          maxWidth: 600,
        }}
      >
        {/* Device key storage status */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <span
            style={{
              fontSize: "var(--font-size-label)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            DEVICE STORAGE SECURITY
          </span>
          <Card style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <ShieldIcon size={20} style={{ color: "var(--color-primary)" }} />
                <span style={{ fontWeight: "var(--font-weight-semibold)", fontSize: "var(--font-size-body)" }}>
                  Device key storage
                </span>
              </div>
              <Badge variant={keychainAvailable ? "success" : "warning"} dot>
                {keychainAvailable ? "Active" : "Unavailable"}
              </Badge>
            </div>
            <p style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.4 }}>
              Your key is kept by Windows (Credential Manager) or Android (Keystore), so EchoIt opens without asking for your recovery phrase each time.
            </p>
            <p style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.4 }}>
              This protects your key if someone takes the device. It does not
              protect it from software already running as you, so keep a lock
              screen or password on this device.
            </p>
          </Card>
        </section>

        {/* Appearance Theme Switcher */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <span
            style={{
              fontSize: "var(--font-size-label)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            APPEARANCE & THEME
          </span>
          <Card style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {/*
              Wraps rather than a fixed three columns.

              This was `repeat(3, 1fr)`. A `1fr` track has an automatic minimum
              of min-content, so it cannot shrink below the label plus the
              button's fixed padding — on a phone with the system font at 1.15
              the System button ran 55px past the card and 8px off the screen.
              Measured: right edge 368, card ends at 313, viewport 360.

              Wrapping means a button that no longer fits moves to its own line
              instead of out of the window, at any font size the system offers.
            */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-sm)",
              }}
            >
              <Button
                variant={theme === "light" ? "primary" : "secondary"}
                size="md"
                onClick={() => setTheme("light")}
                style={{ flex: "1 1 auto" }}
                icon={<SunIcon size={16} />}
              >
                Light
              </Button>
              <Button
                variant={theme === "dark" ? "primary" : "secondary"}
                size="md"
                onClick={() => setTheme("dark")}
                style={{ flex: "1 1 auto" }}
                icon={<MoonIcon size={16} />}
              >
                Dark
              </Button>
              <Button
                variant={theme === "system" ? "primary" : "secondary"}
                size="md"
                onClick={() => setTheme("system")}
                style={{ flex: "1 1 auto" }}
              >
                System
              </Button>
            </div>
          </Card>
        </section>

        {/* Who can reach you */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <span
            style={{
              fontSize: "var(--font-size-label)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            REACHABILITY
          </span>
          <Card style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {/*
              The name lived here as well as in Profile. Removing the field but
              keeping a paragraph about it left the screen still talking about
              something it no longer does — so the paragraph went too. Profile
              is where the name is, and Profile is where it explains itself.
            */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "var(--space-md)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "var(--font-size-body-sm)", fontWeight: "var(--font-weight-semibold)" }}>
                  Let people ask to connect
                </div>
                {/*
                  This is the recovery for a ticket that went somewhere it
                  should not have. A ticket cannot be revoked -- it is your
                  identity plus your addresses, and the person knocking never
                  says which one they used -- so refusing to listen is the only
                  lever that exists. Worth saying rather than implying.
                */}
                <div style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)" }}>
                  Turn this off if your connection ticket has spread further than
                  you meant. Requests are then refused without reaching you, and
                  people you have already added are unaffected.
                </div>
              </div>
              <Button
                variant={acceptRequests ? "secondary" : "primary"}
                size="sm"
                onClick={() => setAcceptRequests(!acceptRequests)}
                style={{ flexShrink: 0 }}
              >
                {acceptRequests ? "On" : "Off"}
              </Button>
            </div>
          </Card>
        </section>

        {/*
          The helper — PRODUCT.md §4.4.

          Finding 18's complaint was not really that a document was wrong; it
          was that every launch reaches infrastructure and the app said nothing
          about it, so the one place a user could check told them less than
          watching their own network would. This is that missing paragraph.

          Copy is §4.4's verbatim and holds to §3: "helper", never "relay" or
          "discovery". It sits above Updates deliberately — the update check is
          the smaller of the two and used to be presented as the only one.

          There is no toggle on purpose. Without the helper the app cannot find
          anyone, and offering a switch that breaks messaging would be worse
          than saying plainly that there isn't one.
        */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <span
            style={{
              fontSize: "var(--font-size-label)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            CONNECTING
          </span>
          <Card>
            <p style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)", lineHeight: 1.5, margin: 0 }}>
              Phones move around and have no fixed address, so EchoIt uses a
              helper to introduce your device to the person you&apos;re
              messaging. Once they&apos;ve been introduced, messages go straight
              between the two phones. If they can&apos;t reach each other
              directly, the helper passes them along sealed — it can&apos;t read
              them, and it never stores one.
            </p>

            {/*
              D9, 2026-08-31. Since the app now ships with only our relay
              rather than a third party's, "trust us instead" is the whole
              claim -- and a default nobody can change is a claim, while a
              default anyone can replace is a choice. This is what makes the
              hosted default defensible.

              It cannot apply live: the relay map is fixed when the endpoint
              binds inside `iroh_start`, so the copy says restart rather than
              appearing to take effect.
            */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              <Input
                label="CONNECTION HELPER (OPTIONAL)"
                placeholder={DEFAULT_RELAY}
                value={relayInput}
                onChange={(e) => { setRelayInput(e.target.value); setRelayNote(""); }}
                hint="Leave blank to use the one EchoIt provides. Changing this takes effect next time you open the app."
              />
              {relayNote && (
                <span style={{ fontSize: "var(--font-size-label)", color: relayError ? "var(--color-warning)" : "var(--color-text-muted)" }}>
                  {relayNote}
                </span>
              )}
              <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const problem = describeRelayProblem(relayInput);
                    if (problem) { setRelayError(true); setRelayNote(problem); return; }
                    saveRelayUrl(relayInput);
                    setRelayError(false);
                    setRelayNote(relayInput.trim()
                      ? "Saved. EchoIt will use it next time you open the app."
                      : "Saved. EchoIt will use its own helper next time you open the app.");
                  }}
                >
                  Save helper
                </Button>
                {relayInput.trim() && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRelayInput("");
                      saveRelayUrl(undefined);
                      setRelayError(false);
                      setRelayNote("Back to the one EchoIt provides, next time you open the app.");
                    }}
                  >
                    Use the default
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </section>

        {/* Updates — Q21 / PRODUCT.md §4.3 */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <span
            style={{
              fontSize: "var(--font-size-label)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            UPDATES
          </span>
          <Card style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-md)" }}>
              <div>
                <div style={{ fontWeight: "var(--font-weight-semibold)" }}>Check for updates</div>
                <div style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)" }}>
                  You are on version {APP_VERSION}
                </div>
              </div>
              <Badge variant={updatesOn ? "success" : "muted"} dot>
                {updatesOn ? "On" : "Off"}
              </Badge>
            </div>

            {/*
              PRODUCT.md §4.3. This used to end "it's the only time the app
              talks to a server", which was false — the app reaches a helper on
              every launch (Finding 18). §4.3 was corrected on 2026-08-30 and
              the clause is gone for good; the helper has its own disclosure
              below, per §4.4. Do not reintroduce a "only server" claim here.
            */}
            <p style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)", lineHeight: 1.5, margin: 0 }}>
              EchoIt asks GitHub once a day whether a newer version is available.
              It sends nothing about you or your conversations. You can turn this
              off, but then you&apos;ll need to check for new versions yourself.
            </p>

            <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
              <Button
                variant="secondary"
                onClick={() => {
                  const next = !updatesOn;
                  setUpdatesOn(next);
                  setUpdateChecksEnabled(next);
                }}
              >
                {updatesOn ? "Turn off update checks" : "Turn on update checks"}
              </Button>
              <Button variant="secondary" onClick={runCheck} disabled={checking}>
                {checking ? "Checking…" : "Check now"}
              </Button>
              {update?.available && <Button onClick={getUpdate}>Get version {update.latest}</Button>}
            </div>

            {/*
              Three outcomes, three messages. "Could not check" must never be
              shown as "up to date": the whole point of the feature is that a
              tester is not stranded, and a failed check reported as success is
              indistinguishable from being on the newest build.
            */}
            {update && (
              <p style={{ fontSize: "var(--font-size-label)", margin: 0, color: update.error ? "var(--color-warning)" : "var(--color-text-muted)" }}>
                {update.error
                  ? "Couldn't check for updates just now. Your app still works — try again later."
                  : update.available
                    ? `Version ${update.latest} is available.`
                    : "You're on the latest version."}
              </p>
            )}
          </Card>
        </section>

        {/* Account & Session Management */}
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <span
            style={{
              fontSize: "var(--font-size-label)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            SESSION & DATA
          </span>
          <Card style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <div>
              <h3 style={{ fontSize: "var(--font-size-body)", margin: "0 0 4px" }}>
                Reset Session & Wipe Local History
              </h3>
              <p style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-text-muted)", margin: 0 }}>
                Removes every conversation from this device and deletes the stored key.
              </p>
            </div>
            <Button
              variant="danger"
              size="md"
              onClick={() => setResetModalOpen(true)}
              icon={<LockIcon size={16} />}
            >
              Reset Session
            </Button>
          </Card>
        </section>
      </div>

      {/* Reset In-App Confirmation Modal */}
      <Modal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title="Reset Local Session?"
        subtitle="This removes every conversation from this device and deletes the stored key. You will need your 12-word recovery phrase to get your identity back."
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setResetModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              loading={resetting}
              onClick={async () => {
                setResetting(true);
                try {
                  await resetApp();
                  setResetModalOpen(false);
                } catch {
                  // surfaced in context
                } finally {
                  setResetting(false);
                }
              }}
            >
              Yes, Reset Everything
            </Button>
          </>
        }
      >
        <p style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-text-muted)", margin: 0 }}>
          Make sure you have written down your 12-word recovery phrase before proceeding.
        </p>
      </Modal>
    </div>
  );
}
