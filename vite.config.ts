import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const shim = (name: string) =>
  fileURLToPath(new URL(`./src/shims/${name}`, import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Automerge ships as WASM; the plugin is what lets Rollup embed it.
  plugins: [react(), wasm()],

  build: {
    // Automerge's WASM glue uses top-level await, which is ES2022. Targeting
    // it natively avoids vite-plugin-top-level-await, whose dependency tree
    // currently fails `npm audit`.
    target: "es2022",
  },

  optimizeDeps: {
    // Do not let esbuild pre-bundle the SDK.
    //
    // In dev, Vite pre-bundles registry dependencies into node_modules/.vite
    // with esbuild, which does NOT apply the relative-path aliases below.
    // The result is a chunk whose shimmed modules have no named exports:
    //   SyntaxError: Export 'import_datagram_socket' is not defined in module
    //
    // Excluding these makes dev resolve them the same way `vite build` does.
    // This did not bite while the packages were symlinked via `file:` — npm
    // links are served as source rather than pre-bundled — so it only
    // appeared on the move to the published packages.
    exclude: ["@dicsussion/sdk", "@dicsussion/core"],

    // Excluding the SDK above also stops Vite pre-bundling the CommonJS
    // packages it depends on, and a browser cannot `import CRC32 from
    // 'crc-32'` when the target is CJS:
    //   SyntaxError: does not provide an export named 'default'
    //
    // These three are the only CJS dependencies in the tree; everything else
    // (@noble/*, @automerge/*, multiformats, uuid) is already ESM. Listing
    // them explicitly makes Vite convert them while leaving the SDK itself
    // un-bundled.
    include: ["crc-32", "lz4js", "poseidon-lite"],
  },

  resolve: {
    alias: {
      // Everything else that used to be shimmed here is now handled upstream.
      // `@dicsussion/core@0.1.1` and `@dicsussion/sdk@0.1.1` ship real
      // `browser` export conditions pointing at variant barrels that export
      // the same names, which is what the `browser: false` mapping could not
      // do. Removing those aliases is verified in dev AND build, because the
      // two use different resolvers and passing one proves nothing about the
      // other.
      //
      // These two remain: the SDK still reaches for Node's EventEmitter and
      // Buffer, and `events` / `buffer` are faithful polyfills.
      "node:events": "events",
      "node:buffer": "buffer",
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
