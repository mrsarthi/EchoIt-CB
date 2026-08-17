import { Buffer } from "buffer";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
