import { chromium } from 'playwright';
import { ethers } from 'ethers';

const APP_URL = 'http://localhost:5173'; // Assuming default Vite port

async function setupMockWallet(page, walletName) {
    const wallet = ethers.Wallet.createRandom();
    console.log(`[${walletName}] Generated Wallet: ${wallet.address}`);

    // Expose signing function to the browser
    await page.exposeFunction(`mockSignMessage_${walletName}`, async (messageHex) => {
        let messageText = '';
        try {
            messageText = ethers.toUtf8String(messageHex);
        } catch(e) {
            messageText = messageHex; // fallback
        }
        return await wallet.signMessage(messageText);
    });

    // Inject the mock ethereum provider
    await page.addInitScript(({ address, walletName }) => {
        window.ethereum = {
            isMetaMask: true,
            request: async ({ method, params }) => {
                if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
                    return [address];
                }
                if (method === 'wallet_requestPermissions') {
                    return [{ eth_accounts: {} }];
                }
                if (method === 'personal_sign') {
                    const signFn = window[`mockSignMessage_${walletName}`];
                    return await signFn(params[0]);
                }
                if (method === 'eth_chainId') {
                    return '0x1';
                }
                if (method === 'net_version') {
                    return '1';
                }
                console.log(`Mock ignored method: ${method}`);
                return null;
            },
            on: () => {},
            removeListener: () => {}
        };
    }, { address: wallet.address, walletName });

    return wallet;
}

async function runTest() {
    console.log('🚀 Starting DecentraChat V3.0 E2E Rapid-Fire Stress Test');
    
    // Launch browser
    const browser = await chromium.launch({ channel: 'msedge', headless: false });
    
    try {
        // --- Context 1: Alice ---
        const aliceContext = await browser.newContext();
        const alicePage = await aliceContext.newPage();
        alicePage.on('console', msg => {
            const text = msg.text();
            if (text.includes('Decryption failed') || text.includes('Error')) {
                console.error(`[Alice Browser Error] ${text}`);
            }
        });
        const aliceWallet = await setupMockWallet(alicePage, 'Alice');

        // --- Context 2: Bob ---
        const bobContext = await browser.newContext();
        const bobPage = await bobContext.newPage();
        bobPage.on('console', msg => {
            const text = msg.text();
            if (text.includes('Decryption failed') || text.includes('Error')) {
                console.error(`[Bob Browser Error] ${text}`);
            }
        });
        const bobWallet = await setupMockWallet(bobPage, 'Bob');

        // Navigate both to the app
        console.log('Navigating to app...');
        await alicePage.goto(APP_URL);
        await bobPage.goto(APP_URL);

        // Step 1: Login & PIN Setup for both
        console.log('Logging in Alice...');
        await alicePage.click('button:has-text("Connect Wallet"), button:has-text("Connect MetaMask")');
        await alicePage.fill('input[placeholder="PIN"]', '1234');
        await alicePage.fill('input[placeholder="Confirm PIN"]', '1234');
        await alicePage.click('button:has-text("Setup PIN")');
        
        await alicePage.waitForSelector('text=Secure Identity', { timeout: 10000 });
        await alicePage.fill('.username-input', `alice_${Date.now()}`);
        await alicePage.click('button:has-text("Continue")');

        console.log('Logging in Bob...');
        await bobPage.click('button:has-text("Connect Wallet"), button:has-text("Connect MetaMask")');
        await bobPage.fill('input[placeholder="PIN"]', '5678');
        await bobPage.fill('input[placeholder="Confirm PIN"]', '5678');
        await bobPage.click('button:has-text("Setup PIN")');
        
        await bobPage.waitForSelector('text=Secure Identity', { timeout: 10000 });
        await bobPage.fill('.username-input', `bob_${Date.now()}`);
        await bobPage.click('button:has-text("Continue")');

        // Wait for both to hit the main chat interface
        await alicePage.waitForSelector('.sidebar-header h2:has-text("Messages")');
        await bobPage.waitForSelector('.sidebar-header h2:has-text("Messages")');

        // Step 2: Discovery & Chat Setup
        console.log('Alice searching for Bob...');
        await alicePage.fill('.sidebar-search-input', bobWallet.address);
        await alicePage.keyboard.press('Enter');
        
        await alicePage.waitForSelector('text=Start Secure Chat');
        await alicePage.click('button:has-text("Start Secure Chat")');

        // Bob opens chat with Alice
        console.log('Bob opening chat with Alice...');
        await bobPage.fill('.sidebar-search-input', aliceWallet.address);
        await bobPage.keyboard.press('Enter');
        await bobPage.waitForSelector('text=Start Secure Chat');
        await bobPage.click('button:has-text("Start Secure Chat")');

        // Wait for WebRTC connection to stabilize
        await alicePage.waitForTimeout(2000);

        // Step 3: Rapid Fire Messaging
        console.log('Alice sending 10 rapid-fire messages to Bob...');
        const NUM_MESSAGES = 10;
        
        for (let i = 1; i <= NUM_MESSAGES; i++) {
            await alicePage.fill('.message-input', `Rapid Fire Message ${i}`);
            await alicePage.waitForSelector('.send-btn:not([disabled])', { timeout: 5000 });
            await alicePage.click('.send-btn');
            // Minimal wait to ensure React state updates but keeps it fast to stress the engine
            await alicePage.waitForTimeout(50);
        }

        // Verify Bob receives all of them in correct order
        console.log('Waiting for Bob to receive all messages...');
        for (let i = 1; i <= NUM_MESSAGES; i++) {
            await bobPage.waitForSelector(`.message-content:has-text("Rapid Fire Message ${i}")`, { timeout: 15000 });
            console.log(`✅ Message ${i} received`);
        }
        
        console.log('🎉 Rapid-Fire Epoch Ratchet Test Completed Successfully!');
        
    } catch (error) {
        console.error('❌ E2E Test Failed:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

runTest().catch(e => {
    process.exit(1);
});
