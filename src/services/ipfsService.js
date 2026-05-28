/**
 * IPFS Service (Layer 6)
 * Handles decentralized storage using Pinata SDK.
 * All media is symmetrically encrypted before upload.
 */
import { PinataSDK } from "pinata-web3";

const PUBLIC_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

/**
 * Upload an encrypted blob (base64 string) to IPFS via Pinata.
 * @param {string} encryptedBase64 
 * @param {string} pinataJwt 
 * @returns {Promise<string>} IPFS CID
 */
export async function uploadToIPFS(encryptedBase64, pinataJwt) {
    if (!pinataJwt) {
        throw new Error("Pinata JWT not configured. Please set it in Settings.");
    }

    try {
        const pinata = new PinataSDK({
            pinataJwt: pinataJwt,
            pinataHost: "api.pinata.cloud"
        });

        // Convert base64 to File object for Pinata SDK
        const response = await fetch(encryptedBase64);
        const blob = await response.blob();
        const file = new File([blob], `dc_media_${Date.now()}.enc`, { type: "application/octet-stream" });

        console.log("📦 IPFS: Uploading encrypted media to Pinata...");
        const upload = await pinata.upload.file(file);
        
        console.log(`✅ IPFS: Upload complete. CID: ${upload.IpfsHash}`);
        return upload.IpfsHash;
    } catch (err) {
        console.error("❌ IPFS: Upload failed:", err);
        throw err;
    }
}

/**
 * Fetch raw encrypted data from an IPFS CID.
 * @param {string} cid 
 * @returns {Promise<string>} Base64 encoded encrypted data
 */
export async function fetchFromIPFS(cid) {
    try {
        console.log(`📦 IPFS: Fetching CID ${cid.slice(0, 10)}...`);
        const url = `${PUBLIC_GATEWAY}${cid}`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const blob = await response.blob();
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        console.error("❌ IPFS: Fetch failed:", err);
        throw err;
    }
}
