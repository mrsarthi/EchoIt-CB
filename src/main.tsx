import { Buffer } from "buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { runPendingReset } from "./services/pending-reset";

if (typeof window !== "undefined") {
  const origFrom = Buffer.from.bind(Buffer);
  (Buffer as unknown as { from: Function }).from = function (str: any, enc?: string, length?: number) {
    if (enc === 'base64url' && typeof str === 'string') {
      let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4 !== 0) base64 += '=';
      return origFrom(base64, 'base64');
    }
    return origFrom(str, enc as any, length as any);
  };

  const origToString = Buffer.prototype.toString;
  Buffer.prototype.toString = function (enc?: any, start?: number, end?: number) {
    if (enc === 'base64url') {
      return origToString.call(this, 'base64', start, end)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    }
    return origToString.call(this, enc, start, end);
  };

  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

/**
 * A pending erase must complete before React mounts, because mounting is what
 * opens the database — and an open connection is exactly what blocks the
 * delete. Awaiting here is the whole mechanism, not a precaution.
 */
async function start() {
  const reset = await runPendingReset();
  if (reset.error) {
    // Left deliberately visible. The user was told their history was cleared;
    // if it was not, that is not something to swallow. The flag survives, so
    // the next launch tries again.
    console.error("[EchoIt] pending reset did not complete: " + reset.error);
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
