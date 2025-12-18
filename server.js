const express = require('express');
const axios = require('axios');
const crypto = require('crypto'); 
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// CONFIG
const CONFIG = {
  email: process.env.SOLO_EMAIL,
  password: process.env.SOLO_PASSWORD,
  manualToken: process.env.SOLO_MANUAL_TOKEN 
};

// --- STEP 1: HANDSHAKE (Get Public Token) ---
async function getPublicToken() {
    console.log('🤝 Step 1: Requesting Public Handshake Token...');
    const subject = crypto.randomUUID(); 
    try {
        const response = await axios.post('https://www.sololearn.com/user/publicToken', 
            { subject: subject, checkboxCaptcha: false }, 
            { headers: { 'Content-Type': 'application/json' } }
        );
        if (response.data && response.data.accessToken) return response.data.accessToken;
        throw new Error('No public token returned');
    } catch (error) {
        throw new Error('Handshake Failed. Cloudflare blocked the request.');
    }
}

// --- STEP 2: LOGIN (Get User Token) ---
async function getLoginToken(publicToken) {
    console.log('🔑 Step 2: Attempting Login...');
    try {
        const response = await axios.post('https://api2.sololearn.com/v2/authentication/user:login', 
            {
                email: CONFIG.email,
                password: CONFIG.password,
                subject: crypto.randomUUID()
            }, 
            {
                headers: {
                    'Authorization': `Bearer ${publicToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        if (response.data && response.data.accessToken) return response.data.accessToken;
        throw new Error('No user token returned');
    } catch (error) {
        console.error('   ❌ Login Failed:', error.response?.data || error.message);
        throw error;
    }
}

// --- MAIN SCRAPE ROUTE ---
app.get('/scrape', async (req, res) => {
  const profileUrl = req.query.url;
  if (!profileUrl) return res.status(400).json({ error: 'Missing "url" query parameter' });

  const idMatch = profileUrl.match(/profile\/(\d+)/);
  const userId = idMatch ? idMatch[1] : null;
  if (!userId) return res.status(400).json({ error: 'Could not extract User ID from URL' });

  console.log(`🚀 Starting scrape for ID: ${userId}`);

  try {
      // AUTHENTICATION FLOW
      let userToken = CONFIG.manualToken;
      if (!userToken) {
          try {
              const publicToken = await getPublicToken();
              userToken = await getLoginToken(publicToken);
          } catch (loginError) {
              return res.status(500).json({ 
                  error: "Auto-Login Failed. Please update SOLO_MANUAL_TOKEN in Render Environment Variables.",
                  details: loginError.message 
              });
          }
      } else {
          console.log('ℹ️ Using Manual Token from Env');
      }

      // DATA EXTRACTION LOOP
      // We use a Set to automatically handle duplicates if the API acts weird
      const uniqueFollowers = new Set();
      let page = 1;
      let hasMore = true;
      let emptyPagesInARow = 0;

      const headers = {
          'Authorization': `Bearer ${userToken}`,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      };

      console.log('⚡ Starting Aggressive API Loop...');

      // Loop limit set to 500 pages (50,000 followers) just in case
      while (hasMore && page < 500) { 
          const apiUrl = `https://api2.sololearn.com/v2/userinfo/v3/profile/${userId}/followers?count=100&page=${page}`;
          
          try {
              const response = await axios.get(apiUrl, { headers });
              const data = response.data.data;

              if (data && data.length > 0) {
                  const initialCount = uniqueFollowers.size;
                  
                  data.forEach(user => {
                      if(user.name) uniqueFollowers.add(user.name);
                  });

                  const newItemsFound = uniqueFollowers.size - initialCount;
                  console.log(`   Page ${page}: Received ${data.length} items (${newItemsFound} new unique)`);
                  
                  page++;
                  emptyPagesInARow = 0; // Reset empty counter
              } else {
                  console.log(`   Page ${page}: Returned empty list.`);
                  // Double check: sometimes APIs glitch. We only stop if we hit an empty page.
                  emptyPagesInARow++;
                  if (emptyPagesInARow >= 1) {
                      hasMore = false;
                      console.log('   🛑 End of list reached.');
                  }
              }
          } catch (err) {
              console.error(`   Error on page ${page}: ${err.message}`);
              hasMore = false;
          }
      }

      const finalList = Array.from(uniqueFollowers);
      
      res.json({
          success: true,
          profileId: userId,
          count: finalList.length,
          followers: finalList
      });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
