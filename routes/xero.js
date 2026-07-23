const express = require('express');
const axios = require('axios');
const db = require('../db');
const router = express.Router();

const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const XERO_API_URL = 'https://api.xero.com/api.xro/2.0';
// accounting.transactions is the DOCUMENTED scope covering invoices AND
// quotes (FINAL_INVOICE_SPEC.md Step 0). The legacy accounting.invoices
// name that used to sit here was NEVER a real Xero scope: the live
// connection simply predated any re-auth, so it went unnoticed until the
// 2026-07-22 reconnect, when Xero's login rejected the whole request with
// invalid_scope. Removed — do not re-add it, one bad name fails the lot.
// NB scopes apply at AUTH time: the running token keeps its old grants
// until Xero is reconnected once from Settings, so POST /Invoices may 403
// until then -- the builder's error message says so.
const SCOPES = 'openid profile email offline_access accounting.contacts accounting.settings.read accounting.transactions';

// Builds the {Contacts:[...]} entry for a Xero contact create/update PUT.
// Fields left blank are OMITTED (undefined keys never reach JSON.stringify),
// not sent as empty strings -- so updating an existing ContactID with only
// some fields filled in never clobbers real Xero data (e.g. a phone number
// already on file) with a blank the app just hasn't been given.
function buildContactPayload({ contactId, name, email, phone, street, town, postcode }) {
  const hasAddress = street || town || postcode;
  const payload = {
    Name: name || undefined,
    EmailAddress: email || undefined,
    Phones: phone ? [{ PhoneType: 'DEFAULT', PhoneNumber: phone }] : undefined,
    // AddressType 'STREET' renders as the Delivery address on a Xero
    // quote/invoice; 'POBOX' is what New Invoicing shows as the Billing
    // address. The saved job address is the client's billing address, not a
    // separate delivery address, so it must go on as POBOX.
    Addresses: hasAddress ? [{
      AddressType: 'POBOX',
      AddressLine1: street || '',
      City: town || '',
      PostalCode: postcode || ''
    }] : undefined
  };
  if (contactId) payload.ContactID = contactId;
  return payload;
}

// Shared by /create-quote's inline contact creation and /sync-contact --
// PUT /Contacts creates a new contact when no ContactID is present in the
// payload, or updates the existing one when it is.
async function putXeroContact(accessToken, tenantId, payload) {
  const contactRes = await axios.put(
    `${XERO_API_URL}/Contacts`,
    { Contacts: [payload] },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    }
  );
  const saved = contactRes.data.Contacts && contactRes.data.Contacts[0];
  if (!saved || !saved.ContactID) throw new Error('Xero did not return a contact');
  return saved;
}

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

// Manually push a job's locally-saved contact details to Xero, independent
// of creating a quote -- lets a client's name/phone/email/address be typed
// in and kept per-job (see saveJobContactFields() in public/index.html)
// long before there's a quote ready to send. With no contactId this creates
// a new Xero contact; with one, it updates that existing contact instead
// (see buildContactPayload()/putXeroContact() above).
router.post('/sync-contact', async (req, res) => {
  const { contactId, name, email, phone, street, town, postcode } = req.body;
  if (!name && !contactId) {
    return res.status(400).json({ error: 'A name is required to create a Xero contact' });
  }
  try {
    const accessToken = await getAccessToken();
    const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
    const tenantId = result.rows[0]?.xero_tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'No Xero tenant found — please reconnect Xero' });
    }
    const saved = await putXeroContact(accessToken, tenantId, buildContactPayload({ contactId, name, email, phone, street, town, postcode }));
    res.json({ ok: true, contactId: saved.ContactID });
  } catch (err) {
    console.error('Sync contact error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.Message || err.message });
  }
});

// Tin size in an item name, e.g. "10L", "2.5L", "10ltr", "2.5 ltr" or "10LT"
// (our own price-update script writes "ltr" -- the canonical form -- while
// other, not-yet-tidied suppliers' Xero items use "L", "LT", or a space before
// the unit). "ltr" is the convention; the rest are legacy forms we tolerate on
// read, per MATERIALS_SPEC.md's "parse sizes robustly" rule. Isomat's "10LT" is
// why the "t" is optional independently of the "r": without it the \b can't
// fire between the "L" and the "T", and 8 real paint tins parsed as size-less
// and were silently discarded by groupMaterialItems().
const TIN_SIZE_RE = /(\d+(?:\.\d+)?)\s*l(?:tr?)?\b/i;
// Millilitres, for suppliers that haven't been tidied yet (e.g. "750ml").
const TIN_SIZE_ML_RE = /(\d+(?:\.\d+)?)\s*ml\b/i;

// Tikkurila tins hold 10% less than the size on their label: an "Optiva 5 3ltr"
// tin reads 2.7L on the pot. Tikkurila publish the convention per size — 1 LTR
// = 0.9L min, 3 LTR = 2.7L, 10 LTR = 9L, 20 LTR = 18L.
//
// This applies to EVERY colour band, White included, and the reason is how the
// paint is made rather than what's in it. A range ships as two bases — Optiva 5
// is Base A and Base C — and Xero's three bands are three *prices* over those
// two *paints*: Base A covers White and Pastels, Base C covers the deep
// Colours. A "White" tin is a Base A tin. It comes off the same line, filled to
// the same 2.7L, as the Base A tin that gets tinted into a pastel. Selling it
// untinted doesn't put the missing 300ml back.
//
// So do NOT reinstate a White/Clear exemption on the reasoning that untinted
// paint needs no headspace for colourant. That argument sounds right, matches
// the price list's "minimum contents of all TINTED products" wording, and is
// wrong — it was tried on 2026-07-14 and contradicted by Nicky reading 9L off
// an Otex Akva White 10ltr. The bands are a pricing artefact, not a fill one.
//
// The label is what the tin is sold and invoiced as, so it stays exactly as
// Xero has it — but every volume-based sum (tin optimisation, cost per litre)
// must use the real content or it over-estimates coverage and under-estimates
// cost. Before this existed, every tinted job bought exactly 90% of the paint
// it quoted for.
//
// Scoped to the ranges Nicky specifies. The other ~118 Tikkurila ranges fall
// through to their labelled size deliberately — a blanket Tikkurila-wide 0.9
// would be wrong for the thinners and solvents (never tinted, full tins) and
// for the handful of products whose real contents are documented in
// tikkurila.json's _irregular_sizes and aren't 10% off at all (Helmi Wood Oil
// labels a 0.5L tin as "3ltr"; Pontti Floor Oil's "3ltr" is 2.5L).
const TIK_REDUCED_FILL_RANGES = new Set([
  'Optiva 3', 'Optiva 5', 'Nova 2', 'Otex Akva',
  'Helmi 10', 'Helmi 30', 'Helmi 80', 'Luja Matt (7)',
]);

// Anti Reflex 2 is deliberately absent: Nicky read a full 10L off its 10ltr
// tin, so it's left at nominal on his instruction ("this rule applies to all
// of them except Anti Reflex"). By the base logic above that reading should
// generalise across its bands, which is why no band of it is reduced. If an
// Anti Reflex 2 Pastels/Magnolia tin ever turns up reading 9L, this is the
// line to revisit.

const TIK_FILL = 0.9;

// Real content of a tin, given its range and labelled size.
//
// Per-litre SKUs are exempt: they sell a litre as a litre, so the fill of the
// tin they're decanted from doesn't change what the customer receives. That
// discrepancy belongs in the SKU's rate instead — see the (per litre) section
// in scripts/pricelists/README.md before touching one.
function trueFill(range, sizeL, isPerLitre) {
  if (isPerLitre) return sizeL;
  if (!TIK_REDUCED_FILL_RANGES.has(range.replace(/^Tikkurila /, ''))) return sizeL;
  return Math.round(sizeL * TIK_FILL * 1000) / 1000;
}

// Find a tin size anywhere in a name and return it normalised to litres,
// along with where the match starts/ends so callers can split off whatever
// came before it. Prefers a litre match over a millilitre one since "l"
// never accidentally matches inside "ml" (a digit can't sit directly before
// the "l" in "50ml" — "m" does) — trying litres first is just the common case.
function parseSize(name) {
  const lMatch = name.match(TIN_SIZE_RE);
  if (lMatch) return { sizeL: parseFloat(lMatch[1]), start: lMatch.index, end: lMatch.index + lMatch[0].length };
  const mlMatch = name.match(TIN_SIZE_ML_RE);
  if (mlMatch) return { sizeL: parseFloat(mlMatch[1]) / 1000, start: mlMatch.index, end: mlMatch.index + mlMatch[0].length };
  return null;
}

// Marks a "sell any fractional quantity at this rate" item, e.g. "Tikkurila
// Anti Reflex 2 - White 1ltr (per litre)" — distinct from a genuine discrete
// tin even though it parses to the same sizeL. Confirmed against real data:
// the per-litre price matches the range's 10L tin price ÷ 10 almost exactly
// (e.g. £56.78 / 10 = £5.678 ≈ £5.69), i.e. it's priced at the bulk rate, not
// a small-tin markup — a genuine per-litre SKU, not just a 1L tin.
const PER_LITRE_RE = /\(\s*per\s+litre\s*\)/i;

// Parse "Range - Band SizeLtr[ (per litre)]" into its parts, per the naming
// convention MATERIALS_SPEC.md documents (enforced by
// scripts/update_supplier_prices.py) — but degrade gracefully for suppliers
// that haven't been tidied yet: colour bands are optional (band: '' when
// there's no separate band segment), and a name with no ' - ' at all still
// gets a range, just no band. Only a name with no parseable size at all is
// unusable and returns sizeL: null.
function parseItemName(name) {
  const size = parseSize(name);
  const isPerLitre = PER_LITRE_RE.test(name);
  if (!size) return { range: name, band: null, sizeL: null, isPerLitre };
  let prefix = name.slice(0, size.start).trim();
  let range, band;
  if (prefix.endsWith('-')) {
    // "Range - 5ltr" — the dash separates range from size with an empty band.
    range = prefix.slice(0, -1).trim();
    band = '';
  } else {
    const sep = prefix.lastIndexOf(' - ');
    range = sep === -1 ? prefix : prefix.slice(0, sep);
    band = sep === -1 ? '' : prefix.slice(sep + 3).trim();
  }
  return { range, band, sizeL: size.sizeL, trueL: trueFill(range, size.sizeL, isPerLitre), isPerLitre };
}

// A sundry is declared by its item CODE, not derived from its name — see
// "Identifying specific sundries" in MATERIAL_TRACKING_SPEC.md. Nicky curates
// the SUN prefix in Xero to mean "itemise this on the job"; the app trusts it
// and does not second-guess. Deliberately NOT account 314: 314 is a real cost
// account with its own P&L meaning ("sundries cost"), and letting the app's
// needs reshape the accounts would force tape and floor protection onto some
// other account purely to satisfy this parser. The code prefix has no second
// job, so it's free to carry this one — and it survives the accountant
// re-coding accounts.
const SUNDRY_CODE_RE = /^SUN/i;

// Split the Xero item list into the three things it actually contains, keyed
// off the item code FIRST and the name only second:
//
//   sundries     — code starts SUN. Flat: item + qty + price, no size, no
//                  band, no tin optimisation. Wallpaper paste, lining paper.
//   paint        — anything else whose name yields a tin size. range -> band
//                  -> sizes, the hierarchy the optimiser needs.
//   unmodellable — anything else that DOESN'T parse. Surfaced for diagnosis,
//                  offered to no picker.
//
// THE BUCKET ORDER IS LOAD-BEARING. The prefix check must run before the size
// parse, and it does more work than it looks like:
//
//  - It fixes a client-facing description bug for free, with no regex change.
//    SUN013 "Quickgrip Adhesive (380ml tube)" and SUN014 "Everbuild Stixall
//    Adhesive (White) - 290ml" used to reach parseItemName(), which sliced the
//    prefix at the digit and invented the range "Quickgrip Adhesive (" —
//    trailing bracket and all. Since line descriptions are rebuilt from
//    range + band + sizeL, picking one put "Quickgrip Adhesive ( 0.38ltr" on a
//    client's quote. Bucketing them as sundries first means they never reach
//    the parser at all. (Verified 2026-07-14: these two are the only SUN items
//    that parse a size, so this is exactly the leak the order closes.)
//  - BED002 "Bedec MSP ... 750ml" stays in paint, correctly — it's a genuine
//    sub-litre tin, not a tube, and it isn't SUN.
//
// "Didn't parse" is NOT a category — it's a bug bucket, which is why it must
// stay separate from sundries rather than being swept in as "no size = sundry".
// The live data proves it: doing that would have surfaced 8 real Isomat paint
// tins (killed by the old LT regex gap) as pickable *sundries*, permanently
// masking the fact that four paint ranges were missing from the app entirely.
// Keep the parse-failure bucket loud.
//
// Residual ml false positives are accepted, do not fix: ISO076-ISO079 (Isomat
// caulks and PU sealants) still parse as 0.28-0.6L "tins" and stay in paint.
// The optimiser only reads ranges explicitly mapped to a role and nobody maps
// a caulk as paint, so there's no costing exposure — and they can't be SUN
// either, because caulk is exactly what the sundries % already recovers. They
// clutter the range picker with four fake sub-litre entries. That is the whole
// cost. Don't invent a fourth bucket for it.
//
// Within paint: sizes ascending. Unbanded products group under band '' (a
// single implicit band) rather than being dropped. isPerLitre entries stay in
// the same sizes array (a real, choosable price point) but are flagged so
// callers can tell them apart: the wall tin optimiser (step 4) should exclude
// them from tin-combination candidates, and the per-litre roles —
// ceiling/topcoat/primer (step 5) — should prefer one directly (litres ×
// price, no rounding) over combining tins.
//
// sizeL and trueL are both carried because they answer different questions and
// diverge on every band of TIK_REDUCED_FILL_RANGES. sizeL is what the
// tin is called —
// use it for anything a customer reads (invoice line descriptions, Summary
// detail, the picker). trueL is what's in it — use it for anything that adds
// up (tin optimisation, cost per litre). They're equal for every range not in
// that table, which is why mixing them up survives casual testing.
function groupMaterialItems(items) {
  const paint = {};
  const sundries = [];
  const unmodellable = [];
  items.forEach(i => {
    const price = i.SalesDetails?.UnitPrice ?? null;
    // Code first, name second — see the bucket-order note above.
    if (SUNDRY_CODE_RE.test(i.Code || '')) {
      // Flat by design: no size, no band, no tin optimisation. The description
      // is the raw Xero name because that IS the product — there's no
      // range/band/size to rebuild it from, and a sundry's name is already
      // what it should read as on a quote.
      sundries.push({ itemCode: i.Code, description: i.Name, price });
      return;
    }
    const { range, band, sizeL, trueL, isPerLitre } = parseItemName(i.Name);
    if (sizeL == null) {
      unmodellable.push({ itemCode: i.Code, name: i.Name });
      return;
    }
    if (!paint[range]) paint[range] = {};
    if (!paint[range][band]) paint[range][band] = [];
    paint[range][band].push({ sizeL, trueL, price, itemCode: i.Code, isPerLitre });
  });
  Object.values(paint).forEach(bands =>
    Object.values(bands).forEach(sizes => sizes.sort((a, b) => a.sizeL - b.sizeL))
  );
  sundries.sort((a, b) => a.description.localeCompare(b.description));
  unmodellable.sort((a, b) => (a.itemCode || '').localeCompare(b.itemCode || ''));
  return { paint, sundries, unmodellable };
}

// The three item buckets — { paint, sundries, unmodellable } — for the
// materials pickers. Paint supersedes the flat per-tin /items picker per
// MATERIALS_SPEC.md: the app picks a default RANGE (not a single tin) and
// later chooses the cheapest combination of that range's tin sizes to cover
// the litres a job needs.
//
// NB the response is the three-bucket envelope, NOT a bare range map — the
// frontend unwraps .paint into materialGroupsCache. Callers that treat the
// whole body as ranges will show "paint"/"sundries"/"unmodellable" as three
// fake ranges.
// Short in-memory cache: this endpoint is on the app's startup critical
// path (initApp populates materialGroupsCache from it on every load), and
// the upstream Xero Items fetch is by far the slowest call the server
// makes. Prices change when the price-update script runs, not minute to
// minute, so a few minutes of staleness is free speed on every app open.
// The Settings "Refresh from Xero" button sends ?fresh=1 to bypass, so a
// deliberate refresh is always a real fetch.
let materialGroupsCache = null;      // { at: epoch-ms, body: buckets }
const MATERIAL_GROUPS_TTL_MS = 5 * 60 * 1000;

router.get('/material-groups', async (req, res) => {
  try {
    if (!req.query.fresh && materialGroupsCache && Date.now() - materialGroupsCache.at < MATERIAL_GROUPS_TTL_MS) {
      return res.json(materialGroupsCache.body);
    }
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
    // 202 is the sales account — what the customer is charged. 311 (purchase
    // side) was used to identify materials before the user re-coded their
    // Xero data; every material item now carries SalesDetails.AccountCode
    // 202, so filter on that directly, per MATERIALS_SPEC.md.
    const salesItems = allItems.filter(i => i.SalesDetails?.AccountCode === '202');
    const buckets = groupMaterialItems(salesItems);
    // Log all three counts, not just ranges. The unmodellable count is the
    // health signal: it should sit at its known baseline (11 Isomat kg-sold
    // products as of 2026-07-14 — see scripts/check_item_parse.py). A jump
    // means a parse regression is eating real paint, which is otherwise
    // silent. It is NOT expected to be zero, and treating it as an error
    // bucket is how the next LT-class bug would hide among the residents.
    console.log(
      `Material groups: ${allItems.length} total items, ${salesItems.length} on account 202 -> ` +
      `${Object.keys(buckets.paint).length} paint ranges, ${buckets.sundries.length} sundries, ` +
      `${buckets.unmodellable.length} unmodellable`
    );
    if (buckets.unmodellable.length) {
      console.log('  unmodellable: ' + buckets.unmodellable.map(u => u.itemCode).join(', '));
    }
    materialGroupsCache = { at: Date.now(), body: buckets };
    res.json(buckets);
  } catch (err) {
    console.error('Material groups fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create quote in Xero
router.post('/create-quote', async (req, res) => {
  const { clientName, jobName, xeroRef, rooms, exterior, kitchen, materials, settings, markup, markupType, paymentTerms, paymentSummary, contactId, newContact } = req.body;

  try {
    const accessToken = await getAccessToken();
    const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
    console.log('Settings rows:', result.rows);
    const tenantId = result.rows[0]?.xero_tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'No Xero tenant found — please reconnect Xero' });
    }

    // Resolve the quote's contact: create a new Xero contact, use a selected
    // existing one, or fall back to a bare name (Xero will match/create it).
    // newContact only reaches here when the client has no persisted/linked
    // Xero contact yet -- see saveJobContactFields()/syncContactToXero() in
    // public/index.html, which is the normal way contact details now travel.
    let contact;
    if (newContact && newContact.name) {
      const saved = await putXeroContact(accessToken, tenantId, buildContactPayload(newContact));
      contact = { ContactID: saved.ContactID };
    } else if (contactId) {
      contact = { ContactID: contactId };
    } else {
      contact = { Name: clientName || 'Client' };
    }

    // Build line items from rooms
    const lineItems = [];
    // A flat £ markup/discount (markupType: 'fixed') is expressed as a ratio
    // of the raw labour subtotal, same as markupRatio()/mk in the client's
    // Summary breakdown -- so it distributes proportionally across the
    // per-room/exterior/kitchen lines below and still nets out to exactly
    // rawLabourSubtotal + markup once every line is summed.
    let rawLabourSubtotal = 0;
    if (rooms) rooms.forEach(r => { rawLabourSubtotal += r.total; });
    if (exterior && exterior.cost > 0) rawLabourSubtotal += exterior.cost;
    if (kitchen && kitchen.cost > 0) rawLabourSubtotal += kitchen.cost;
    const mu = markupType === 'fixed'
      ? 1 + (rawLabourSubtotal > 0 ? markup / rawLabourSubtotal : 0)
      : 1 + (markup / 100);

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

    // Add exterior — one line per exterior item (its own label + cost),
    // mirroring how each room above is its own line, instead of a single
    // lump "Exterior Works" total. Falls back to the lump line if an older
    // client sends only exterior.cost with no itemised array.
    if (exterior && exterior.items && exterior.items.length > 0) {
      exterior.items.forEach(item => {
        if (item.total > 0) {
          lineItems.push({
            Description: item.label || 'Exterior',
            Quantity: 1,
            UnitAmount: fmt(item.total * mu),
            AccountCode: '201'
          });
        }
      });
    } else if (exterior && exterior.cost > 0) {
      lineItems.push({
        Description: 'Exterior Works',
        Quantity: 1,
        UnitAmount: fmt(exterior.cost * mu),
        AccountCode: '201'
      });
    }

    // Kitchen Cabinet Spray Calculator -- one lump line, unlike rooms/
    // exterior's per-item breakdown, since a kitchen is a single per-job
    // config (job.kitchen) rather than a list of separately-labelled
    // things. The door/drawer/end-panel/filler/cornice/plinth/carcass
    // split is visible on the app's own Kitchen tab and Summary breakdown;
    // the Xero quote only needs the one billable total.
    if (kitchen && kitchen.cost > 0) {
      lineItems.push({
        Description: 'Kitchen Cabinet Spraying',
        Quantity: 1,
        UnitAmount: fmt(kitchen.cost * mu),
        AccountCode: '201'
      });
    }

    // Staircase/HSL entries are now just rooms (see the room-alignment work
    // in public/index.html) -- their woodwork cost is already baked into
    // room.total via the rooms.forEach loop above, pushed as that room's own
    // line item. No separate staircase line here; adding one would
    // double-count exactly the woodwork the room's own line already covers.

    // Materials break — real Xero items on account 202 (the sales account
    // set on every item), placed after the labour lines. 311 is the
    // purchase/COGS account used only to identify which items are paint
    // materials in /auth/items — quotes are a sales document, so the line
    // itself belongs on the sales account. Priced at the item's own sell
    // price already stored in Xero, so no job markup is re-applied here
    // (unlike the labour lines above, and unlike the sundries line below).
    if (materials && materials.length > 0) {
      // Text-only divider row, matching the manual convention: no ItemCode,
      // Quantity or UnitAmount at all (not even zero) — Xero renders a line
      // item with only a Description as plain narrative text, no columns.
      // Reads as a plain heading since the API can't apply bold/shading to
      // one row differently from the others -- every LineItem renders
      // through the same repeated table row in the DOCX template, so any
      // real visual distinction (bold, shaded background) has to happen
      // there, not here.
      lineItems.push({ Description: 'MATERIALS' });
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

    // Sundries & consumables — a % of raw labour (before markup), same as
    // the app's own Summary card. Booked on account 202 alongside materials
    // for bookkeeping purposes (it's consumables, not labour), but unlike
    // every other 202 line it DOES get markup applied here, since the
    // confirmed calc order is labour + sundries -> x markup -> + materials
    // (materials alone stay unmarked-up, at their real Xero sell price).
    // Placed last on the quote (after materials), per request.
    // See MATERIALS_SPEC.md's Materials editing section.
    const sundriesPct = (settings && settings.sundriesPct) || 0;
    if (sundriesPct > 0) {
      const sundriesAmount = rawLabourSubtotal * (sundriesPct / 100);
      if (sundriesAmount > 0) {
        lineItems.push({
          Description: 'Sundries & Consumables',
          Quantity: 1,
          UnitAmount: fmt(sundriesAmount * mu),
          AccountCode: '202'
        });
      }
    }

    // Create quote in Xero
    const quoteData = {
      Quotes: [{
        Contact: contact,
        Date: new Date().toISOString().split('T')[0],
        Reference: xeroRef || '',
        LineItems: lineItems,
        LineAmountTypes: 'NoTax',
        Status: 'DRAFT',
        // Confirmed against a real generated quote: this API property (Terms)
        // maps to the DOCX merge field «QuoteTerms» -- NOT the plain «Terms»
        // name, which doesn't resolve. Full explanatory sentence, see
        // buildPaymentTermsText() client-side.
        Terms: paymentTerms || undefined,
        // Compact deposit/balance figures only, kept separate from Terms so
        // the DOCX template can bold just the numbers -- confirmed this API
        // property maps to the DOCX field «Summary» (plain, unprefixed).
        Summary: paymentSummary || undefined
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
    // Resolved contact ID, whichever of the three paths above produced it --
    // including the bare-name fallback, where Xero itself matches/creates
    // the contact and reports it back on the quote. The client persists this
    // onto the job so a second quote/sync for the same client reuses the
    // same Xero contact instead of creating a duplicate.
    const resolvedContactId = contact.ContactID || quote?.Contact?.ContactID || null;
    res.json({ ok: true, quoteId: quote?.QuoteID, quoteNumber: quote?.QuoteNumber || 'created', contactId: resolvedContactId });

  } catch (err) {
    console.error('Create quote error:', err.response?.data || err.message);
    console.error('Stack:', err.stack);
    res.status(500).json({ error: err.message });
  }
});

// Push a quote's status to Xero -- called when a quote is marked Accepted/
// Declined in the app (see setJobStatusById() in public/index.html), so the
// Xero copy reflects the client's real answer without re-keying it there.
//
// Xero's quote status machine only reaches ACCEPTED/DECLINED via SENT
// (DRAFT -> SENT -> ACCEPTED | DECLINED), and this app creates every quote
// as DRAFT -- so a quote that was never emailed out of Xero (e.g. shown in
// person) needs the SENT hop written first. The current status is read
// fresh from Xero rather than tracked locally: if Nicky already sent or
// accepted it inside Xero, the hop (or the whole call) is skipped.
//
// Target SENT is allowed too, but only as the un-accept path: the app sends
// it when a job that previously synced ACCEPTED/DECLINED moves back to
// Draft, un-sticking the Xero copy (ACCEPTED -> SENT is a legal reversal).
// A quote still sitting at DRAFT is never advanced by it.
const QUOTE_STATUS_TARGETS = new Set(['ACCEPTED', 'DECLINED', 'SENT']);

router.post('/update-quote-status', async (req, res) => {
  const { quoteId } = req.body;
  const target = String(req.body.status || '').toUpperCase();
  if (!quoteId) return res.status(400).json({ error: 'quoteId is required' });
  if (!QUOTE_STATUS_TARGETS.has(target)) {
    return res.status(400).json({ error: `status must be one of: ${[...QUOTE_STATUS_TARGETS].join(', ')}` });
  }

  try {
    const accessToken = await getAccessToken();
    const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
    const tenantId = result.rows[0]?.xero_tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'No Xero tenant found — please reconnect Xero' });
    }
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };

    const getRes = await axios.get(`${XERO_API_URL}/Quotes/${quoteId}`, { headers });
    const quote = getRes.data.Quotes && getRes.data.Quotes[0];
    if (!quote) return res.status(404).json({ error: 'Quote not found in Xero' });

    const current = quote.Status;
    if (current === target) return res.json({ ok: true, status: current });
    if (current === 'INVOICED' || current === 'DELETED') {
      return res.status(409).json({ error: `Quote is ${current} in Xero and can no longer be marked ${target}` });
    }
    if (target === 'SENT' && current === 'DRAFT') {
      // Un-accept path only (see above) -- a never-sent draft stays a draft.
      return res.json({ ok: true, status: current });
    }

    // A status update POST still requires the mandatory quote fields
    // (Contact + Date) alongside QuoteID; everything else (line items,
    // terms) is left off and survives untouched. DateString is preferred
    // because with Accept: application/json the Date property comes back
    // in .NET "/Date(ms)/" form, not ISO.
    const quoteDate = quote.DateString ? quote.DateString.split('T')[0] : quote.Date;
    const postStatus = (status) => axios.post(
      `${XERO_API_URL}/Quotes/${quoteId}`,
      { Quotes: [{ QuoteID: quoteId, Contact: { ContactID: quote.Contact.ContactID }, Date: quoteDate, Status: status }] },
      { headers }
    );

    if (current === 'DRAFT') await postStatus('SENT');
    await postStatus(target);
    res.json({ ok: true, status: target });
  } catch (err) {
    console.error('Update quote status error:', err.response?.data || err.message);
    const xeroMsg = err.response?.data?.Elements?.[0]?.ValidationErrors?.[0]?.Message
      || err.response?.data?.Message;
    res.status(500).json({ error: xeroMsg || err.message });
  }
});

// Final-invoice builder (FINAL_INVOICE_SPEC.md): writes the assembled
// invoice the client-side review screen produced. The CLIENT is the source
// of truth for the assembly (labour as quoted, variations, actuals-based
// materials, negative-quantity deduction lines) -- this route just maps
// lines to Xero's shape and writes ONE DRAFT ACCREC invoice. Always DRAFT,
// never AUTHORISED: Nicky reviews and sends from Xero, and any bug's blast
// radius stays "a deletable draft". Mirrors /create-quote's conventions:
// LineAmountTypes NoTax, description-only rows as dividers, 202 for
// materials/sundries and 201 for labour.
router.post('/create-invoice', async (req, res) => {
  const { contactId, clientName, reference, lineItems } = req.body;
  if (!Array.isArray(lineItems) || !lineItems.length) {
    return res.status(400).json({ error: 'lineItems required' });
  }

  try {
    const accessToken = await getAccessToken();
    const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
    const tenantId = result.rows[0]?.xero_tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'No Xero tenant found — please reconnect Xero' });
    }

    const contact = contactId ? { ContactID: contactId } : { Name: clientName || 'Client' };
    const fmt2 = (n) => Math.round(n * 100) / 100;
    const xeroLines = lineItems.map(l => {
      // Description-only divider (the MATERIALS heading) -- no columns at
      // all, same convention as the quote path.
      if (l.quantity == null && l.unitAmount == null && !l.itemCode) {
        return { Description: l.description };
      }
      const line = {
        Description: l.description,
        Quantity: +l.quantity || 0,
        UnitAmount: fmt2(+l.unitAmount || 0),
        AccountCode: l.accountCode || (l.itemCode ? '202' : '201')
      };
      if (l.itemCode) line.ItemCode = l.itemCode;
      return line;
    });

    const invRes = await axios.put(
      `${XERO_API_URL}/Invoices`,
      {
        Invoices: [{
          Type: 'ACCREC',
          Contact: contact,
          Date: new Date().toISOString().split('T')[0],
          Status: 'DRAFT',
          LineAmountTypes: 'NoTax',
          Reference: reference || '',
          LineItems: xeroLines
        }]
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Xero-Tenant-Id': tenantId,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      }
    );
    const invoice = invRes.data.Invoices && invRes.data.Invoices[0];
    if (!invoice || !invoice.InvoiceID) throw new Error('Xero did not return an invoice');
    res.json({ ok: true, invoiceId: invoice.InvoiceID, invoiceNumber: invoice.InvoiceNumber || 'created' });
  } catch (err) {
    console.error('Create invoice error:', err.response?.data || err.message);
    const status = err.response?.status;
    const xeroMsg = err.response?.data?.Elements?.[0]?.ValidationErrors?.[0]?.Message
      || err.response?.data?.Message;
    // The known scope gap (FEATURES.md): tokens granted before
    // accounting.transactions joined SCOPES can't write invoices until
    // Xero is reconnected once. Say so instead of a bare 403.
    const hint = (status === 401 || status === 403)
      ? ' — this can mean Xero needs reconnecting once to grant invoice permission (Summary → Connect Xero)'
      : '';
    res.status(500).json({ error: (xeroMsg || err.message) + hint });
  }
});

// Inward half of the quote-status sync (JOB_PIPELINE_SPEC.md Part 3) --
// batch-reads the given quotes so the app can learn about answers given
// through Xero's own portal/email without them being re-typed. Read-only.
// Per-quote failures never fail the batch: a quote Xero no longer has
// (hard 404) reports status DELETED so the client can drop its dead link,
// and any other per-quote error reports status null, which the client
// ignores (it's a poll -- the next app open retries).
router.get('/quote-statuses', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'ids is required' });

  try {
    const accessToken = await getAccessToken();
    const result = await db.query('SELECT xero_tenant_id FROM settings WHERE id = 1');
    const tenantId = result.rows[0]?.xero_tenant_id;
    if (!tenantId) {
      return res.status(400).json({ error: 'No Xero tenant found — please reconnect Xero' });
    }
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept: 'application/json'
    };

    const statuses = await Promise.all(ids.map(id =>
      axios.get(`${XERO_API_URL}/Quotes/${encodeURIComponent(id)}`, { headers })
        .then(r => {
          const quote = r.data.Quotes && r.data.Quotes[0];
          return { quoteId: id, status: quote ? quote.Status : null };
        })
        .catch(err => ({ quoteId: id, status: err.response?.status === 404 ? 'DELETED' : null }))
    ));
    res.json({ ok: true, statuses });
  } catch (err) {
    console.error('Quote statuses error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getAccessToken = getAccessToken;
// Exported for the tin-fill checks in scripts/check_item_parse.py's Node
// counterpart and for ad-hoc verification against a real Xero export.
module.exports.parseItemName = parseItemName;
module.exports.trueFill = trueFill;
module.exports.groupMaterialItems = groupMaterialItems;
module.exports.TIK_REDUCED_FILL_RANGES = TIK_REDUCED_FILL_RANGES;
