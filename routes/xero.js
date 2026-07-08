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

    console.log('Tenants response:', JSON.stringify(tenantsRes.data));

    if (!tenantsRes.data || tenantsRes.data.length === 0) {
      console.error('No tenants found');
      return res.redirect('/?error=no_xero_tenant');
    }

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

// Search Xero contacts (for autocomplete)
router.get('/contacts', async (req, res) => {
  const search = (req.query.search || '').trim();

  try {
    const accessToken = await getAccessToken();
    const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
    const tenantId = result.rows[0]?.xero_tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'No Xero tenant found — please reconnect Xero' });
    }

    const params = new URLSearchParams({ summaryOnly: 'true' });
    if (search) params.set('SearchTerm', search);

    const contactsRes = await axios.get(`${XERO_API_URL}/Contacts?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        Accept: 'application/json'
      }
    });

    const contacts = (contactsRes.data.Contacts || []).map(c => ({
      contactId: c.ContactID,
      name: c.Name,
      email: c.EmailAddress || ''
    }));
    res.json(contacts);
  } catch (err) {
    console.error('Contacts search error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// Tin size in an item name, e.g. "10L", "2.5L" or "10ltr" (our own price-update
// script writes "ltr" while other suppliers' Xero items use "L").
const TIN_SIZE_RE = /(\d+(?:\.\d+)?)\s*l(?:tr)?\b/i;

// List paint products (account 311) for the materials-mapping settings
router.get('/items', async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
    const tenantId = result.rows[0]?.xero_tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'No Xero tenant found — please reconnect Xero' });
    }

    const itemsRes = await axios.get(`${XERO_API_URL}/Items`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        Accept: 'application/json'
      }
    });

    const allItems = itemsRes.data.Items || [];
    // 311 is the *purchase*-side (COGS) account code on these items, not the
    // sales account — every item's SalesDetails.AccountCode is '202' or blank,
    // regardless of product, so account 311 only ever shows up under
    // PurchaseDetails. (Confirmed against a live InventoryItems export: 90
    // items carry PurchaseDetails.AccountCode '311', zero carry it on Sales.)
    const items = allItems
      .filter(i => i.PurchaseDetails?.AccountCode === '311')
      .map(i => {
        const sizeMatch = i.Name.match(TIN_SIZE_RE);
        return {
          code: i.Code,
          name: i.Name,
          price: i.SalesDetails?.UnitPrice ?? null,
          tinSizeL: sizeMatch ? parseFloat(sizeMatch[1]) : null
        };
      });
    console.log(`Items fetch: ${allItems.length} total, ${items.length} matched account 311`);
    res.json(items);
  } catch (err) {
    console.error('Items fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create quote in Xero
router.post('/create-quote', async (req, res) => {
  const { clientName, jobName, xeroRef, rooms, exterior, hsl, materials, settings, markup, contactId, newContact } = req.body;

  try {
    const accessToken = await getAccessToken();
    const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
    console.log('Settings rows:', result.rows);
    const tenantId = result.rows[0]?.xero_tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'No Xero tenant found — please reconnect Xero' });
    }

    // Resolve the quote's contact: create a new Xero contact, use a selected
    // existing one, or fall back to a bare name (Xero will match/create it)
    let contact;
    if (newContact && newContact.name) {
      const hasAddress = newContact.street || newContact.town || newContact.postcode;
      const contactRes = await axios.put(
        `${XERO_API_URL}/Contacts`,
        { Contacts: [{
          Name: newContact.name,
          EmailAddress: newContact.email || undefined,
          Addresses: hasAddress ? [{
            AddressType: 'STREET',
            AddressLine1: newContact.street || '',
            City: newContact.town || '',
            PostalCode: newContact.postcode || ''
          }] : undefined
        }] },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-Tenant-Id': tenantId,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          }
        }
      );
      contact = { ContactID: contactRes.data.Contacts[0].ContactID };
    } else if (contactId) {
      contact = { ContactID: contactId };
    } else {
      contact = { Name: clientName || 'Client' };
    }

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
          AccountCode: '201'
        });
      });
    }

    // Add exterior if present
    if (exterior && exterior.cost > 0) {
      lineItems.push({
        Description: 'Exterior Works',
        Quantity: 1,
        UnitAmount: fmt(exterior.cost * mu),
        AccountCode: '201'
      });
    }

    // Add staircase woodwork if present
    if (hsl && hsl.stairWoodCost > 0) {
      lineItems.push({
        Description: 'Staircase Woodwork',
        Quantity: 1,
        UnitAmount: fmt(hsl.stairWoodCost * mu),
        AccountCode: '201'
      });
    }

    // Materials break — real Xero items on account 202 (the sales account
    // set on every item), placed after the labour lines. 311 is the
    // purchase/COGS account used only to identify which items are paint
    // materials in /auth/items — quotes are a sales document, so the line
    // itself belongs on the sales account. Priced at the item's own sell
    // price already stored in Xero, so no job markup is re-applied here
    // (unlike the labour lines above).
    if (materials) {
      materials.forEach(m => {
        lineItems.push({
          ItemCode: m.itemCode,
          Description: m.description,
          Quantity: m.quantity,
          UnitAmount: fmt(m.unitAmount),
          AccountCode: '202'
        });
      });
    }

    // Create quote in Xero
    const quoteData = {
      Quotes: [{
        Contact: contact,
        Date: new Date().toISOString().split('T')[0],
        Reference: xeroRef || '',
        LineItems: lineItems,
        LineAmountTypes: 'NoTax',
        Status: 'DRAFT'
      }]
    };

    const quoteRes = await axios.put(
      `${XERO_API_URL}/Quotes`,
      quoteData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Xero-Tenant-Id': tenantId,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      }
    );

    const quote = quoteRes.data.Quotes ? quoteRes.data.Quotes[0] : quoteRes.data;
    console.log('Quote response:', JSON.stringify(quoteRes.data).slice(0, 500));
    res.json({ ok: true, quoteId: quote?.QuoteID, quoteNumber: quote?.QuoteNumber || 'created' });

  } catch (err) {
    console.error('Create quote error:', err.response?.data || err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getAccessToken = getAccessToken;
