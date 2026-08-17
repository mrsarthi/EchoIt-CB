import { chromium } from 'playwright';
import { ethers } from 'ethers';
import AxeBuilder from '@axe-core/playwright';

const APP_URL = 'http://localhost:5173';

async function setupMockWallet(page, walletName) {
    const wallet = ethers.Wallet.createRandom();
    await page.exposeFunction(`mockSignMessage_${walletName}`, async (messageHex) => {
        let messageText = '';
        try { messageText = ethers.toUtf8String(messageHex); } catch(e) { messageText = messageHex; }
        return await wallet.signMessage(messageText);
    });

    await page.addInitScript(({ address, walletName }) => {
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
    console.log('🚀 Starting DecentraChat V3.0 UI Flaw Detection Test');
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        
        // Auto-dismiss dialogs to prevent tests from hanging
        page.on('dialog', dialog => dialog.accept());
        
        page.on('console', msg => console.log(`[Browser] ${msg.text()}`));
        page.on('pageerror', err => console.log(`[Browser Exception] ${err}`));
        page.on('worker', worker => {
            console.log(`[Worker Created] ${worker.url()}`);
            worker.on('console', msg => console.log(`[Worker Console] ${msg.text()}`));
            worker.on('error', err => console.log(`[Worker Error] ${err}`));
        });

        const wallet = await setupMockWallet(page, 'Alice');

        console.log('Logging in...');
        await page.goto(APP_URL);
        
        // Wait for 2 seconds to allow React StrictMode double-mounting and socket HMR to stabilize
        await page.waitForTimeout(2000);
        
        await page.click('button:has-text("Connect Wallet"), button:has-text("Connect MetaMask")');
        await page.fill('input[placeholder="PIN"]', '1234');
        await page.fill('input[placeholder="Confirm PIN"]', '1234');
        await page.click('button:has-text("Setup PIN")');
        await page.waitForSelector('text=Secure Identity');
        await page.fill('.username-input', `alice_${Date.now()}`);
        await page.click('button:has-text("Continue")');

        await page.waitForSelector('.sidebar-header h2:has-text("Messages")');
        console.log('✅ Reached Main Chat Interface');

        let uiFlawsFound = 0;

        // -------------------------------------------------------------
        // 1. Accessibility (Axe-Core) Auditing
        // -------------------------------------------------------------
        console.log('\n🔍 Running Accessibility & Contrast Audit (axe-core)...');
        try {
            const results = await new AxeBuilder({ page }).analyze();
            if (results.violations.length > 0) {
                console.warn(`⚠️ Found ${results.violations.length} Accessibility Violations:`);
                results.violations.forEach(v => {
                    console.warn(`   - [${v.impact}] ${v.id}: ${v.help}`);
                    console.warn(`     Nodes affected: ${v.nodes.length}`);
                });
                uiFlawsFound += results.violations.length;
            } else {
                console.log('✅ No Accessibility Violations Found!');
            }
        } catch (e) {
            console.error('Failed to run Axe-Core:', e);
        }

        // -------------------------------------------------------------
        // 2. Computed CSS Integrity (Backdrop Filter Check)
        // -------------------------------------------------------------
        console.log('\n🔍 Verifying Warm Minimalism CSS Integrity...');
        const sidebarBlur = await page.$eval('.sidebar', el => window.getComputedStyle(el).backdropFilter);
        if (sidebarBlur !== 'none') {
            console.warn(`⚠️ FLaw Detected: .sidebar still has backdrop-filter: ${sidebarBlur}`);
            uiFlawsFound++;
        } else {
            console.log('✅ .sidebar backdrop-filter successfully stripped.');
        }

        // -------------------------------------------------------------
        // 3. Responsive Overflow Breakage Test
        // -------------------------------------------------------------
        console.log('\n🔍 Testing Responsive Breakpoints for Overflow...');
        await page.setViewportSize({ width: 375, height: 667 }); // iPhone 8 size
        await page.waitForTimeout(500); // let UI settle

        const hasHorizontalScroll = await page.evaluate(() => {
            return document.documentElement.scrollWidth > window.innerWidth;
        });

        if (hasHorizontalScroll) {
            console.warn(`⚠️ FLAW DETECTED: Layout breaks at 375px width! Horizontal scrollbar appeared.`);
            uiFlawsFound++;
        } else {
            console.log('✅ Layout is responsive at 375px without horizontal scroll breakage.');
        }

        // -------------------------------------------------------------
        // 4. Bounding Box Overlap Detection (Sidebar vs Main Content)
        // -------------------------------------------------------------
        console.log('\n🔍 Running Bounding Box Collision Detection...');
        // Go back to tablet/desktop size where both should render side by side
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.waitForTimeout(500);

        const boxesOverlap = await page.evaluate(() => {
            const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect();
            const mainContent = document.querySelector('.main-content')?.getBoundingClientRect();
            
            if (!sidebar || !mainContent) return false;

            return !(sidebar.right <= mainContent.left || 
                     sidebar.left >= mainContent.right || 
                     sidebar.bottom <= mainContent.top || 
                     sidebar.top >= mainContent.bottom);
        });

        if (boxesOverlap) {
            console.warn(`⚠️ FLAW DETECTED: .sidebar and .main-content visually overlap in the DOM!`);
            uiFlawsFound++;
        } else {
            console.log('✅ No collision detected between Sidebar and Main Content.');
        }

        console.log('\n=======================================');
        if (uiFlawsFound > 0) {
            console.log(`❌ UI Flaw Audit Completed with ${uiFlawsFound} issues found.`);
        } else {
            console.log(`🎉 UI Flaw Audit Completed: Perfect Structure!`);
        }
        console.log('=======================================');
        
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
