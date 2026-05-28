const { app, BrowserWindow, shell, ipcMain, Menu, Tray, nativeImage, protocol } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Register custom protocol before app is ready
protocol.registerSchemesAsPrivileged([
    { scheme: 'decentrachat', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// Handle creating/removing shortcuts on Windows when installing/uninstalling
try {
    if (require('electron-squirrel-startup')) {
        app.quit();
    }
} catch (e) {
    // Module not available, ignore
}

// Keep a global reference of the window object
let mainWindow;
let tray = null;
let authServer;
let authResolve = null;
let isQuitting = false; // True only when user explicitly quits from tray or menu

// Auth server port
const AUTH_PORT = 47823;

// Determine if we're in development or production
const isDev = !app.isPackaged;

// Create local auth server to receive wallet connection from browser
function createAuthServer() {
    authServer = http.createServer((req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        if (req.method === 'POST' && pathname === '/auth-callback') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    console.log('Auth received:', data.address);

                    // Send auth data to renderer
                    if (mainWindow) {
                        mainWindow.webContents.send('wallet-auth', data);
                        mainWindow.focus();
                    }

                    if (authResolve) {
                        authResolve(data);
                        authResolve = null;
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (error) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid request' }));
                }
            });
        } else if (req.method === 'GET') {
            // Serve static files for auth flow to work with MetaMask (no file:// protocol)
            let filePath = pathname;
            if (filePath === '/' || filePath === '/auth') {
                filePath = '/auth.html';
            }

            // Secure path resolution
            const safeSuffix = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
            const targetPath = path.join(__dirname, '../dist', safeSuffix);

            // Ensure we are strictly within dist
            if (!targetPath.startsWith(path.join(__dirname, '../dist'))) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            fs.readFile(targetPath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Not Found');
                    return;
                }

                const ext = path.extname(targetPath).toLowerCase();
                const mimeTypes = {
                    '.html': 'text/html',
                    '.js': 'text/javascript',
                    '.css': 'text/css',
                    '.png': 'image/png',
                    '.svg': 'image/svg+xml'
                };

                res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
                res.end(data);
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    authServer.listen(AUTH_PORT, '127.0.0.1', () => {
        console.log(`Auth server running on port ${AUTH_PORT}`);
    });

    authServer.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log('Address in use, retrying...');
            // Optional: retry logic or just log it. Since we have single instance lock, 
            // this usually means a zombie process or another app.
            // We won't crash the app for this anymore.
            console.error(`Port ${AUTH_PORT} is busy. Auth server failed to start.`);
        } else {
            console.error('Auth server error:', e);
        }
    });
}

function createWindow() {
    // Create the browser window with optimized settings
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        frame: true,
        titleBarStyle: 'default',
        backgroundColor: '#0a0a0f',
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true, // Re-enabled for SOP protection
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    // Remove native menu bar — settings are now in-app
    Menu.setApplicationMenu(null);

    // Keep DevTools accessible via keyboard shortcut
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.shift && input.key === 'I') {
            mainWindow.webContents.toggleDevTools();
        }
    });

    // Load the app
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
        // Use custom protocol in production
        mainWindow.loadURL('decentrachat://app/index.html').catch(e => console.error('Failed to load app:', e));
    }

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // Open DevTools to debug black screen issues
        // Open DevTools to debug black screen issues
        // mainWindow.webContents.openDevTools();
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // Minimize to tray instead of closing
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
            // Show tray notification on first minimize
            if (tray && !mainWindow._trayNotified) {
                tray.displayBalloon({
                    title: 'DecentraChat',
                    content: 'App is still running in the background. You will receive messages.',
                    iconType: 'info'
                });
                mainWindow._trayNotified = true;
            }
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// IPC handlers
ipcMain.handle('open-auth-browser', async () => {
    const nonce = Date.now().toString();
    let authUrl;

    if (isDev) {
        authUrl = `http://localhost:5173/auth.html?nonce=${nonce}`;
    } else {
        // In production, serve from local server to support MetaMask
        authUrl = `http://127.0.0.1:${AUTH_PORT}/auth.html?nonce=${nonce}`;
    }

    shell.openExternal(authUrl);

    // Wait for auth callback
    return new Promise((resolve) => {
        authResolve = resolve;
        // Timeout after 5 minutes
        setTimeout(() => {
            if (authResolve === resolve) {
                authResolve = null;
                resolve(null);
            }
        }, 5 * 60 * 1000);
    });
});

ipcMain.handle('get-stored-auth', async () => {
    // This would read from secure storage in production
    return null;
});

ipcMain.handle('flash-frame', (event, flag) => {
    if (mainWindow) {
        mainWindow.flashFrame(flag);
    }
});

ipcMain.handle('app-exit', () => {
    isQuitting = true;
    app.quit();
});

// DPI / display-scaling fix — render at 1× regardless of OS scale factor
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// Performance optimizations
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// Create window when ready
app.whenReady().then(() => {
    // Handle custom protocol
    protocol.handle('decentrachat', (request) => {
        const url = new URL(request.url);
        const filePath = path.join(__dirname, '../dist', url.pathname);
        
        // Security check: Ensure we're only serving from dist
        const normalizedDist = path.normalize(path.join(__dirname, '../dist'));
        const normalizedFile = path.normalize(filePath);
        
        if (!normalizedFile.startsWith(normalizedDist)) {
            return new Response('Access Denied', { status: 403 });
        }

        try {
            const data = fs.readFileSync(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.png': 'image/png',
                '.svg': 'image/svg+xml',
                '.json': 'application/json',
                '.wasm': 'application/wasm'
            };
            return new Response(data, {
                headers: { 'content-type': mimeTypes[ext] || 'application/octet-stream' }
            });
        } catch (e) {
            return new Response('Not Found', { status: 404 });
        }
    });

    // Single Instance Lock
    const gotTheLock = app.requestSingleInstanceLock();

    if (!gotTheLock) {
        app.quit();
        return;
    }

    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    try {
        createAuthServer();
    } catch (err) {
        console.error('Failed to create auth server:', err);
    }

    createWindow();

    // Create system tray
    const iconPath = isDev
        ? path.join(__dirname, '../public/icon.png')
        : path.join(__dirname, '../dist/icon.png');

    let trayIcon;
    try {
        trayIcon = nativeImage.createFromPath(iconPath);
        // Resize for tray (16x16 is standard on Windows)
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
    } catch (e) {
        console.error('Failed to load tray icon:', e);
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('DecentraChat — Running in background');

    const trayMenu = Menu.buildFromTemplate([
        {
            label: 'Open DecentraChat',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setContextMenu(trayMenu);

    // Double-click tray icon to restore window
    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // Check for updates
    if (!isDev) {
        autoUpdater.autoDownload = false;

        autoUpdater.on('error', (err) => {
            console.error('Update error:', err);
            if (mainWindow) {
                mainWindow.webContents.send('update-error', err.message);
            }
        });

        autoUpdater.on('checking-for-update', () => {
            console.log('Checking for updates...');
        });

        autoUpdater.on('update-available', (info) => {
            console.log('Update available:', info);
            if (mainWindow) {
                mainWindow.webContents.send('update-available', info);
            }
        });

        autoUpdater.on('update-not-available', (info) => {
            console.log('Update not available:', info);
            if (mainWindow) {
                mainWindow.webContents.send('update-not-available', info);
            }
        });

        autoUpdater.on('download-progress', (progressObj) => {
            if (mainWindow) {
                mainWindow.webContents.send('update-progress', progressObj);
            }
        });

        autoUpdater.on('update-downloaded', (info) => {
            if (mainWindow) {
                mainWindow.webContents.send('update-downloaded', info);
            }
        });

        ipcMain.handle('check-for-updates', () => {
            autoUpdater.checkForUpdates();
        });

        ipcMain.handle('download-update', () => {
            autoUpdater.downloadUpdate();
        });

        ipcMain.handle('install-update', () => {
            autoUpdater.quitAndInstall();
        });

        // Initial check
        autoUpdater.checkForUpdates();
    }
});

// Don't quit when all windows are closed — app lives in tray
app.on('window-all-closed', () => {
    // On macOS, apps typically stay active until explicitly quit
    // On Windows/Linux, we keep running in tray
    // Only quit if isQuitting is true (set by tray menu or app-exit IPC)
    if (isQuitting) {
        if (authServer) {
            authServer.close();
        }
        app.quit();
    }
});

// Ensure clean quit
app.on('before-quit', () => {
    isQuitting = true;
    if (authServer) {
        authServer.close();
    }
    if (tray) {
        tray.destroy();
        tray = null;
    }
});
