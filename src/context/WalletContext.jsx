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
    unlockKeys
} from '../crypto/keyManager';
import { register as registerUser } from '../services/socketService';
import { platform, openAuthBrowser, onWalletAuth } from '../services/platformService';
import PINModal from '../components/PINModal';

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
    const [authMode, setAuthMode] = useState(isElectron ? 'electron' : 'browser');

    // --- Task 8: PIN State ---
    const [showPINModal, setShowPINModal] = useState(false);
    const [isPINSetup, setIsPINSetup] = useState(false);
    const [pendingAuthData, setPendingAuthData] = useState(null);
    const [pinError, setPinError] = useState(null);

    // Check for existing connection on mount
    useEffect(() => {
        const init = async () => {
            if (isElectron) {
                // In Electron, check stored auth
                setIsWeb3Detected(true); // Always show connect button in Electron

                // Listen for auth from browser
                onWalletAuth(async (data) => {
                    console.log('Received wallet auth:', data.address);
                    // For Electron auth relay, we might need a PIN if it's new
                    const exists = await hasStoredKeys();
                    if (!exists) {
                        setPendingAuthData({ type: 'electron_auth', data });
                        setIsPINSetup(true);
                        setShowPINModal(true);
                    } else {
                        await handleElectronAuth(data);
                    }
                });

                // Check for existing stored keys
                const exists = await hasStoredKeys();
                if (exists) {
                    const decrypted = await getStoredKeys();
                    if (!decrypted) {
                        setShowPINModal(true); // Need to unlock
                        setIsPINSetup(false);
                    } else {
                        checkStoredKeys();
                    }
                }
            } else {
                // In browser, check MetaMask
                setIsWeb3Detected(isWeb3Available());
                
                const exists = await hasStoredKeys();
                if (exists) {
                    const decrypted = await getStoredKeys();
                    if (!decrypted) {
                        setShowPINModal(true);
                        setIsPINSetup(false);
                    } else {
                        checkBrowserConnection();
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
    }, []);

    const checkStoredKeys = async () => {
        const storedKeys = await getStoredKeys();
        if (storedKeys) {
            setKeys(storedKeys);
            setAddress(storedKeys.address);
            setIsConnected(true);

            registerUser(storedKeys.address, storedKeys.publicKey, null, null, null, signMessage);
            console.log('🔄 Re-registered presence for:', storedKeys.address);
        }
    };

    const checkBrowserConnection = async () => {
        const existingAddress = await getConnectedAddress();
        if (existingAddress) {
            setAddress(existingAddress);
            const storedKeys = await getStoredKeys();
            if (storedKeys) {
                setKeys(storedKeys);
                setIsConnected(true);

                registerUser(existingAddress, storedKeys.publicKey, null, null, null, signMessage);
                console.log('🔄 Re-registered presence for:', existingAddress);
            }
        }
    };

    const activeAuthSessionIdRef = useRef(null);

    const handleElectronAuth = async (data, pin = null) => {
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
                } catch (err) {
                    setError('Security Error: Invalid signature format.');
                    setIsConnecting(false);
                    return;
                }
            }

            // Derive keys from the signature
            const encryptionKeys = await storeKeysFromSignature(data.address, data.signature, pin);
            setKeys(encryptionKeys);
            setAddress(data.address);

            registerUser(data.address, encryptionKeys.publicKey);

            setIsConnected(true);
            setIsConnecting(false);
            setShowPINModal(false);
            setPendingAuthData(null);
            console.log('✅ Mobile Auth successful:', data.address);
        } catch (err) {
            setError(err.message);
            setIsConnecting(false);
        }
    };

    const handlePINSubmit = async (pin) => {
        setPinError(null);
        try {
            if (isPINSetup) {
                // We are setting up a new PIN during a connection flow
                if (pendingAuthData) {
                    if (pendingAuthData.type === 'browser_connect') {
                        const { walletAddress } = pendingAuthData;
                        const encryptionKeys = await getOrCreateKeys(walletAddress, signMessage, pin);
                        setKeys(encryptionKeys);
                        registerUser(walletAddress, encryptionKeys.publicKey, null, null, null, signMessage);
                        setIsConnected(true);
                        setIsConnecting(false);
                        setShowPINModal(false);
                        setPendingAuthData(null);
                    } else if (pendingAuthData.type === 'electron_auth') {
                        await handleElectronAuth(pendingAuthData.data, pin);
                    }
                }
            } else {
                // We are unlocking existing keys
                const unlocked = await unlockKeys(pin);
                if (unlocked) {
                    setKeys(unlocked);
                    setAddress(unlocked.address);
                    setIsConnected(true);
                    setShowPINModal(false);
                    
                    // Re-register presence
                    registerUser(unlocked.address, unlocked.publicKey, null, null, null, signMessage);
                }
            }
        } catch (err) {
            setPinError('Incorrect PIN. Please try again.');
        }
    };

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
                // Standard browser MetaMask flow
                const { address: walletAddress } = await browserConnectWallet();
                setAddress(walletAddress);

                const exists = await hasStoredKeys();
                if (!exists) {
                    setPendingAuthData({ type: 'browser_connect', walletAddress });
                    setIsPINSetup(true);
                    setShowPINModal(true);
                } else {
                    // Try to unlock (this should have been triggered by mount effect if keys existed)
                    const decrypted = await getStoredKeys();
                    if (!decrypted) {
                        setPendingAuthData({ type: 'browser_connect', walletAddress });
                        setIsPINSetup(false);
                        setShowPINModal(true);
                    } else {
                        const encryptionKeys = await getOrCreateKeys(walletAddress, signMessage);
                        setKeys(encryptionKeys);
                        registerUser(walletAddress, encryptionKeys.publicKey, null, null, null, signMessage);
                        setIsConnected(true);
                        setIsConnecting(false);
                    }
                }
            }
        } catch (err) {
            setError(err.message);
            setIsConnecting(false);
        }
    }, []);

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
        authMode,
        isElectron,
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
