import { useState, useEffect } from "react";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { AlertBanner } from "../ui/AlertBanner";
import { parseAndValidateTicket } from "../../services/pairing-store";
import { useApp } from "../../context/AppContext";

export interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTicket?: string;
  initialName?: string;
  onConnect: (ticketString: string, name: string) => Promise<void>;
}

export function AddContactModal({
  isOpen,
  onClose,
  initialTicket = "",
  initialName = "",
  onConnect,
}: AddContactModalProps) {
  const { did } = useApp();
  const [ticketInput, setTicketInput] = useState(initialTicket);
  const [nameInput, setNameInput] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTicketInput(initialTicket);
      setNameInput(initialName);
      setError(null);
      setConnecting(false);
    }
  }, [isOpen, initialTicket, initialName]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);

    const validation = parseAndValidateTicket(ticketInput, did);
    if (validation.error) {
      setError(validation.error);
      return;
    }

    try {
      setConnecting(true);
      // Blank stays blank. Filling it in here is what stopped the peer's own
      // name from ever being shown -- see `localNameOf`.
      await onConnect(ticketInput.trim(), nameInput.trim());
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not connect: ${msg}`);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Contact & Connect"
      subtitle="Paste your friend's connection ticket to establish a direct connection."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={connecting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={connecting}
            onClick={() => void handleSubmit()}
            disabled={!ticketInput.trim()}
          >
            Connect
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        {error && (
          <AlertBanner variant="warning" title="Invalid Ticket">
            {error}
          </AlertBanner>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            htmlFor="ticket-input"
            style={{
              fontSize: "var(--font-size-label)",
              fontWeight: "var(--font-weight-semibold)",
              color: "var(--color-text)",
            }}
          >
            CONNECTION TICKET
          </label>
          <textarea
            id="ticket-input"
            rows={4}
            value={ticketInput}
            onChange={(e) => {
              setTicketInput(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Paste ticket starting with dicsussion1..."
            style={{
              width: "100%",
              fontFamily: "var(--font-family-mono)",
              fontSize: "0.75rem",
              padding: "10px 12px",
              backgroundColor: "var(--color-surface-dim)",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${error ? "var(--color-warning)" : "var(--color-border)"}`,
              color: "var(--color-text)",
              resize: "none",
              outline: "none",
            }}
          />
        </div>

        {/*
          The hint used to say only where the name was stored, which left the
          blank case unexplained -- and blank is the common case. Saying what
          happens instead is what makes leaving it empty a choice.
        */}
        <Input
          label="NAME OR NICKNAME (OPTIONAL)"
          placeholder="e.g. Alice"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          hint="Only you see this, and it is kept on this device. Leave it blank to use the name they chose for themselves."
        />
      </form>
    </Modal>
  );
}
