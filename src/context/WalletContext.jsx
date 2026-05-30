// WalletContext - Shared wallet state across the app
// Supports browser (MetaMask), Electron (hybrid), and Capacitor (mobile) authentication
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import {
    connectWallet as browserConnectWallet,
    getConnectedAddress,
    signMessage,
    formatAddress,
    onAccountChange,
    isWeb3Available,
} from '../blockchain/web3Provider';
import { 
    getOrCreateKeys, 
    clearKeys, 
    getStoredKeys, 
    storeKeysFromSignature,
    hasStoredKeys,
    unlockKeys,
    getStoredWalletAddress
} from '../crypto/keyManager';
import { register as registerUser } from '../services/socketService';
import { platform, openAuthBrowser, onWalletAuth } from '../services/platformService';
import { initPushNotifications } from '../services/pushService';
import { setStorageSessionKey } from '../services/storageEncryption';

import PINModal from '../components/PINModal';
import { hashArgon2 } from '../crypto/argon2Client';

const WalletContext = createContext(null);

// Check if running in a native app shell (Electron or Capacitor)
const isElectron = platform.isNativeApp;

export function WalletProvider({ children }) {
    const [address, setAddress] = useState(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState(null);
    const [keys, setKeys] = useState(null);
    const [isWeb3Detected, setIsWeb3Detected] = useState(false);
    const [isSolvingPoW, setIsSolvingPoW] = useState(false);
    const [pushToken, setPushToken] = useState(null);

    const [showPINModal, setShowPINModal] = useState(false);
    const [isPINSetup, setIsPINSetup] = useState(false);
    const [pendingAuthData, setPendingAuthData] = useState(null);
    const [pinError, setPinError] = useState(null);

    const activeAuthSessionIdRef = useRef(null);

    const solveProofOfWork = async (challenge, addr) => {
        const saltAddr = addr || address || 'default_salt';
        setIsSolvingPoW(true);
        try {
            const hash = await hashArgon2(challenge, saltAddr.slice(0, 16));
            return hash;
        } finally {
            setIsSolvingPoW(false);
        }
    };

    const handleElectronAuth = useCallback(async (data, pin = null) => {
        try {
            setError(null);
            setIsConnecting(true);

            if (data.sessionId || activeAuthSessionIdRef.current) {
                const sessionId = data.sessionId || activeAuthSessionIdRef.current;
                const expectedMessage = `Authorize DecentraChat Auth: ${sessionId}`;
                try {
                    const recovered = ethers.verifyMessage(expectedMessage, data.signature);
                    if (recovered.toLowerCase() !== data.address.toLowerCase()) {
                        setError('Security Error: Auth signature mismatch. Aborting.');
                        setIsConnecting(false);
                        return;
                    }
                } catch {
                    setError('Security Error: Invalid signature format.');
                    setIsConnecting(false);
                    return;
                }
            }

            const encryptionKeys = await storeKeysFromSignature(data.address, data.signature, pin);
            setKeys(encryptionKeys);
            setAddress(data.address);
            setIsConnected(true);
            setIsConnecting(false);
            setShowPINModal(false);
            setPendingAuthData(null);
        } catch (err) {
            setError(err.message);
            setIsConnecting(false);
        }
    }, [pushToken]);

    const handlePINSubmit = async (pin) => {
        setPinError(null);
        try {
            // Get the wallet address for consistent salt derivation
            let saltAddress = address;
            if (!saltAddress) {
                if (pendingAuthData) {
                    saltAddress = pendingAuthData.walletAddress || pendingAuthData.data?.address;
                }
                if (!saltAddress) {
                    saltAddress = await getStoredWalletAddress();
                }
            }
            // 🛡️ Step 4: Derive and set storage session key (Argon2)
            await setStorageSessionKey(pin, saltAddress);
            
            // 🛡️ Step 5: Derive a robust Argon2 hash for the volatile crypto session key
            // This key is used for encrypting DR sessions and Pre-Key secrets in IndexedDB
            const b64Key = await hashArgon2(pin, saltAddress.slice(0, 16));


            if (isPINSetup) {
                if (pendingAuthData) {
                    if (pendingAuthData.type === 'browser_connect') {
                        const { walletAddress } = pendingAuthData;
                        const encryptionKeys = await getOrCreateKeys(walletAddress, signMessage, pin);
                        setKeys(encryptionKeys);
                        setIsConnected(true);
                        setIsConnecting(false);
                        setShowPINModal(false);
                        setPendingAuthData(null);
                    } else if (pendingAuthData.type === 'electron_auth') {
                        await handleElectronAuth(pendingAuthData.data, pin);
                    }
                }
            } else {
                const unlocked = await unlockKeys(pin);
                if (unlocked) {
                    setKeys(unlocked);
                    setAddress(unlocked.address);
                    setIsConnected(true);
                    setShowPINModal(false);
                }
            }
        } catch (err) {
            console.error('❌ PIN Submit failed with error:', err);
            setPinError('Incorrect PIN. Please try again.');
        }
    };

    const checkBrowserConnection = useCallback(async () => {
        const existingAddress = await getConnectedAddress();
        if (existingAddress) {
            setAddress(existingAddress);
            const storedKeys = await getStoredKeys();
            if (storedKeys) {
                setKeys(storedKeys);
                setIsConnected(true);
            }
        }
    }, [pushToken]);

    useEffect(() => {
        const init = async () => {
            if (platform.isNativeApp) {
                initPushNotifications(
                    (token) => {
                        setPushToken(token);
                    },
                    () => {
                        console.log('📲 Silent push received');
                    }
                );
            }

            if (isElectron) {
                setIsWeb3Detected(true);
                onWalletAuth(async (data) => {
                    const exists = await hasStoredKeys();
                    if (!exists) {
                        setPendingAuthData({ type: 'electron_auth', data });
                        setIsPINSetup(true);
                        setShowPINModal(true);
                    } else {
                        await handleElectronAuth(data);
                    }
                });

                const exists = await hasStoredKeys();
                if (exists) {
                    const decrypted = await getStoredKeys();
                    if (!decrypted) {
                        setShowPINModal(true); 
                        setIsPINSetup(false);
                    } else {
                        setKeys(decrypted);
                        setAddress(decrypted.address);
                        setIsConnected(true);
                    }
                }
            } else {
                setIsWeb3Detected(isWeb3Available());
                const exists = await hasStoredKeys();
                if (exists) {
                    const decrypted = await getStoredKeys();
                    if (!decrypted) {
                        setShowPINModal(true);
                        setIsPINSetup(false);
                    } else {
                        setKeys(decrypted);
                        setAddress(decrypted.address);
                        setIsConnected(true);
                    }
                } else {
                    checkBrowserConnection();
                }

                onAccountChange((newAddress) => {
                    if (newAddress !== address) {
                        setAddress(newAddress);
                        if (!newAddress) {
                            setIsConnected(false);
                            setKeys(null);
                        }
                    }
                });
            }
        };
        init();
    }, [handleElectronAuth, checkBrowserConnection, pushToken, address]);

    const handleAppDataReset = async () => {
        await clearKeys();
        window.location.reload();
    };

    const connect = useCallback(async () => {
        setIsConnecting(true);
        setError(null);
        try {
            if (isElectron) {
                const authResult = await openAuthBrowser();
                if (authResult && authResult.sessionId) {
                    activeAuthSessionIdRef.current = authResult.sessionId;
                    const exists = await hasStoredKeys();
                    if (!exists) {
                        setPendingAuthData({ type: 'electron_auth', data: authResult });
                        setIsPINSetup(true);
                        setShowPINModal(true);
                    } else {
                        await handleElectronAuth(authResult);
                    }
                } else {
                    setError('Authentication timed out. Please try again.');
                    setIsConnecting(false);
                }
            } else {
                const { address: walletAddress } = await browserConnectWallet();
                setAddress(walletAddress);
                const exists = await hasStoredKeys();
                if (!exists) {
                    setPendingAuthData({ type: 'browser_connect', walletAddress });
                    setIsPINSetup(true);
                    setShowPINModal(true);
                } else {
                    const decrypted = await getStoredKeys();
                    if (!decrypted) {
                        setPendingAuthData({ type: 'browser_connect', walletAddress });
                        setIsPINSetup(false);
                        setShowPINModal(true);
                    } else {
                        const encryptionKeys = await getOrCreateKeys(walletAddress, signMessage);
                        setKeys(encryptionKeys);
                        setIsConnected(true);
                        setIsConnecting(false);
                    }
                }
            }
        } catch (err) {
            setError(err.message);
            setIsConnecting(false);
        }
    }, [handleElectronAuth, pushToken]);

    const disconnect = useCallback(async () => {
        await clearKeys();
        setAddress(null);
        setKeys(null);
        setIsConnected(false);
    }, []);

    const value = {
        address,
        formattedAddress: formatAddress(address),
        isConnecting,
        isConnected,
        error,
        keys,
        isWeb3Detected,
        isElectron,
        isSolvingPoW,
        pushToken,
        connect,
        disconnect,
    };

    return (
        <WalletContext.Provider value={value}>
            {children}
            {showPINModal && (
                <PINModal 
                    isSetup={isPINSetup} 
                    onSubmit={handlePINSubmit} 
                    onReset={handleAppDataReset}
                    error={pinError}
                />
            )}
        </WalletContext.Provider>
    );
}

export function useWallet() {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
}
