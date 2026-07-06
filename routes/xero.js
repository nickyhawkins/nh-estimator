const express = require('express');
const axios = require('axios');
const db = require('../db');
const router = express.Router();

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_URL = 'https://api.xero.com/api.xro/2.0';
const SCOPES = 'openid profile email offline_access accounting.contacts accounting.settings.read accounting.invoices';

// Step 1: Redirect to Xero login
router.get('/connect', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.XERO_CLIENT_ID,
    redirect_uri: process.env.XERO_REDIRECT_URI,
    scope: SCOPES,
    state: 'xero-auth'
  });
  res.redirect(`${XERO_AUTH_URL}?${params}`);
});

// Step 2: Handle callback from Xero
router.get('/xero/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=xero_auth_failed');

  try {
    // Exchange code for tokens
    const tokenRes = await axios.post(XERO_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.XERO_REDIRECT_URI
      }),
      {
        auth: {
          username: process.env.XERO_CLIENT_ID,
          password: process.env.XERO_CLIENT_SECRET
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const token = tokenRes.data;
    token.expires_at = Date.now() + (token.expires_in * 1000);

    // Get tenant (organisation) ID
    const tenantsRes = await axios.get('https://api.xero.com/connections', {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });

    const tenant = tenantsRes.data[0];

    // Save token and tenant to DB
    await db.query(
      'UPDATE settings SET xero_token = $1, xero_tenant_id = $2, updated_at = NOW() WHERE id = 1',
      [JSON.stringify(token), tenant.tenantId]
    );

    res.redirect('/?xero=connected');
  } catch (err) {
    console.error('Xero auth error:', err.response?.data || err.message);
    res.redirect('/?error=xero_auth_failed');
  }
});

// Disconnect Xero
router.post('/disconnect', async (req, res) => {
  await db.query('UPDATE settings SET xero_token = NULL, xero_tenant_id = NULL WHERE id = 1');
  res.json({ ok: true });
});

// Helper: get valid access token (refresh if needed)
async function getAccessToken() {
  const result = await db.query('SELECT xero_token FROM settings WHERE id = 1');
  const token = result.rows[0]?.xero_token;
  if (!token) throw new Error('Not connected to Xero');

  // Refresh if expired
  if (Date.now() > token.expires_at - 60000) {
    const refreshRes = await axios.post(XERO_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token
      }),
      {
        auth: {
          username: process.env.XERO_CLIENT_ID,
          password: process.env.XERO_CLIENT_SECRET
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );
    const newToken = { ...refreshRes.data };
    newToken.expires_at = Date.now() + (newToken.expires_in * 1000);
    await db.query(
      'UPDATE settings SET xero_token = $1, updated_at = NOW() WHERE id = 1',
      [JSON.stringify(newToken)]
    );
    return newToken.access_token;
  }

  return token.access_token;
}

// Check Xero connection status
router.get('/status', async (req, res) => {
  try {
    const result = await db.query('SELECT xero_token, xero_tenant_id FROM settings WHERE id = 1');
    const { xero_token, xero_tenant_id } = result.rows[0];
    res.json({ connected: !!xero_token, tenantId: xero_tenant_id });
  } catch (err) {
    res.json({ connected: false });
  }
});

// Create quote in Xero
router.post('/create-quote', async (req, res) => {
  const { clientName, jobName, rooms, exterior, hsl, settings, markup } = req.body;

  try {
    const accessToken = await getAccessToken();
    const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
    const tenantId = result.rows[0].xero_tenant_id;

    // Build line items from rooms
    const lineItems = [];
    const mu = 1 + (markup / 100);

    // Helper to format currency
    const fmt = (n) => Math.round(n * 100) / 100;

    // Add each room
    if (rooms) {
      rooms.forEach(room => {
        lineItems.push({
          Description: room.name,
          Quantity: 1,
          UnitAmount: fmt(room.total * mu),
          AccountCode: '200'
        });
      });
    }

    // Add exterior if present
    if (exterior && exterior.cost > 0) {
      lineItems.push({
        Description: 'Exterior Works',
        Quantity: 1,
        UnitAmount: fmt(exterior.cost * mu),
        AccountCode: '200'
      });
    }

    // Add staircase woodwork if present
    if (hsl && hsl.stairWoodCost > 0) {
      lineItems.push({
        Description: 'Staircase Woodwork',
        Quantity: 1,
        UnitAmount: fmt(hsl.stairWoodCost * mu),
        AccountCode: '200'
      });
    }

    // Create quote in Xero
    const quoteData = {
      Quotes: [{
        Title: jobName || 'Paint Estimate',
        Contact: { Name: clientName || 'Client' },
        LineItems: lineItems,
        LineAmountTypes: 'Exclusive',
        Status: 'DRAFT',
        QuoteNumber: `EST-${Date.now().toString().slice(-6)}`
      }]
    };

    const quoteRes = await axios.put(
      `${XERO_API_URL}/Quotes`,
      quoteData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Xero-Tenant-Id': tenantId,
          'Content-Type': 'application/json'
        }
      }
    );

    const quote = quoteRes.data.Quotes[0];
    res.json({ ok: true, quoteId: quote.QuoteID, quoteNumber: quote.QuoteNumber });

  } catch (err) {
    console.error('Create quote error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getAccessToken = getAccessToken;
