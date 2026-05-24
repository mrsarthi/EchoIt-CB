// Web3 Provider - Ethereum wallet integration
import { BrowserProvider } from 'ethers';

let provider = null;
let signer = null;

/**
 * Check if MetaMask or another Web3 wallet is available
 * @returns {boolean}
 */
export function isWeb3Available() {
    return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
}

/**
 * Connect to the user's Ethereum wallet
 * @returns {Promise<Object>} { address, provider, signer }
 */
export async function connectWallet() {
    if (!isWeb3Available()) {
        throw new Error('No Ethereum wallet detected. Please install MetaMask!');
    }

    // Force account selection popup by requesting permissions
    // This makes MetaMask show the account picker every time
    await window.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }]
    });

    // Now get the selected account
    await window.ethereum.request({ method: 'eth_requestAccounts' });

    provider = new BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    const address = await signer.getAddress();

    return { address, provider, signer };
}

/**
 * Get the current connected wallet address
 * @returns {Promise<string|null>}
 */
export async function getConnectedAddress() {
    if (!isWeb3Available()) return null;

    try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        return accounts.length > 0 ? accounts[0] : null;
    } catch {
        return null;
    }
}

/**
 * Sign a message with the connected wallet
 * @param {string} message - Message to sign
 * @returns {Promise<string>} The signature
 */
export async function signMessage(message) {
    if (!signer) {
        if (isWeb3Available()) {
            provider = new BrowserProvider(window.ethereum);
            signer = await provider.getSigner();
        } else {
            throw new Error('Wallet not connected');
        }
    }

    return await signer.signMessage(message);
}

/**
 * Get the current provider
 * @returns {BrowserProvider|null}
 */
export function getProvider() {
    return provider;
}

/**
 * Get the current signer
 * @returns {JsonRpcSigner|null}
 */
export function getSigner() {
    return signer;
}

/**
 * Listen for account changes
 * @param {Function} callback - Called with new address when account changes
 */
export function onAccountChange(callback) {
    if (isWeb3Available()) {
        window.ethereum.on('accountsChanged', (accounts) => {
            callback(accounts.length > 0 ? accounts[0] : null);
        });
    }
}

/**
 * Listen for network changes
 * @param {Function} callback - Called with new chainId when network changes
 */
export function onNetworkChange(callback) {
    if (isWeb3Available()) {
        window.ethereum.on('chainChanged', (chainId) => {
            callback(chainId);
        });
    }
}

/**
 * Get current network info
 * @returns {Promise<Object>} { chainId, name }
 */
export async function getNetworkInfo() {
    if (!provider) {
        throw new Error('Wallet not connected');
    }

    const network = await provider.getNetwork();
    return {
        chainId: network.chainId.toString(),
        name: network.name,
    };
}

/**
 * Format an Ethereum address for display
 * @param {string} address - Full address
 * @returns {string} Shortened address (e.g., "0x1234...abcd")
 */
export function formatAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
