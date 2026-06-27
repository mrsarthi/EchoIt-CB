import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.decentrachat.app',
    appName: 'Echo Messenger',
    webDir: 'dist',
    server: {
        // Use the bundled web assets (don't connect to a live dev server)
        androidScheme: 'https',
        // Allow the app to open intent:// and external deep links
        allowNavigation: [
            "decentrachat-singnalling.onrender.com",
            "intent://*"
        ]
    },
    plugins: {
        // Keep the status bar overlay so the app feels full-screen
        StatusBar: {
            style: 'DARK',
            backgroundColor: '#0a0a0f',
        },
        // Allow opening MetaMask and external URLs
        Browser: {
            // No extra config needed
        },
        Keyboard: {
            resize: 'body' as unknown as import('@capacitor/keyboard').KeyboardResize,
        },
    },
    android: {
        // Allow mixed content for local assets + remote API calls
        allowMixedContent: true,
        // Append the user agent so the app can detect Capacitor
        appendUserAgent: 'DecentraChat-Android',
    },
};

export default config;
