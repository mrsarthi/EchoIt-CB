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
 * @returns {Promise<Object>} { address }
 */
export async function connectWallet() {
  if (!isWeb3Available()) {
    throw new Error('No Ethereum wallet detected. Please install MetaMask or open inside a Web3 browser.');
  }

  // Request permissions to show account selection popup
  try {
    await window.ethereum.request({
      method: 'wallet_requestPermissions',
      params: [{ eth_accounts: {} }]
    });
  } catch (err) {
    console.warn("wallet_requestPermissions rejected, falling back to eth_requestAccounts", err);
  }

  // Get selected account
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (accounts.length === 0) {
    throw new Error('No accounts selected/authorized.');
  }

  provider = new BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  const address = await signer.getAddress();

  return { address };
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
