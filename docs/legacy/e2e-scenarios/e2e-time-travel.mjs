import { chromium } from 'playwright';
import { ethers } from 'ethers';

const APP_URL = 'http://localhost:5173'; 

async function setupMockWallet(page, walletName) {
    const wallet = ethers.Wallet.createRandom();
    
    await page.exposeFunction(`mockSignMessage_${walletName}`, async (messageHex) => {
        let messageText = '';
        try { messageText = ethers.toUtf8String(messageHex); } catch(e) { messageText = messageHex; }
        return await wallet.signMessage(messageText);
    });

    await page.addInitScript(({ address, walletName }) => {
        // We will expose a way to manipulate time
        window.__TIME_OFFSET__ = 0;
        const originalNow = Date.now;
        Date.now = () => originalNow() + window.__TIME_OFFSET__;

        window.ethereum = {
            isMetaMask: true,
            request: async ({ method, params }) => {
                if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
                if (method === 'wallet_requestPermissions') return [{ eth_accounts: {} }];
                if (method === 'personal_sign') return await window[`mockSignMessage_${walletName}`](params[0]);
                if (method === 'eth_chainId') return '0x1';
                if (method === 'net_version') return '1';
                return null;
            },
            on: () => {}, removeListener: () => {}
        };
    }, { address: wallet.address, walletName });

    return wallet;
}

async function runTest() {
    console.log('🚀 Starting DecentraChat V3.0 CRDT Time Travel Test');
    const browser = await chromium.launch({ channel: 'msedge', headless: false });
    
    try {
        const aliceContext = await browser.newContext();
        const alicePage = await aliceContext.newPage();
        const aliceWallet = await setupMockWallet(alicePage, 'Alice');

        const bobContext = await browser.newContext();
        const bobPage = await bobContext.newPage();
        const bobWallet = await setupMockWallet(bobPage, 'Bob');

        console.log('Logging in...');
        await alicePage.goto(APP_URL);
        await bobPage.goto(APP_URL);

        // Login Alice
        await alicePage.click('button:has-text("Connect Wallet"), button:has-text("Connect MetaMask")');
        await alicePage.fill('input[placeholder="PIN"]', '1234');
        await alicePage.fill('input[placeholder="Confirm PIN"]', '1234');
        await alicePage.click('button:has-text("Setup PIN")');
        await alicePage.waitForSelector('text=Secure Identity');
        await alicePage.fill('.username-input', `alice_${Date.now()}`);
        await alicePage.click('button:has-text("Continue")');

        // Login Bob
        await bobPage.click('button:has-text("Connect Wallet"), button:has-text("Connect MetaMask")');
        await bobPage.fill('input[placeholder="PIN"]', '5678');
        await bobPage.fill('input[placeholder="Confirm PIN"]', '5678');
        await bobPage.click('button:has-text("Setup PIN")');
        await bobPage.waitForSelector('text=Secure Identity');
        await bobPage.fill('.username-input', `bob_${Date.now()}`);
        await bobPage.click('button:has-text("Continue")');

        await alicePage.waitForSelector('.sidebar-header h2:has-text("Messages")');
        await bobPage.waitForSelector('.sidebar-header h2:has-text("Messages")');

        console.log('Alice searching for Bob...');
        await alicePage.fill('.sidebar-search-input', bobWallet.address);
        await alicePage.keyboard.press('Enter');
        await alicePage.waitForSelector('text=Start Secure Chat');
        await alicePage.click('button:has-text("Start Secure Chat")');

        console.log('Bob opening chat with Alice...');
        await bobPage.fill('.sidebar-search-input', aliceWallet.address);
        await bobPage.keyboard.press('Enter');
        await bobPage.waitForSelector('text=Start Secure Chat');
        await bobPage.click('button:has-text("Start Secure Chat")');

        await alicePage.waitForTimeout(2000);

        // 1. Normal message (T=0)
        console.log('Alice sending normal message...');
        await alicePage.fill('.message-input', 'Message A (Normal)');
        await alicePage.click('.send-btn');
        await bobPage.waitForSelector('.message-content:has-text("Message A (Normal)")');

        // 2. Future message from Bob (T=+1 hour)
        console.log('Bob sending future message...');
        await bobPage.evaluate(() => { window.__TIME_OFFSET__ = 3600000; }); // +1 hr
        await bobPage.fill('.message-input', 'Message B (Future)');
        await bobPage.click('.send-btn');
        await alicePage.waitForSelector('.message-content:has-text("Message B (Future)")');

        // 3. Past message from Alice (T=-1 hour)
        console.log('Alice sending past message (Simulating delayed sync)...');
        await alicePage.evaluate(() => { window.__TIME_OFFSET__ = -3600000; }); // -1 hr
        await alicePage.fill('.message-input', 'Message C (Past)');
        await alicePage.click('.send-btn');
        await bobPage.waitForSelector('.message-content:has-text("Message C (Past)")');

        // 4. Verification: Extract message text order from DOM
        console.log('Verifying CRDT Timestamp Convergence...');
        
        const verifyOrder = async (page, name) => {
            const msgs = await page.$$eval('.message-content', els => els.map(e => e.innerText));
            console.log(`[${name} UI] Message Order:`, msgs);
            if (msgs[0] !== 'Message C (Past)' || msgs[1] !== 'Message A (Normal)' || msgs[2] !== 'Message B (Future)') {
                throw new Error(`CRDT Vector Order Failure on ${name}'s UI. Expected C, A, B. Got: ${msgs}`);
            }
        };

        await verifyOrder(alicePage, 'Alice');
        await verifyOrder(bobPage, 'Bob');

        console.log('🎉 CRDT Time Travel Vector Test Completed Successfully!');
        
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
