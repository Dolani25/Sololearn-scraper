const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CONFIG
const CONFIG = {
  email: process.env.SOLO_EMAIL,
  password: process.env.SOLO_PASSWORD,
  // This "subject" string appears to be a static client identifier for the web app
  subject: "a015215e89deb453dde44800a6a04326" 
};

/**
 * HELPER: Login purely via API
 * Returns: accessToken (String)
 */
async function getApiToken() {
    console.log('🔑 Attempting API Login...');
    
    // 1. We first need a "Public" token to initialize the session.
    // Based on your inspection, there is a Bearer token in the login REQUEST.
    // However, usually for these APIs, you can hit the login endpoint with just the payload
    // OR we might need to fetch a generic public token first.
    
    // Let's try the direct login first using the headers you found.
    // If this fails, we might need to hardcode that initial "Public" Bearer token you found,
    // as it often lasts for a long time or is generic for the app client.
    
    const loginUrl = 'https://api2.sololearn.com/v2/authentication/user:login';
    
    const payload = {
        email: CONFIG.email,
        password: CONFIG.password,
        subject: CONFIG.subject
    };

    try {
        const response = await axios.post(loginUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'SL-Locale': 'en',
                'SL-Time-Zone': '+1',
                // Using a generic User-Agent to look like a browser
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (response.data && response.data.accessToken) {
            console.log('✅ API Login Successful');
            return response.data.accessToken;
        } else {
            throw new Error('No access token in login response');
        }

    } catch (error) {
        // If it fails with 401/403, it means we need that initial "Public" token.
        console.error('Login Failed:', error.response ? error.response.data : error.message);
        throw new Error('API Login Failed');
    }
}

app.get('/scrape', async (req, res) => {
  const profileUrl = req.query.url;

  if (!profileUrl) {
    return res.status(400).json({ error: 'Missing "url" query parameter' });
  }

  // Extract ID from URL
  const idMatch = profileUrl.match(/profile\/(\d+)/);
  const userId = idMatch ? idMatch[1] : null;

  if (!userId) {
      return res.status(400).json({ error: 'Could not extract User ID from URL' });
  }

  console.log(`🚀 Starting Pure-API scrape for ID: ${userId}`);

  try {
      // Step 1: Login
      const token = await getApiToken();

      // Step 2: Download Data Loop
      const followers = [];
      let page = 1;
      let hasMore = true;

      const headers = {
          'Authorization': `Bearer ${token}`,
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
                  
                  if (data.length < 100) {
                      hasMore = false;
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
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
