import { useEffect, useState } from "react";
import { useApp } from "../../context/AppContext";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { SettingsIcon, ShieldIcon, SunIcon, MoonIcon, LockIcon } from "../../components/ui/Icons";
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
              PRODUCT.md §4.3 specifies this copy, including the sentence
              "It's the only time the app talks to a server." That sentence is
              not true: iroh_bridge.rs:170 binds with `presets::N0`, so the app
              contacts Number 0's relay and discovery services on every launch
              (Finding 18). Rule #4 makes the approved wording the user's to
              set, so the false clause is omitted here rather than reworded —
              everything below is accurate as written.
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
