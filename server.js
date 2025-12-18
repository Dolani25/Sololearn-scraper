const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');
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

// --- HELPER: GET TOKEN VIA PUPPETEER ---
async function getAuthToken() {
    console.log('🔑 Launching browser to fetch fresh token...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        protocolTimeout: 60000
    });

    try {
        const page = await browser.newPage();
        
        // Optimize: Block heavy assets just for login
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // 1. Go to Login
        await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 2. Handle Cookie Popup (Fast)
        try {
            const btn = await page.waitForSelector('button', { timeout: 2000 });
            if(btn) await btn.click();
        } catch(e) {}

        // 3. Click "See more options" if needed
        try {
            const links = await page.$$('a');
            for (const link of links) {
                const t = await page.evaluate(el => el.textContent, link);
                if (t.includes('See more options')) await link.click();
            }
        } catch(e) {}

        // 4. Login
        await page.waitForSelector('input[type="email"]');
        await page.type('input[type="email"]', CONFIG.email);
        await page.type('input[type="password"]', CONFIG.password);
        
        // 5. Submit and Wait for Network Idle (Token is generated here)
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.click('button[type="submit"]')
        ]);

        // 6. Steal the Token from LocalStorage
        // SoloLearn stores the JWT in localStorage under keys like 'token' or 'access_token'
        const token = await page.evaluate(() => {
            return localStorage.getItem('token') || localStorage.getItem('access_token');
        });

        if (!token) {
            throw new Error('Could not find token in LocalStorage');
        }

        console.log('✅ Token acquired successfully');
        return token;

    } catch (error) {
        console.error('Login failed:', error.message);
        throw error;
    } finally {
        await browser.close(); // KILL BROWSER IMMEDIATELY TO FREE RAM
    }
}

// --- API ROUTE ---
app.get('/scrape', async (req, res) => {
  const profileUrl = req.query.url; // e.g., https://www.sololearn.com/en/profile/10453904

  if (!profileUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  // Extract ID from URL (e.g., 10453904)
  const idMatch = profileUrl.match(/profile\/(\d+)/);
  const userId = idMatch ? idMatch[1] : null;

  if (!userId) {
      return res.status(400).json({ error: 'Could not extract User ID from URL' });
  }

  console.log(`🚀 Starting optimized scrape for ID: ${userId}`);

  try {
      // Step 1: Get Token (Uses Puppeteer for ~10 seconds)
      const token = await getAuthToken();

      // Step 2: Use Axios for Data (Super Fast, Low Memory)
      const followers = [];
      let page = 1;
      let hasMore = true;

      // Headers from your Inspection
      const headers = {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json, text/plain, */*',
          'SL-Plan-Id': '1',
          'SL-Locale': 'en',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      };

      console.log('⚡ Starting API download loop...');

      while (hasMore && page < 50) { // Safety limit of 50 pages (5000 followers)
          const apiUrl = `https://api2.sololearn.com/v2/userinfo/v3/profile/${userId}/followers?count=100&page=${page}`;
          
          try {
              const response = await axios.get(apiUrl, { headers });
              const data = response.data.data;

              if (data && data.length > 0) {
                  followers.push(...data.map(u => u.name)); // Just saving names
                  console.log(`   Page ${page}: Found ${data.length} followers`);
                  
                  if (data.length < 100) {
                      hasMore = false; // Last page reached
                  } else {
                      page++;
                  }
              } else {
                  hasMore = false;
              }
          } catch (err) {
              console.error(`   Error on page ${page}: ${err.message}`);
              hasMore = false;
          }
      }

      res.json({
          success: true,
          profileId: userId,
          count: followers.length,
          followers: followers
      });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
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

