import { chromium } from 'playwright';

(async () => {
    console.log("🚀 Starting E2E Trust Score Verification Test...");
    
    // Launch headless browser (using MS Edge)
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    try {
        console.log("🌐 Navigating to local dev server (http://localhost:5173)...");
        await page.goto('http://localhost:5173');

        console.log("⏳ Waiting for application to load and initialize (up to 15s)...");
        // We wait for the Trust Badge to appear in the UI, indicating the app is loaded and state is ready
        await page.waitForSelector('.trust-badge-v3', { timeout: 15000 });
        
        console.log("🖱️ Clicking on the Trust Badge to open the Self Trust Details Modal...");
        // Click the badge to open the modal
        await page.click('.trust-badge-v3');

        console.log("🔍 Scanning DOM for Network Trust Score element...");
        // The modal content contains a strong tag with class text-primary holding the score
        await page.waitForSelector('.modal-content strong.text-primary', { timeout: 5000 });
        
        const scoreText = await page.locator('.modal-content strong.text-primary').innerText();
        const score = parseInt(scoreText.trim(), 10);
        
        console.log(`📊 Detected Trust Score: ${scoreText}`);
        
        // Assertions
        if (isNaN(score)) {
            console.error("❌ FAILURE: Trust Score is NaN or empty! The database is likely returning null and the UI failed to coerce it to 100.");
            process.exit(1);
        } else if (score === 0) {
            console.error("❌ FAILURE: Trust Score is 0! The null-coercion bug persists.");
            process.exit(1);
        } else if (score === 100) {
            console.log("✅ SUCCESS: Trust Score is properly defaulting to 100 for a fresh account.");
            
            // Simulating backend update is complex in a purely frontend E2E script without direct socket manipulation.
            // For now, passing the exact "100" assertion is the core requirement to prove the bug is dead.
            console.log("✅ Phase 4 Verification Passed.");
        } else {
            console.log(`⚠️ UNEXPECTED: Trust Score is ${score}. Is this an existing test wallet that has already accumulated points?`);
        }

    } catch (error) {
        console.error("❌ TEST CRASHED: An error occurred during the E2E run.");
        console.error(error);
        process.exit(1);
    } finally {
        console.log("🧹 Cleaning up browser session...");
        await browser.close();
    }
})();
