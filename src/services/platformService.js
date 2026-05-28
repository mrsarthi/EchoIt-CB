// Platform Service — unified abstraction over Electron / Capacitor / Browser
// All platform-specific calls go through this module.

import { Capacitor } from '@capacitor/core';

// ─── Platform Detection ────────────────────────────────────────
const _isElectron =
    typeof window !== 'undefined' && !!window.electronAPI?.isElectron;

const _isCapacitor =
    typeof window !== 'undefined' && Capacitor.isNativePlatform();

const _isBrowser = !_isElectron && !_isCapacitor;

// Are we running inside a "native" shell (Electron or Capacitor)?
const _isNativeApp = _isElectron || _isCapacitor;

export const platform = {
    type: _isElectron ? 'electron' : _isCapacitor ? 'capacitor' : 'browser',
    isElectron: _isElectron,
    isCapacitor: _isCapacitor,
    isBrowser: _isBrowser,
    isNativeApp: _isNativeApp,
};

// ─── Wallet / Auth ─────────────────────────────────────────────

let _walletAuthCallback = null;

/**
 * Open the system browser for MetaMask wallet authentication.
 *  - Electron  → uses IPC to open default browser + local auth server
 *  - Capacitor → uses @capacitor/browser to open MetaMask mobile deeplink
 *  - Browser   → no-op (MetaMask is available in-page)
 */
export async function openAuthBrowser() {
    if (_isElectron) {
        return window.electronAPI.openAuthBrowser();
    }

    if (_isCapacitor) {
        const { Browser } = await import('@capacitor/browser');
        const { listenForAuth } = await import('./socketService');

        // To use MetaMask on mobile, the DApp URL must be publicly accessible.
        // We use the signaling server since we just configured it to host auth.html.
        const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://decentrachat-singnalling.onrender.com';

        // Generate a random session ID for the WebSocket relay
        const sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const authHostUrl = SERVER_URL + '/auth.html?nonce=' + Date.now() + '&platform=capacitor&session=' + sessionId;

        // MetaMask requires the full URL to be properly encoded for its dapp deep links
        const encodedUrl = encodeURIComponent(authHostUrl);

        // 1. Try the official Universal Link (used as a fallback to trigger Play Store download)
        const metamaskUniversalLink = `https://metamask.app.link/dapp/${authHostUrl}`;

        // 2. Try the classic dapp:// link natively via AppLauncher
        // dapp:// requires the protocol stripped
        const cleanAuthUrl = authHostUrl.replace(/^https?:\/\//, '');
        const metamaskClassicLink = `dapp://${cleanAuthUrl}`;

        // Pre-listen to the socket room BEFORE launching the browser
        const authPromise = listenForAuth(sessionId);

        try {
            // Import the newly installed AppLauncher
            const { AppLauncher } = await import('@capacitor/app-launcher');

            // Raw-fire the intent to Android. This breaks out of the WebView completely and goes straight to PackageManager.
            // If MetaMask is installed, it opens. If not, this throws an error.
            await AppLauncher.openUrl({ url: metamaskClassicLink });
        } catch (e) {
            console.warn("App launcher failed (MetaMask likely not installed), failing over to website...", e);
            try {
                // Fallback to the web link so they can be routed to the Play Store
                await Browser.open({ url: metamaskUniversalLink, windowName: '_system' });
            } catch (err) {
                console.error("All deep links failed", err);
            }
        }

        // Wait for the websocket to deliver the signature!
        try {
            const result = await authPromise;
            if (_walletAuthCallback) {
                _walletAuthCallback({ address: result.address, signature: result.signature, sessionId });
            }
            return { ...result, sessionId };
        } catch (e) {
            console.error("WebSocket auth error", e);
            return null;
        }
    }

    return null; // browser — no separate auth needed
}

/**
 * Returns the currently running version.
 * - Electron: package.json (via Vite __APP_VERSION__)
 * - Capacitor: Checks Capgo's active bundle version first, falls back to native build.gradle
 * - Browser: package.json
 */
export async function getCurrentAppVersion() {
    if (_currentResolvedVersion) return _currentResolvedVersion;

    let baseVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

    if (_isCapacitor) {
        // Android natively reads from build.gradle via Vite injection
        baseVersion = typeof __ANDROID_VERSION__ !== 'undefined' ? __ANDROID_VERSION__ : '0.0.0';
    }

    _currentResolvedVersion = baseVersion;
    return baseVersion;
}

export function setupUpdateListeners(handlers) {
    if (_isElectron) {
        window.electronAPI.onUpdateAvailable(handlers.onAvailable);
        window.electronAPI.onUpdateProgress(handlers.onProgress);
        window.electronAPI.onUpdateDownloaded(handlers.onDownloaded);
        window.electronAPI.onUpdateError(handlers.onError);
        window.electronAPI.onUpdateNotAvailable(handlers.onNotAvailable);
        return;
    }

    if (_isCapacitor) {
        // For Capacitor, we use the internal _capEmit mechanism
        _capUpdateCallbacks.onAvailable.push(handlers.onAvailable);
        _capUpdateCallbacks.onProgress.push(handlers.onProgress);
        _capUpdateCallbacks.onDownloaded.push(handlers.onDownloaded);
        _capUpdateCallbacks.onError.push(handlers.onError);
        _capUpdateCallbacks.onNotAvailable.push(handlers.onNotAvailable);
        return;
    }
}

/**
 * Listen for wallet auth data coming back after the browser auth flow.
 *  - Electron  → IPC event from the local auth server
 *  - Capacitor → App URL open event (deep link)
 *  - Browser   → no-op
 */
export function onWalletAuth(callback) {
    if (_isElectron) {
        window.electronAPI.onWalletAuth(callback);
        return;
    }

    if (_isCapacitor) {
        _walletAuthCallback = callback; // save callback for the WebSocket relay
        import('@capacitor/app').then(({ App }) => {
            App.addListener('appUrlOpen', (event) => {
                try {
                    const url = new URL(event.url);
                    const address = url.searchParams.get('address');
                    const signature = url.searchParams.get('signature');
                    if (address && signature && _walletAuthCallback) {
                        _walletAuthCallback({ address, signature });
                    }
                } catch (e) {
                    console.error('Failed to parse auth deep link:', e);
                }
            });
        });
        return;
    }
    // browser — nothing to listen for
}

// ─── UI helpers ────────────────────────────────────────────────

/**
 * Flash the window / provide haptic feedback to get user attention.
 */
export async function notifyUser() {
    if (_isElectron && window.electronAPI?.flashFrame) {
        window.electronAPI.flashFrame(true);
        return;
    }

    if (_isCapacitor) {
        try {
            const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
            await Haptics.impact({ style: ImpactStyle.Medium });
        } catch {
            // Haptics not available — ignore
        }
        return;
    }
}

/**
 * Exit the application.
 */
export async function appExit() {
    if (_isElectron && window.electronAPI?.appExit) {
        window.electronAPI.appExit();
        return;
    }

    if (_isCapacitor) {
        const { App } = await import('@capacitor/app');
        await App.exitApp();
        return;
    }
}

// ─── Update System ─────────────────────────────────────────────
// Electron:   uses electron-updater IPC
// Capacitor:  OTA web bundle downloads via Capgo CapacitorUpdater
// Browser:    no updates

const GITHUB_API_LATEST_RELEASE = 'https://api.github.com/repos/mrsarthi/Dicsussion-app/releases/tags/Production';

// ── Internal state for Capacitor updater ──
let _capUpdateCallbacks = {
    onAvailable: [],
    onProgress: [],
    onDownloaded: [],
    onError: [],
    onNotAvailable: [],
};

function _capEmit(event, data) {
    (_capUpdateCallbacks[event] || []).forEach((cb) => cb(data));
}

/**
 * Subscribe to "update available" events.
 * @returns {Function} unsubscribe
 */
export function onUpdateAvailable(callback) {
    if (_isElectron && window.electronAPI?.onUpdateAvailable) {
        return window.electronAPI.onUpdateAvailable(callback);
    }
    if (_isCapacitor) {
        _capUpdateCallbacks.onAvailable.push(callback);
        return () => {
            _capUpdateCallbacks.onAvailable = _capUpdateCallbacks.onAvailable.filter(
                (cb) => cb !== callback
            );
        };
    }
    return () => { };
}

export function onUpdateProgress(callback) {
    if (_isElectron && window.electronAPI?.onUpdateProgress) {
        return window.electronAPI.onUpdateProgress(callback);
    }
    if (_isCapacitor) {
        _capUpdateCallbacks.onProgress.push(callback);
        return () => {
            _capUpdateCallbacks.onProgress = _capUpdateCallbacks.onProgress.filter(
                (cb) => cb !== callback
            );
        };
    }
    return () => { };
}

export function onUpdateDownloaded(callback) {
    if (_isElectron && window.electronAPI?.onUpdateDownloaded) {
        return window.electronAPI.onUpdateDownloaded(callback);
    }
    if (_isCapacitor) {
        _capUpdateCallbacks.onDownloaded.push(callback);
        return () => {
            _capUpdateCallbacks.onDownloaded = _capUpdateCallbacks.onDownloaded.filter(
                (cb) => cb !== callback
            );
        };
    }
    return () => { };
}

export function onUpdateError(callback) {
    if (_isElectron && window.electronAPI?.onUpdateError) {
        return window.electronAPI.onUpdateError(callback);
    }
    if (_isCapacitor) {
        _capUpdateCallbacks.onError.push(callback);
        return () => {
            _capUpdateCallbacks.onError = _capUpdateCallbacks.onError.filter(
                (cb) => cb !== callback
            );
        };
    }
    return () => { };
}

export function onUpdateNotAvailable(callback) {
    if (_isElectron && window.electronAPI?.onUpdateNotAvailable) {
        return window.electronAPI.onUpdateNotAvailable(callback);
    }
    if (_isCapacitor) {
        _capUpdateCallbacks.onNotAvailable.push(callback);
        return () => {
            _capUpdateCallbacks.onNotAvailable =
                _capUpdateCallbacks.onNotAvailable.filter((cb) => cb !== callback);
        };
    }
    return () => { };
}

/**
 * Compare two semver strings.
 * Returns true if remote > local.
 */
function _isNewerVersion(remote, local) {
    const r = remote.replace(/^v/, '').split('.').map(Number);
    const l = local.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((r[i] || 0) > (l[i] || 0)) return true;
        if ((r[i] || 0) < (l[i] || 0)) return false;
    }
    return false;
}

//let _platformType = 'browser';
let _latestZipUrl = null;
let _latestUpdateVersion = null; // Will now hold the ISO timestamp
let _currentResolvedVersion = null;
let _downloadedBundleId = null;

// The Electron bridge provides methods if we're in desktop
// if (window.electronAPI) {
//     _isElectron = true;
//     _platformType = 'electron';
// } else if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
//     _isCapacitor = true;
//     _platformType = 'capacitor';
// }

// Let the OS handle the app boot naturally.
export async function notifyUpdateReady() {
    // No-op for Native APK Strategy
}

/**
 * Check for updates using GitHub Asset Timestamps.
 */
export async function checkForUpdates() {
    if (_isElectron && window.electronAPI?.checkForUpdates) {
        window.electronAPI.checkForUpdates();
        return;
    }

    if (_isCapacitor) {
        try {
            const res = await fetch(GITHUB_API_LATEST_RELEASE, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            // Find the .apk asset attached to the GitHub release
            const apkAsset = data.assets.find(a => a.name.endsWith('.apk'));

            if (!apkAsset) {
                console.log('[NativeUpdater] No .apk asset found on GitHub release.');
                _capEmit('onNotAvailable', {});
                return;
            }

            // Use the GitHub Asset ID as the update key — it changes with every new upload
            const remoteAssetId = String(apkAsset.id);
            const localAssetId = localStorage.getItem('last_installed_asset_id') || '';
            const remoteVersion = data.tag_name || 'v0.0.0';
            const localVersion = await getCurrentAppVersion();

            const isVersionNewer = _isNewerVersion(remoteVersion, localVersion);
            const isSameVersion = remoteVersion.replace(/^v/, '') === localVersion.replace(/^v/, '');

            console.log(`[NativeUpdater] Remote Asset: ${remoteAssetId}, Local Asset: ${localAssetId}`);
            console.log(`[NativeUpdater] Remote Version: ${remoteVersion}, Local Version: ${localVersion}`);

            if (isVersionNewer) {
                // Case 1: Remote version is explicitly newer. Show update banner!
                localStorage.removeItem('last_installed_asset_id'); // Clear old lock to prepare for transition
                _latestZipUrl = apkAsset.browser_download_url;
                _latestUpdateVersion = remoteAssetId;
                _capEmit('onAvailable', { version: remoteVersion.replace(/^v/, '') });
            } 
            else if (isSameVersion) {
                // Case 2: Perfect SemVer match! (User successfully updated and booted).
                // Immediately commit the Remote Asset ID to local storage to permanently break the deadlock loop.
                localStorage.setItem('last_installed_asset_id', remoteAssetId);
                _capEmit('onNotAvailable', {});
            } 
            else {
                // Case 3: Remote version is older (or local was altered). Treat as up-to-date.
                _capEmit('onNotAvailable', {});
            }
        } catch (err) {
            _capEmit('onError', err.message || 'Update check failed');
        }
        return;
    }
}

/**
 * Legacy Download method (Electron).
 */
export async function downloadUpdate() {
    if (_isElectron && window.electronAPI?.downloadUpdate) {
        window.electronAPI.downloadUpdate();
        return;
    }
}

/**
 * Legacy Install method (Electron).
 */
export function installUpdate() {
    if (_isElectron && window.electronAPI?.installUpdate) {
        window.electronAPI.installUpdate();
        return;
    }
}

/**
 * Start Native Android Browser Download.
 */
export function startNativeUpdate() {
    if (_isCapacitor && _latestZipUrl) {
        try {
            // DO NOT save asset ID here — the user hasn't installed yet.
            // The ID will be saved on the next successful version check
            // (i.e. after the user actually installs and relaunches the app).

            // '_system' fires an Android system intent, bypassing the in-app browser.
            // This lets the OS download the APK and trigger the native Package Installer.
            window.open(_latestZipUrl, '_system');

            _capEmit('onDownloaded', {});
        } catch (err) {
            console.error('Failed to open system browser for update', err);
            _capEmit('onError', 'Failed to open system updater.');
        }
    }
}

/**
 * Whether the update system is available on this platform.
 */
export const hasUpdateSupport = _isElectron || _isCapacitor;
