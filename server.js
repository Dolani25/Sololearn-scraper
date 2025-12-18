const express = require('express');
const puppeteer = require('puppeteer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON
app.use(express.json());

// Configuration
const CONFIG = {
  email: process.env.SOLO_EMAIL,       // Set these in Render Environment Variables
  password: process.env.SOLO_PASSWORD, 
  loginUrl: 'https://www.sololearn.com/en/users/login',
  headless: 'new', // New headless mode for performance
};

app.get('/scrape', async (req, res) => {
  const profileUrl = req.query.url;

  if (!profileUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  console.log(`🚀 Received scrape request for: ${profileUrl}`);
  
  let browser = null;
  
  try {
    // Launch browser with arguments required for Docker/Cloud environments
    browser = await puppeteer.launch({
      headless: CONFIG.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Vital for Docker memory management
        '--single-process' // Vital for some cloud environments
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null // uses bundled chromium if null
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // --- LOGIN LOGIC ---
    console.log('📍 Navigating to login...');
    await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Handle Cookie Consent
    try {
        const cookieBtn = await page.$('button'); // Simplified selector
        if(cookieBtn) await cookieBtn.click();
    } catch (e) { console.log('No cookie popup'); }

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
    } catch(e) { console.log('See more options check skipped'); }

    // Type Credentials
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', CONFIG.email);
    await page.type('input[type="password"]', CONFIG.password);
    
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.click('button[type="submit"]')
    ]);
    console.log('✅ Login successful');

    // --- PROFILE NAVIGATION ---
    console.log(`📍 Navigating to profile: ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Open Followers Modal
    try {
        // Look for buttons containing "Followers" text specifically
        const followersBtn = await page.evaluateHandle(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            return buttons.find(b => b.textContent.includes('Followers'));
        });
        
        if (followersBtn) {
            await followersBtn.click();
            await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
        } else {
            throw new Error('Followers button not found');
        }
    } catch (e) {
        throw new Error('Could not open followers modal. Is the profile public?');
    }

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

