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

// --- AUTH HELPER: GET NEW TOKEN AUTOMATICALLY ---
async function performAutoLogin() {
    console.log('🔄 401 Detected: Attempting to refresh token automatically...');
    
    // Step 1: Handshake
    const subject = crypto.randomUUID(); 
    let publicToken = '';
    
    try {
        const r1 = await axios.post('https://www.sololearn.com/user/publicToken', 
            { subject: subject, checkboxCaptcha: false }, 
            { headers: { 'Content-Type': 'application/json' } }
        );
        publicToken = r1.data.accessToken;
    } catch (e) {
        throw new Error('Auto-Refresh Failed: Cloudflare blocked the Handshake.');
    }

    // Step 2: Login
    try {
        const r2 = await axios.post('https://api2.sololearn.com/v2/authentication/user:login', 
            {
                email: CONFIG.email,
                password: CONFIG.password,
                subject: crypto.randomUUID()
            }, 
            { headers: { 'Authorization': `Bearer ${publicToken}` } }
        );
        console.log('✅ Token Refreshed Successfully!');
        return r2.data.accessToken;
    } catch (e) {
        throw new Error('Auto-Refresh Failed: Login credentials rejected.');
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
      // 1. Start with the Manual Token (or try auto-login if manual is missing)
      let currentToken = CONFIG.manualToken;
      
      if (!currentToken) {
          try {
              currentToken = await performAutoLogin();
          } catch (e) {
              return res.status(500).json({ error: "No Initial Token: " + e.message });
          }
      }

      // 2. Data Loop
      const uniqueFollowers = new Set();
      let page = 1;
      let hasMore = true;
      let emptyPagesInARow = 0;
      let retryCount = 0; // Prevent infinite retry loops

      console.log('⚡ Starting API Loop...');

      while (hasMore && page < 500) { 
          const apiUrl = `https://api2.sololearn.com/v2/userinfo/v3/profile/${userId}/followers?count=100&page=${page}`;
          
          try {
              const response = await axios.get(apiUrl, { 
                  headers: {
                    'Authorization': `Bearer ${currentToken}`,
                    'Accept': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                  } 
              });

              const data = response.data.data;

              // Success! Reset retry count
              retryCount = 0; 

              if (data && data.length > 0) {
                  const initialCount = uniqueFollowers.size;
                  data.forEach(user => { if(user.name) uniqueFollowers.add(user.name); });
                  const newItems = uniqueFollowers.size - initialCount;
                  
                  console.log(`   Page ${page}: Received ${data.length} items (${newItems} new)`);
                  page++;
                  emptyPagesInARow = 0;
              } else {
                  console.log(`   Page ${page}: Empty list.`);
                  emptyPagesInARow++;
                  if (emptyPagesInARow >= 2) hasMore = false; // Need 2 empty pages to be sure
                  else page++; 
              }

          } catch (err) {
              // --- THE SELF-HEALING LOGIC ---
              if (err.response && err.response.status === 401 && retryCount < 2) {
                  console.log(`   ⚠️ Page ${page} failed (401 Unauthorized). Attempting fix...`);
                  try {
                      // Get a fresh token
                      currentToken = await performAutoLogin();
                      retryCount++;
                      // Do NOT increment 'page', so the loop tries this page again with the new token
                      console.log('   Create new token successful. Retrying page...');
                  } catch (refreshErr) {
                      console.error('   ❌ Auto-fix failed. Please update Manual Token.');
                      throw new Error('Token expired and Auto-Login blocked. Update SOLO_MANUAL_TOKEN.');
                  }
              } else {
                  console.error(`   Error on page ${page}: ${err.message}`);
                  hasMore = false;
              }
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
