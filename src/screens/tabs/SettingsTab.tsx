import { useState } from "react";
import { useApp } from "../../context/AppContext";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { SettingsIcon, ShieldIcon, SunIcon, MoonIcon, LockIcon } from "../../components/ui/Icons";

export function SettingsTab() {
  const { theme, setTheme, resetApp, keychainAvailable } = useApp();
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-sm)" }}>
              <Button
                variant={theme === "light" ? "primary" : "secondary"}
                size="md"
                onClick={() => setTheme("light")}
                icon={<SunIcon size={16} />}
              >
                Light
              </Button>
              <Button
                variant={theme === "dark" ? "primary" : "secondary"}
                size="md"
                onClick={() => setTheme("dark")}
                icon={<MoonIcon size={16} />}
              >
                Dark
              </Button>
              <Button
                variant={theme === "system" ? "primary" : "secondary"}
                size="md"
                onClick={() => setTheme("system")}
              >
                System
              </Button>
            </div>
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
