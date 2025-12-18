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
        '--disable-dev-shm-usage', // Vital for Docker
        '--disable-gpu',           // Saves Memory
        '--no-zygote',             // Saves Memory
        // '--single-process'      // REMOVED: Causes crashes on modern Chrome
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      protocolTimeout: 120000, // Wait up to 2 mins for browser to respond
    });

    const page = await browser.newPage();
    
    // 2. Block images/css to save bandwidth & memory
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // 3. Set a HUGE timeout (2 minutes) because free servers are slow
    const navigationOptions = { waitUntil: 'domcontentloaded', timeout: 120000 };

    // --- LOGIN ---
    console.log('📍 Navigating to login...');
    await page.goto(CONFIG.loginUrl, navigationOptions);

    // Handle Cookie Consent (Fast check)
    try {
        const cookieBtn = await page.$('button'); 
        if(cookieBtn) await cookieBtn.click();
    } catch (e) {}

    // Find "See more options"
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

    // Login
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
        // Wait specifically for the button to appear in DOM
        await page.waitForFunction(
            () => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Followers')),
            { timeout: 30000 }
        );

        // Click it
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const btn = buttons.find(b => b.textContent.includes('Followers'));
            if (btn) btn.click();
        });
        
        await page.waitForSelector('div[role="dialog"]', { timeout: 30000 });
    } catch (e) {
        throw new Error('Could not open followers modal. ' + e.message);
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

async function scrollFollowersModal(page) {
  const modalSelector = 'div[role="dialog"]';
  let previousHeight = 0;
  let attempts = 0;
  
  while (attempts < 30) { 
    const currentHeight = await page.evaluate((sel) => {
      const modal = document.querySelector(sel);
      if (modal) {
        modal.scrollTop = modal.scrollHeight;
        return modal.scrollHeight;
      }
      return 0;
    }, modalSelector);

    if (currentHeight === previousHeight) break;
    previousHeight = currentHeight;
    await new Promise(r => setTimeout(r, 1000));
    attempts++;
  }
}

async function extractFollowers(page) {
    return await page.evaluate(() => {
        const followers = [];
        const seen = new Set();
        const modal = document.querySelector('div[role="dialog"]');
        if (!modal) return [];
        const items = modal.querySelectorAll('div'); 
        items.forEach(el => {
            if(el.textContent.includes('Follow') && !el.textContent.includes('Followers')) {
                const lines = el.innerText.split('\n');
                const name = lines[0];
                if(name && !seen.has(name) && name !== 'Follow') {
                    followers.push(name);
                    seen.add(name);
                }
            }
        });
        return followers;
    });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
    // Scroll Logic
    console.log('⬇️ Scrolling...');
    await scrollFollowersModal(page);

    // Extraction Logic
    const followers = await extractFollowers(page);

    // Close browser
    await browser.close();

    // Return Response
    res.json({
        success: true,
        profileUrl: profileUrl,
        count: followers.length,
        followers: followers
    });

  } catch (error) {
    console.error('❌ Error:', error);
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
});

// Helper: Scroll
async function scrollFollowersModal(page) {
  const modalSelector = 'div[role="dialog"]';
  let previousHeight = 0;
  let attempts = 0;
  
  while (attempts < 30) { // Limit to 30 scrolls to prevent timeout
    const currentHeight = await page.evaluate((sel) => {
      const modal = document.querySelector(sel);
      if (modal) {
        modal.scrollTop = modal.scrollHeight;
        return modal.scrollHeight;
      }
      return 0;
    }, modalSelector);

    if (currentHeight === previousHeight) break;
    previousHeight = currentHeight;
    await new Promise(r => setTimeout(r, 1000)); // Wait 1s between scrolls
    attempts++;
  }
}

// Helper: Extract
async function extractFollowers(page) {
    return await page.evaluate(() => {
        const followers = [];
        const seen = new Set();
        const modal = document.querySelector('div[role="dialog"]');
        if (!modal) return [];

        // Strategy: Look for the text blocks near "Follow" buttons
        const items = modal.querySelectorAll('div'); 
        
        items.forEach(el => {
            if(el.textContent.includes('Follow') && !el.textContent.includes('Followers')) {
                // Heuristic: The name is usually the first line of text in the card
                const lines = el.innerText.split('\n');
                const name = lines[0];
                if(name && !seen.has(name) && name !== 'Follow') {
                    followers.push(name);
                    seen.add(name);
                }
            }
        });
        return followers;
    });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

