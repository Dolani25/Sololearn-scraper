const express = require('express');
const puppeteer = require('puppeteer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CONFIG
const CONFIG = {
  email: process.env.SOLO_EMAIL,
  password: process.env.SOLO_PASSWORD,
  loginUrl: 'https://www.sololearn.com/en/users/login',
};

// HELPER FUNCTION: Scroll Modal
async function scrollFollowersModal(page) {
  const modalSelector = 'div[role="dialog"]';
  let previousHeight = 0;
  let attempts = 0;
  
  // Try scrolling for up to 30 seconds
  while (attempts < 30) { 
    const currentHeight = await page.evaluate((sel) => {
      const modal = document.querySelector(sel);
      if (modal) {
        modal.scrollTop = modal.scrollHeight;
        return modal.scrollHeight;
      }
      return 0;
    }, modalSelector);

    if (currentHeight === previousHeight && currentHeight !== 0) {
        // If height hasn't changed, we might be at the bottom
        break;
    }
    
    previousHeight = currentHeight;
    // Wait 1 second between scrolls
    await new Promise(r => setTimeout(r, 1000));
    attempts++;
  }
}

// HELPER FUNCTION: Extract Names
async function extractFollowers(page) {
    return await page.evaluate(() => {
        const followers = [];
        const seen = new Set();
        const modal = document.querySelector('div[role="dialog"]');
        if (!modal) return [];
        
        const items = modal.querySelectorAll('div'); 
        items.forEach(el => {
            // Look for divs that contain 'Follow' button text but aren't the header
            if(el.textContent.includes('Follow') && !el.textContent.includes('Followers')) {
                const lines = el.innerText.split('\n');
                const name = lines[0];
                // Basic cleanup
                if(name && !seen.has(name) && name !== 'Follow') {
                    followers.push(name);
                    seen.add(name);
                }
            }
        });
        return followers;
    });
}

// MAIN API ROUTE
app.get('/scrape', async (req, res) => {
  const profileUrl = req.query.url;

  if (!profileUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  console.log(`🚀 Received scrape request for: ${profileUrl}`);
  
  let browser = null;
  
  try {
    // 1. Launch with Memory-Saving Flags
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      protocolTimeout: 120000,
    });

    const page = await browser.newPage();
    
    // 2. Block heavy resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const navigationOptions = { waitUntil: 'domcontentloaded', timeout: 120000 };

    // --- LOGIN ---
    console.log('📍 Navigating to login...');
    await page.goto(CONFIG.loginUrl, navigationOptions);

    // Cookie Consent
    try {
        const cookieBtn = await page.$('button'); 
        if(cookieBtn) await cookieBtn.click();
    } catch (e) {}

    // "See more options"
    try {
        await page.waitForSelector('a', { timeout: 5000 });
        const links = await page.$$('a');
        for (const link of links) {
            const text = await page.evaluate(el => el.textContent, link);
            if (text.includes('See more options')) {
                await link.click();
                break;
            }
        }
    } catch(e) {}

    // Type Credentials
    await page.waitForSelector('input[type="email"]', { timeout: 60000 });
    await page.type('input[type="email"]', CONFIG.email);
    await page.type('input[type="password"]', CONFIG.password);
    
    await Promise.all([
        page.waitForNavigation(navigationOptions),
        page.click('button[type="submit"]')
    ]);
    console.log('✅ Login successful');

    // --- PROFILE ---
    console.log(`📍 Navigating to profile: ${profileUrl}`);
    await page.goto(profileUrl, navigationOptions);

    // Open Followers Modal
    console.log('Searching for Followers button...');
    try {
        await page.waitForFunction(
            () => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Followers')),
            { timeout: 30000 }
        );

        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const btn = buttons.find(b => b.textContent.includes('Followers'));
            if (btn) btn.click();
        });
        
        await page.waitForSelector('div[role="dialog"]', { timeout: 30000 });
    } catch (e) {
        throw new Error('Could not open followers modal (Profile might be private or changed).');
    }

    // Scroll
    console.log('⬇️ Scrolling...');
    await scrollFollowersModal(page);

    // Extract
    const followers = await extractFollowers(page);

    await browser.close();

    res.json({
        success: true,
        count: followers.length,
        followers: followers
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

