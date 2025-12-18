const express = require('express');
const axios = require('axios');
const crypto = require('crypto'); // For generating random IDs
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CONFIG
const CONFIG = {
  email: process.env.SOLO_EMAIL,
  password: process.env.SOLO_PASSWORD,
  // If auto-login fails, paste the "accessToken" from your browser inspect logs here (in .env)
  manualToken: process.env.SOLO_MANUAL_TOKEN 
};

/**
 * HELPER: Step 1 - Get Public "Handshake" Token
 */
async function getPublicToken() {
    console.log('🤝 Step 1: Requesting Public Handshake Token...');
    
    // Generate a random device ID (subject)
    const subject = crypto.randomUUID(); 
    
    try {
        // We try with checkboxCaptcha: false and NO captcha token first.
        // If Sololearn is lenient, this will work.
        const response = await axios.post('https://www.sololearn.com/user/publicToken', 
            {
                subject: subject,
                checkboxCaptcha: false
                // We omit captchaToken because we can't generate it on a server.
            }, 
            {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        );

        if (response.data && response.data.accessToken) {
            console.log('   ✅ Public Token Acquired');
            return response.data.accessToken;
        }
        throw new Error('No public token returned');

    } catch (error) {
        console.error('   ❌ Handshake Failed:', error.response?.status, error.response?.data || error.message);
        throw new Error('Handshake Failed. Cloudflare blocked the request.');
    }
}

/**
 * HELPER: Step 2 - Login using Public Token
 */
async function getLoginToken(publicToken) {
    console.log('🔑 Step 2: Attempting Login...');
    
    const loginUrl = 'https://api2.sololearn.com/v2/authentication/user:login';
    const payload = {
        email: CONFIG.email,
        password: CONFIG.password,
        subject: crypto.randomUUID()
    };

    try {
        const response = await axios.post(loginUrl, payload, {
            headers: {
                'Authorization': `Bearer ${publicToken}`, // <--- The Critical Fix
                'Content-Type': 'application/json',
                'SL-Locale': 'en',
                'SL-Time-Zone': '+1',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (response.data && response.data.accessToken) {
            console.log('   ✅ User Login Successful');
            return response.data.accessToken;
        }
        throw new Error('No user token returned');

    } catch (error) {
        console.error('   ❌ Login Failed:', error.response?.data || error.message);
        throw error;
    }
}

app.get('/scrape', async (req, res) => {
  const profileUrl = req.query.url;

  if (!profileUrl) return res.status(400).json({ error: 'Missing "url" query parameter' });

  // Extract ID from URL
  const idMatch = profileUrl.match(/profile\/(\d+)/);
  const userId = idMatch ? idMatch[1] : null;

  if (!userId) return res.status(400).json({ error: 'Could not extract User ID from URL' });

  console.log(`🚀 Starting scrape for ID: ${userId}`);

  try {
      let userToken = CONFIG.manualToken;

      // Only attempt login if we don't have a manual token set
      if (!userToken) {
          try {
              const publicToken = await getPublicToken();
              userToken = await getLoginToken(publicToken);
          } catch (loginError) {
              return res.status(500).json({ 
                  error: "Auto-Login Failed (likely Captcha). Please provide SOLO_MANUAL_TOKEN in Environment Variables.",
                  details: loginError.message 
              });
          }
      } else {
          console.log('ℹ️ Using Manual Token from Environment Variables');
      }

      // Step 3: Download Data Loop
      const followers = [];
      let page = 1;
      let hasMore = true;

      const headers = {
          'Authorization': `Bearer ${userToken}`,
          'Accept': 'application/json, text/plain, */*',
          'SL-Plan-Id': '1',
          'SL-Locale': 'en',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      };

      console.log('⚡ Starting API download loop...');

      while (hasMore && page < 100) { 
          const apiUrl = `https://api2.sololearn.com/v2/userinfo/v3/profile/${userId}/followers?count=100&page=${page}`;
          
          try {
              const response = await axios.get(apiUrl, { headers });
              const data = response.data.data;

              if (data && data.length > 0) {
                  const names = data.map(u => u.name);
                  followers.push(...names);
                  console.log(`   Page ${page}: Found ${data.length} followers`);
                  
                  if (data.length < 100) hasMore = false;
                  else page++;
              } else {
                  hasMore = false;
              }
          } catch (err) {
              console.error(`   Error on page ${page}: ${err.message}`);
              if(err.response?.status === 401) {
                  throw new Error("Token Expired. Please update SOLO_MANUAL_TOKEN.");
              }
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
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
