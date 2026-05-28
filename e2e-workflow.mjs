import { chromium } from 'playwright';
import { ethers } from 'ethers';

const APP_URL = 'http://localhost:5173'; // Assuming default Vite port

async function setupMockWallet(page, walletName) {
    const wallet = ethers.Wallet.createRandom();
    console.log(`[${walletName}] Generated Wallet: ${wallet.address}`);

    // Expose signing function to the browser
    await page.exposeFunction(`mockSignMessage_${walletName}`, async (messageHex) => {
        // messageHex is '0x...' encoded utf8 string when coming from personal_sign
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
                    // Call the exposed Node.js function
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
    console.log('🚀 Starting DecentraChat V3.0 E2E Architecture Test');
    
    // Launch browser (using Edge)
    const browser = await chromium.launch({ channel: 'msedge', headless: false });
    
    try {
        // --- Context 1: Alice ---
        const aliceContext = await browser.newContext();
        const alicePage = await aliceContext.newPage();
        alicePage.on('console', msg => console.log(`[Alice Browser] ${msg.text()}`));
        const aliceWallet = await setupMockWallet(alicePage, 'Alice');

        // --- Context 2: Bob ---
        const bobContext = await browser.newContext();
        const bobPage = await bobContext.newPage();
        bobPage.on('console', msg => console.log(`[Bob Browser] ${msg.text()}`));
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

        // Step 2: Discovery
        console.log('Alice searching for Bob...');
        await alicePage.fill('.sidebar-search-input', bobWallet.address);
        await alicePage.keyboard.press('Enter');
        
        // Handle ProfilePreviewModal
        await alicePage.waitForSelector('text=Start Secure Chat');
        await alicePage.click('button:has-text("Start Secure Chat")');

        // Bob opens chat with Alice to establish WebRTC connection early
        console.log('Bob opening chat with Alice...');
        await bobPage.fill('.sidebar-search-input', aliceWallet.address);
        await bobPage.keyboard.press('Enter');
        await bobPage.waitForSelector('text=Start Secure Chat');
        await bobPage.click('button:has-text("Start Secure Chat")');

        // Wait for WebRTC connection to stabilize
        await alicePage.waitForTimeout(2000);

        // Step 3: Messaging (WebRTC/Waku)
        console.log('Alice sending message to Bob...');
        await alicePage.fill('.message-input', 'Alice via Playwright');
        await alicePage.waitForSelector('.send-btn:not([disabled])', { timeout: 10000 });
        await alicePage.click('.send-btn');

        // Verify Bob receives it
        console.log('Waiting for Bob to receive message...');
        await bobPage.waitForSelector('.message-content:has-text("Alice via Playwright")', { timeout: 15000 });
        console.log('✅ Bob received Alice\'s message!');

        // Step 4: UI/UX Checks (Trust Badges)
        console.log('Verifying Layer 7 UI Trust Badges...');
        // Alice should have a TrustBadge next to Bob's name
        const badgeVisible = await alicePage.isVisible('.trust-badge-v3');
        if (badgeVisible) {
            console.log('✅ TrustBadge rendered successfully!');
        } else {
            throw new Error('TrustBadge not found in UI');
        }

        console.log('🎉 E2E Workflow Completed Successfully!');
        
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
