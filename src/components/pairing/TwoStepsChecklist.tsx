import { CheckIcon, ClockIcon, ShareIcon, ShieldIcon } from "../ui/Icons";
import { Button } from "../ui/Button";

export type PairingState = "unilateral_waiting" | "unilateral_pending" | "bilateral_connected";

export interface TwoStepsChecklistProps {
  pairingState: PairingState;
  peerName: string;
  peerDid?: string;
  onShareTicket?: () => void;
  onConnectBack?: () => void;
  variant?: "card" | "banner" | "compact";
  style?: React.CSSProperties;
}

export function TwoStepsChecklist({
  pairingState,
  peerName,
  onShareTicket,
  onConnectBack,
  variant = "card",
  style,
}: TwoStepsChecklistProps) {
  const isConnected = pairingState === "bilateral_connected";
  const isWaiting = pairingState === "unilateral_waiting";
  const isPending = pairingState === "unilateral_pending";

  const step1Done = true;
  const step2Done = isConnected;

  const step1Label = isPending
    ? `${peerName} connected to your device`
    : `You added ${peerName}'s ticket`;

  const step2Label = isPending
    ? `Pending your acceptance`
    : isWaiting
    ? `Waiting for ${peerName} to connect back`
    : `${peerName} added you`;

  const primaryCopy = isConnected
    ? "Connected directly"
    : isWaiting
    ? `Waiting for ${peerName} to connect back.`
    : `${peerName} wants to connect with you.`;

  const explanatoryCopy = isConnected
    ? "Messages are moving safely, directly between your phones."
    : isWaiting
    ? `You've added ${peerName}, but they haven't added you yet. To start messaging, ${peerName} needs to scan your ticket or copy your connection link.`
    : `Once you accept their ticket, you will be able to exchange messages directly. No messages can be delivered until you connect back.`;

  if (variant === "compact") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: "var(--font-size-label)",
          color: isConnected ? "var(--color-success)" : "var(--color-primary)",
          ...style,
        }}
      >
        {isConnected ? (
          <>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: "var(--color-success)",
                display: "inline-block",
              }}
            />
            <span>Connected directly</span>
          </>
        ) : (
          <>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                border: "1.5px dashed var(--color-primary)",
                display: "inline-block",
              }}
            />
            <span>{isWaiting ? "Waiting for them" : "Pending acceptance"}</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "var(--space-md) var(--space-lg)",
        backgroundColor: isConnected
          ? "var(--color-surface)"
          : isWaiting
          ? "var(--color-primary-subtle)"
          : "var(--color-surface-dim)",
        border: `1px ${isConnected ? "solid" : "dashed"} ${
          isConnected
            ? "var(--color-border)"
            : isWaiting
            ? "var(--color-primary)"
            : "var(--color-border)"
        }`,
        borderRadius: "var(--radius-lg)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-md)",
        boxShadow: "var(--shadow-low)",
        ...style,
      }}
    >
      {/* Header with status */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "var(--radius-full)",
            backgroundColor: isConnected
              ? "var(--color-surface-dim)"
              : "var(--color-surface)",
            border: `1px solid ${isConnected ? "var(--color-border)" : "var(--color-primary)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: isConnected ? "var(--color-success)" : "var(--color-primary)",
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          {isConnected ? <ShieldIcon size={16} /> : <ClockIcon size={16} />}
        </div>
        <div style={{ flex: 1 }}>
          <h4
            style={{
              fontSize: "var(--font-size-body)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text)",
              margin: "0 0 4px",
            }}
          >
            {primaryCopy}
          </h4>
          <p
            style={{
              fontSize: "var(--font-size-body-sm)",
              color: "var(--color-text-muted)",
              lineHeight: "var(--line-height-body-sm)",
              margin: 0,
            }}
          >
            {explanatoryCopy}
          </p>
        </div>
      </div>

      {/* Two Steps Explicit Checklist */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
          padding: "var(--space-sm) var(--space-md)",
          backgroundColor: "var(--color-surface)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            fontSize: "var(--font-size-label)",
            fontWeight: "var(--font-weight-semibold)",
            color: "var(--color-text-muted)",
            letterSpacing: "0.04em",
            marginBottom: 2,
          }}
        >
          TWO-WAY CONNECTION STEPS
        </div>

        {/* Step 1 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "var(--font-size-body-sm)",
            color: step1Done ? "var(--color-text)" : "var(--color-text-muted)",
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              backgroundColor: "var(--color-success)",
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <CheckIcon size={12} />
          </div>
          <span>{step1Label}</span>
        </div>

        {/* Step 2 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "var(--font-size-body-sm)",
            color: step2Done ? "var(--color-text)" : "var(--color-text-muted)",
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              backgroundColor: step2Done
                ? "var(--color-success)"
                : "var(--color-surface-dim)",
              border: step2Done ? "none" : "1px dashed var(--color-primary)",
              color: step2Done ? "#FFFFFF" : "var(--color-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {step2Done ? <CheckIcon size={12} /> : <ClockIcon size={12} />}
          </div>
          <span>{step2Label}</span>
        </div>
      </div>

      {/* Action buttons if incomplete */}
      {!isConnected && (
        <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: 2 }}>
          {isWaiting && onShareTicket && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onShareTicket}
              icon={<ShareIcon size={14} />}
            >
              Share My Ticket
            </Button>
          )}
          {isPending && onConnectBack && (
            <Button
              variant="primary"
              size="sm"
              onClick={onConnectBack}
            >
              Connect with {peerName}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
