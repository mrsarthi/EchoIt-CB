import { useState, useId } from "react";
import { useApp } from "../context/AppContext";
import {
  generateRecoveryPhrase,
  validateRecoveryPhrase,
} from "../services/identity";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Textarea } from "../components/ui/Input";
import { AlertBanner } from "../components/ui/AlertBanner";
import {
  KeyIcon,
  CopyIcon,
  CheckIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from "../components/ui/Icons";
import { Logo } from "../components/ui/Logo";

type OnboardingStep = "intro" | "generate" | "verify" | "restore";

export function OnboardingScreen() {
  const { startNewIdentity, restoreIdentity } = useApp();
  const [step, setStep] = useState<OnboardingStep>("intro");
  const [mnemonic, setMnemonic] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Verification state
  const [verifyIndices, setVerifyIndices] = useState<number[]>([2, 6, 10]); // 0-indexed (words 3, 7, 11)
  const [verifyAnswers, setVerifyAnswers] = useState<Record<number, string>>({});
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Restore state
  const [restoreInput, setRestoreInput] = useState<string>("");

  const fieldId = useId();

  // Start generation flow
  const handleStartGenerate = () => {
    const phrase = generateRecoveryPhrase();
    setMnemonic(phrase);
    setCopied(false);
    setError(null);
    setStep("generate");
  };

  // Copy phrase to clipboard
  const handleCopyPhrase = async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard fallback
    }
  };

  // Proceed to verification
  const handleProceedToVerify = () => {
    // Pick 3 indices to verify
    const indices = [2, 6, 10];
    setVerifyIndices(indices);
    setVerifyAnswers({});
    setVerifyError(null);
    setStep("verify");
  };

  // Submit verification
  const handleCompleteVerification = async () => {
    const words = mnemonic.split(" ");
    for (const idx of verifyIndices) {
      const expected = words[idx].toLowerCase().trim();
      const actual = (verifyAnswers[idx] || "").toLowerCase().trim();
      if (actual !== expected) {
        setVerifyError(`Word #${idx + 1} does not match. Please check your written notes.`);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      await startNewIdentity(mnemonic);
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not initialize identity: ${msg}`);
    }
  };

  // Submit restore
  const handleRestore = async () => {
    const cleaned = restoreInput.trim().toLowerCase().replace(/\s+/g, " ");
    if (!validateRecoveryPhrase(cleaned)) {
      setError("The recovery phrase is invalid. Please ensure all words are spelled correctly.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await restoreIdentity(cleaned);
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Restore failed: ${msg}`);
    }
  };

  const words = mnemonic ? mnemonic.split(" ") : [];

  return (
    <div
      style={{
        height: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-lg)",
        paddingTop: "calc(var(--space-lg) + var(--safe-top))",
        paddingBottom: "calc(var(--space-lg) + var(--safe-bottom))",
        backgroundColor: "var(--color-bg)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xl)",
        }}
      >
        {/* Step 1: Intro */}
        {step === "intro" && (
          <Card elevation="low" style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <Logo size={36} />
              <h2 style={{ fontSize: "var(--font-size-h2)", margin: 0 }}>EchoIt</h2>
            </div>

            <div>
              <h1
                style={{
                  fontSize: "var(--font-size-h2)",
                  fontFamily: "var(--font-family-headline)",
                  lineHeight: "var(--line-height-heading)",
                  marginBottom: "var(--space-sm)",
                }}
              >
                Your messages stay on your phone. We can&apos;t read them. We don&apos;t want to.
              </h1>
              <p
                style={{
                  color: "var(--color-text-muted)",
                  fontSize: "var(--font-size-body)",
                  lineHeight: "var(--line-height-body)",
                }}
              >
                EchoIt connects you directly to the people you talk with. Conversations live only on
                your device, with no central server recording your history or your contacts.
              </p>
            </div>

            {/* Mandatory At-Rest Disclosure per PRODUCT.md §4.1 */}
            <AlertBanner variant="info" title="Local Storage Security Notice">
              Your chat history is stored locally on this phone. Because message files are not
              encrypted on your device&apos;s disk, someone who gains physical access to your phone might
              be able to read them. We recommend keeping a strong lock screen password or PIN enabled.
            </AlertBanner>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
              <Button size="lg" onClick={handleStartGenerate} iconRight={<ArrowRightIcon size={18} />}>
                Set up as new
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setError(null);
                  setStep("restore");
                }}
              >
                I already have a recovery phrase
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Generate Phrase */}
        {step === "generate" && (
          <Card elevation="low" style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button
                onClick={() => setStep("intro")}
                style={{
                  background: "transparent",
                  border: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-body-sm)",
                  padding: 4,
                }}
              >
                <ArrowLeftIcon size={16} /> Back
              </button>
              <span style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)", fontWeight: 600 }}>
                STEP 1 OF 2
              </span>
            </div>

            <div>
              <h2 style={{ fontSize: "var(--font-size-h2)", fontFamily: "var(--font-family-headline)", marginBottom: 4 }}>
                Your Recovery Phrase
              </h2>
              <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-body-sm)" }}>
                Write down these 12 words in order and store them in a private, safe place. This phrase is the only way to recover your account if you switch devices.
              </p>
            </div>

            {/* 12-Word Journal Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "var(--space-sm)",
                padding: "var(--space-md)",
                backgroundColor: "var(--color-surface-dim)",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
              }}
            >
              {words.map((word, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 8px",
                    backgroundColor: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                    fontFamily: "var(--font-family-mono)",
                    fontSize: "var(--font-size-mono)",
                  }}
                >
                  <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", width: 18, userSelect: "none" }}>
                    {index + 1}.
                  </span>
                  <span style={{ fontWeight: "var(--font-weight-medium)", color: "var(--color-text)" }}>
                    {word}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyPhrase}
                icon={copied ? <CheckIcon size={16} style={{ color: "var(--color-success)" }} /> : <CopyIcon size={16} />}
              >
                {copied ? "Copied to clipboard" : "Copy words"}
              </Button>
            </div>

            <AlertBanner variant="security">
              Never share your recovery phrase with anyone. Anyone with these words can derive your identity and read your conversations.
            </AlertBanner>

            <Button size="lg" onClick={handleProceedToVerify} iconRight={<ArrowRightIcon size={18} />}>
              I&apos;ve written it down
            </Button>
          </Card>
        )}

        {/* Step 3: Verify Phrase */}
        {step === "verify" && (
          <Card elevation="low" style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button
                onClick={() => setStep("generate")}
                style={{
                  background: "transparent",
                  border: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-body-sm)",
                  padding: 4,
                }}
              >
                <ArrowLeftIcon size={16} /> Back
              </button>
              <span style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)", fontWeight: 600 }}>
                STEP 2 OF 2
              </span>
            </div>

            <div>
              <h2 style={{ fontSize: "var(--font-size-h2)", fontFamily: "var(--font-family-headline)", marginBottom: 4 }}>
                Confirm Your Phrase
              </h2>
              <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-body-sm)" }}>
                To make sure you saved your recovery phrase accurately, please enter the requested words below.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              {verifyIndices.map((idx) => (
                <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label
                    htmlFor={`${fieldId}-verify-${idx}`}
                    style={{
                      fontSize: "var(--font-size-body-sm)",
                      fontWeight: "var(--font-weight-medium)",
                      color: "var(--color-text)",
                    }}
                  >
                    Word #{idx + 1}
                  </label>
                  <input
                    id={`${fieldId}-verify-${idx}`}
                    type="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck="false"
                    value={verifyAnswers[idx] || ""}
                    onChange={(e) => {
                      setVerifyAnswers({
                        ...verifyAnswers,
                        [idx]: e.target.value,
                      });
                      setVerifyError(null);
                    }}
                    placeholder={`Enter word #${idx + 1}`}
                    style={{
                      height: 44,
                      padding: "0 14px",
                      backgroundColor: "var(--color-surface)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-md)",
                      fontFamily: "var(--font-family-mono)",
                      fontSize: "var(--font-size-body)",
                      color: "var(--color-text)",
                      outline: "none",
                    }}
                  />
                </div>
              ))}
            </div>

            {verifyError && (
              <span style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-warning)" }}>
                {verifyError}
              </span>
            )}

            {error && (
              <span style={{ fontSize: "var(--font-size-body-sm)", color: "var(--color-warning)" }}>
                {error}
              </span>
            )}

            <Button size="lg" loading={loading} onClick={handleCompleteVerification}>
              Confirm & Start Messaging
            </Button>
          </Card>
        )}

        {/* Step 4: Restore Phrase */}
        {step === "restore" && (
          <Card elevation="low" style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button
                onClick={() => {
                  setError(null);
                  setStep("intro");
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  fontSize: "var(--font-size-body-sm)",
                  padding: 4,
                }}
              >
                <ArrowLeftIcon size={16} /> Back
              </button>
              <span style={{ fontSize: "var(--font-size-label)", color: "var(--color-text-muted)", fontWeight: 600 }}>
                RESTORE
              </span>
            </div>

            <div>
              <h2 style={{ fontSize: "var(--font-size-h2)", fontFamily: "var(--font-family-headline)", marginBottom: 4 }}>
                Enter Recovery Phrase
              </h2>
              <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-body-sm)" }}>
                Enter your 12-word recovery phrase separated by spaces to restore your safe address.
              </p>
            </div>

            <Textarea
              value={restoreInput}
              onChange={(e) => {
                setRestoreInput(e.target.value);
                setError(null);
              }}
              placeholder="e.g. legal winner thank year wave sausage worth useful legal winner thank yellow"
              mono
              rows={4}
              error={error ?? undefined}
            />

            <Button
              size="lg"
              loading={loading}
              onClick={handleRestore}
              disabled={!restoreInput.trim()}
              icon={<KeyIcon size={18} />}
            >
              Restore & Unlock
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
