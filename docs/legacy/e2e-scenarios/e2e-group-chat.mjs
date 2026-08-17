import { chromium } from 'playwright';
import { ethers } from 'ethers';

const APP_URL = 'http://localhost:5173';

async function setupMockWallet(page, walletName) {
    const wallet = ethers.Wallet.createRandom();
    console.log(`[${walletName}] Generated Wallet: ${wallet.address}`);

    // Expose signing function to the browser
    await page.exposeFunction(`mockSignMessage_${walletName}`, async (messageHex) => {
        let messageText = '';
        try {
            messageText = ethers.toUtf8String(messageHex);
        } catch(e) {
            messageText = messageHex;
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
        window.localStorage.setItem('use_local_server', 'true');
    }, { address: wallet.address, walletName });

    return wallet;
}

async function logUiMembers(page, name) {
    try {
        console.log(`[${name}] Opening group details...`);
        // Wait a bit for UI to settle
        await page.waitForTimeout(1000);
        await page.click('.chat-header-container span.truncate', { force: true });
        await page.waitForSelector('.members-list', { timeout: 10000 });
        const members = await page.$$eval('.member-address', el => el.map(e => e.textContent.trim()));
        console.log(`[${name}] UI Group Members:`, members);
        await page.click('button:has-text("Close")', { force: true });
    } catch (e) {
        console.log(`[${name}] Failed to log UI members: ${e.message}`);
    }
}

async function logStoredContacts(page, name) {
    try {
        const contacts = await page.evaluate(async () => {
            return new Promise((resolve) => {
                const req = indexedDB.open("decentrachat");
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    try {
                        const tx = db.transaction("messages", "readonly");
                        const store = tx.objectStore("messages");
                        const getReq = store.get("visible_contacts");
                        getReq.onsuccess = () => resolve(getReq.result || []);
                        getReq.onerror = () => resolve([]);
                    } catch (err) {
                        resolve([]);
                    }
                };
                req.onerror = () => resolve([]);
            });
        });
        console.log(`[${name}] Stored Contacts in DB:`, JSON.stringify(contacts, null, 2));
    } catch (e) {
        console.log(`[${name}] Failed to read stored contacts: ${e.message}`);
    }
}

async function runTest() {
    console.log('🚀 Starting DecentraChat V3.0 Group Chat E2E Test (Mobile Emulation)');
    
    // Launch browser
    let browser;
    try {
        browser = await chromium.launch({ channel: 'msedge', headless: false });
    } catch (e) {
        console.log('Edge browser launch failed, falling back to standard Chromium...');
        browser = await chromium.launch({ headless: false });
    }
    
    try {
        const rand = Math.floor(Math.random() * 10000);
        const aliceUsername = `alice_${rand}`;
        const bobUsername = `bob_${rand}`;
        const charlieUsername = `charlie_${rand}`;

        const contextOptions = {
            viewport: { width: 375, height: 812 },
            isMobile: true,
            hasTouch: true,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
        };

        // --- Context 1: Alice ---
        const aliceContext = await browser.newContext(contextOptions);
        const alicePage = await aliceContext.newPage();
        alicePage.on('console', msg => console.log(`[Alice Browser] ${msg.text()}`));
        const aliceWallet = await setupMockWallet(alicePage, 'Alice');

        // --- Context 2: Bob ---
        const bobContext = await browser.newContext(contextOptions);
        const bobPage = await bobContext.newPage();
        bobPage.on('console', msg => console.log(`[Bob Browser] ${msg.text()}`));
        const bobWallet = await setupMockWallet(bobPage, 'Bob');

        // --- Context 3: Charlie ---
        const charlieContext = await browser.newContext(contextOptions);
        const charliePage = await charlieContext.newPage();
        charliePage.on('console', msg => console.log(`[Charlie Browser] ${msg.text()}`));
        const charlieWallet = await setupMockWallet(charliePage, 'Charlie');

        // Navigate all pages to the app
        console.log('Navigating pages to app...');
        await alicePage.goto(APP_URL);
        await bobPage.goto(APP_URL);
        await charliePage.goto(APP_URL);

        // Step 1: Login & PIN Setup for Alice
        console.log('Logging in Alice...');
        await alicePage.click('button:has-text("Connect Wallet"), button:has-text("Connect MetaMask")');
        await alicePage.fill('input[placeholder="PIN"]', '1234');
        await alicePage.fill('input[placeholder="Confirm PIN"]', '1234');
        await alicePage.click('button:has-text("Setup PIN")');
        await alicePage.waitForSelector('text=Secure Identity', { timeout: 10000 });
        await alicePage.fill('.username-input', aliceUsername);
        await alicePage.click('button:has-text("Continue")');

        // Step 1: Login & PIN Setup for Bob
        console.log('Logging in Bob...');
        await bobPage.click('button:has-text("Connect Wallet"), button:has-text("Connect MetaMask")');
        await bobPage.fill('input[placeholder="PIN"]', '1234');
        await bobPage.fill('input[placeholder="Confirm PIN"]', '1234');
        await bobPage.click('button:has-text("Setup PIN")');
        await bobPage.waitForSelector('text=Secure Identity', { timeout: 10000 });
        await bobPage.fill('.username-input', bobUsername);
        await bobPage.click('button:has-text("Continue")');

        // Step 1: Login & PIN Setup for Charlie
        console.log('Logging in Charlie...');
        await charliePage.click('button:has-text("Connect Wallet"), button:has-text("Connect MetaMask")');
        await charliePage.fill('input[placeholder="PIN"]', '1234');
        await charliePage.fill('input[placeholder="Confirm PIN"]', '1234');
        await charliePage.click('button:has-text("Setup PIN")');
        await charliePage.waitForSelector('text=Secure Identity', { timeout: 10000 });
        await charliePage.fill('.username-input', charlieUsername);
        await charliePage.click('button:has-text("Continue")');

        // Wait for all to hit the main chat interface
        await alicePage.waitForSelector('.sidebar-header h2:has-text("Messages")');
        await bobPage.waitForSelector('.sidebar-header h2:has-text("Messages")');
        await charliePage.waitForSelector('.sidebar-header h2:has-text("Messages")');

        // Step 2: Establish Discovery to populate contacts list on Alice's side
        console.log('Alice searching for Bob to add as contact...');
        await alicePage.fill('.sidebar-search-input', bobWallet.address);
        await alicePage.keyboard.press('Enter');
        await alicePage.waitForSelector('text=Start Secure Chat');
        await alicePage.click('button:has-text("Start Secure Chat")');
        await alicePage.waitForSelector('button[aria-label="Back to chat list"]');
        await alicePage.click('button[aria-label="Back to chat list"]'); // Go back to sidebar

        console.log('Alice searching for Charlie to add as contact...');
        await alicePage.fill('.sidebar-search-input', charlieWallet.address);
        await alicePage.keyboard.press('Enter');
        await alicePage.waitForSelector('text=Start Secure Chat');
        await alicePage.click('button:has-text("Start Secure Chat")');
        await alicePage.waitForSelector('button[aria-label="Back to chat list"]');
        await alicePage.click('button[aria-label="Back to chat list"]'); // Go back to sidebar

        console.log('Bob searching for Alice to align keys...');
        await bobPage.fill('.sidebar-search-input', aliceWallet.address);
        await bobPage.keyboard.press('Enter');
        await bobPage.waitForSelector('text=Start Secure Chat');
        await bobPage.click('button:has-text("Start Secure Chat")');
        await bobPage.waitForSelector('button[aria-label="Back to chat list"]');
        await bobPage.click('button[aria-label="Back to chat list"]'); // Go back to sidebar

        console.log('Charlie searching for Alice to align keys...');
        await charliePage.fill('.sidebar-search-input', aliceWallet.address);
        await charliePage.keyboard.press('Enter');
        await charliePage.waitForSelector('text=Start Secure Chat');
        await charliePage.click('button:has-text("Start Secure Chat")');
        await charliePage.waitForSelector('button[aria-label="Back to chat list"]');
        await charliePage.click('button[aria-label="Back to chat list"]'); // Go back to sidebar

        // Wait for P2P connection to stabilize
        await alicePage.waitForTimeout(3000);

        // Step 3: Create Group Chat from Alice's side
        console.log('Alice opening Contacts tab...');
        await alicePage.click('button[aria-label="Go to Contacts"]');

        console.log('Alice opening FAB menu...');
        await alicePage.click('button.fixed.bottom-24.right-6');

        console.log('Alice clicking Create Group...');
        await alicePage.click('button:has-text("Create Group")');

        console.log('Alice entering group details...');
        await alicePage.fill('.group-name-input', 'E2E Test Group');
        
        console.log('Alice selecting Bob and Charlie...');
        await alicePage.click(`.member-option:has-text("${bobUsername}")`);
        await alicePage.click(`.member-option:has-text("${charlieUsername}")`);

        console.log('Alice submitting group creation...');
        await alicePage.click('.modal-footer button:has-text("Create Group")');

        // Wait for Alice to enter the group chat
        console.log('Waiting for group chat to open on Alice\'s side...');
        await alicePage.waitForSelector('.chat-header-container:has-text("E2E Test Group")', { timeout: 15000 });

        // Step 4: Bob and Charlie navigate to the group chat
        console.log('Bob navigating to the group chat...');
        await bobPage.click('text="E2E Test Group"');
        
        console.log('Charlie navigating to the group chat...');
        await charliePage.click('text="E2E Test Group"');

        await bobPage.waitForSelector('.chat-header-container:has-text("E2E Test Group")', { timeout: 10000 });
        await charliePage.waitForSelector('.chat-header-container:has-text("E2E Test Group")', { timeout: 10000 });

        // Log initial group members on Bob's and Charlie's side
        await logUiMembers(bobPage, 'Bob');
        await logStoredContacts(bobPage, 'Bob');
        await logUiMembers(charliePage, 'Charlie');
        await logStoredContacts(charliePage, 'Charlie');

        // Step 5: Messaging inside the group
        console.log('Alice sending group message...');
        await alicePage.fill('.message-input', 'Hello Group from Alice!');
        await alicePage.waitForSelector('.send-btn:not([disabled])', { timeout: 10000 });
        await alicePage.click('.send-btn');

        // Verify Bob and Charlie receive the message
        console.log('Waiting for Bob to receive group message...');
        await bobPage.waitForSelector('.message-content:has-text("Hello Group from Alice!")', { timeout: 15000 });
        console.log('✅ Bob received Alice\'s group message!');

        console.log('Waiting for Charlie to receive group message...');
        await charliePage.waitForSelector('.message-content:has-text("Hello Group from Alice!")', { timeout: 15000 });
        console.log('✅ Charlie received Alice\'s group message!');

        // Step 6: Bidirectional Group Chat Check - Bob sending message to group
        console.log('Bob sending reply to the group...');
        await bobPage.fill('.message-input', 'Hi Alice and Charlie from Bob!');
        await bobPage.waitForSelector('.send-btn:not([disabled])', { timeout: 10000 });
        await bobPage.click('.send-btn');

        // Verify Alice and Charlie receive Bob's reply
        console.log('Waiting for Alice to receive Bob\'s reply...');
        await alicePage.waitForSelector('.message-content:has-text("Hi Alice and Charlie from Bob!")', { timeout: 15000 });
        console.log('✅ Alice received Bob\'s group reply!');

        console.log('Waiting for Charlie to receive Bob\'s reply...');
        await charliePage.waitForSelector('.message-content:has-text("Hi Alice and Charlie from Bob!")', { timeout: 15000 });
        console.log('✅ Charlie received Bob\'s group reply!');

        // Step 7: Charlie sending message to group
        console.log('Charlie sending reply to the group...');
        await charliePage.fill('.message-input', 'Hi Alice and Bob from Charlie!');
        await charliePage.waitForSelector('.send-btn:not([disabled])', { timeout: 10000 });
        await charliePage.click('.send-btn');

        // Verify Alice and Bob receive Charlie's reply
        console.log('Waiting for Alice to receive Charlie\'s reply...');
        await alicePage.waitForSelector('.message-content:has-text("Hi Alice and Bob from Charlie!")', { timeout: 15000 });
        console.log('✅ Alice received Charlie\'s group reply!');

        console.log('Waiting for Bob to receive Charlie\'s reply...');
        await bobPage.waitForSelector('.message-content:has-text("Hi Alice and Bob from Charlie!")', { timeout: 15000 });
        console.log('✅ Bob received Charlie\'s group reply!');

        console.log('🎉 Group Chat E2E Workflow Completed Successfully!');

    } catch (error) {
        console.error('❌ Group Chat E2E Test Failed:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

runTest().catch(e => {
    process.exit(1);
});
