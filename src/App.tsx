import { useEffect, useState } from "react";
import { installBridgeHarness } from "./bridge-harness";
import { BridgeScreen } from "./bridge-screen";
import { AppProvider, useApp } from "./context/AppContext";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { AppShell } from "./screens/AppShell";
import { Card } from "./components/ui/Card";
import { Button } from "./components/ui/Button";
import { Modal } from "./components/ui/Modal";
import { ShieldIcon, RefreshIcon } from "./components/ui/Icons";

/**
 * `VITE_HARNESS=bridge` runs the headless/bridge diagnostic regression harness.
 * Preserved byte-for-byte for external automated testing.
 */
const BRIDGE_MODE = import.meta.env.VITE_HARNESS === "bridge";

function AppContent() {
  const { state, error, resetApp } = useApp();
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (state === "checking" || state === "unlocking") {
    return (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--color-bg)",
          padding: "var(--space-lg)",
        }}
      >
        <Card
          elevation="low"
          style={{
            maxWidth: 380,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: "var(--space-md)",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--color-primary-subtle)",
              color: "var(--color-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ShieldIcon size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: "var(--font-size-h3)", fontFamily: "var(--font-family-headline)", margin: 0 }}>
              {state === "checking" ? "Opening EchoIt..." : "Unlocking your storage..."}
            </h3>
            <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-body-sm)", marginTop: 6 }}>
              {state === "checking"
                ? "Getting your key from this device's secure storage."
                : "Opening your local journal and connecting your device directly."}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--color-bg)",
          padding: "var(--space-lg)",
        }}
      >
        <Card
          elevation="low"
          style={{
            maxWidth: 420,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-md)",
          }}
        >
          <h3 style={{ fontSize: "var(--font-size-h3)", color: "var(--color-warning)", margin: 0 }}>
            Initialization Error
          </h3>
          <p style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-text)", lineHeight: 1.5 }}>
            {error || "An unexpected error occurred while starting EchoIt."}
          </p>
          <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => window.location.reload()}
              icon={<RefreshIcon size={16} />}
            >
              Retry
            </Button>
            <Button
              variant="danger"
              fullWidth
              onClick={() => setResetConfirmOpen(true)}
            >
              Reset Session
            </Button>
          </div>
        </Card>

        {/* Accessible In-App Reset Confirmation Modal (avoiding window.confirm) */}
        <Modal
          isOpen={resetConfirmOpen}
          onClose={() => setResetConfirmOpen(false)}
          title="Reset Local Session?"
          subtitle="This removes every conversation from this device and deletes the stored key. You will need your recovery phrase to get your identity back."
          footer={
            <>
              <Button variant="ghost" onClick={() => setResetConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={resetting}
                onClick={async () => {
                  setResetting(true);
                  try {
                    await resetApp();
                    setResetConfirmOpen(false);
                  } catch {
                    // error handled in context
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
          <p style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-text-muted)" }}>
            Make sure you have written down your 12-word recovery phrase before proceeding.
          </p>
        </Modal>
      </div>
    );
  }

  if (state === "onboarding") {
    return <OnboardingScreen />;
  }

  return <AppShell />;
}

export default function App() {
  useEffect(() => {
    if (BRIDGE_MODE) {
      void installBridgeHarness();
    }
  }, []);

  if (BRIDGE_MODE) {
    return <BridgeScreen />;
  }

  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
