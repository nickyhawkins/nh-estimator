'use strict';

// ── Supplier orders ─────────────────────────────────────────────────────────
// A materials order built from one or more jobs' calculated materials and
// sent to ONE supplier by email from the phone's own mail app (mailto:). The
// server never sends anything: it keeps the address book (suppliers) and the
// log of what was ordered (supplier_orders + its jobs + its lines), which is
// what lets a job's materials say "Ordered · Brewers · 24 Sep" next to a line.
//
// No prices anywhere, by design -- this is a request to a merchant, not a
// document with money on it.
//
// db/setup.sql is not run on deploy (the same situation as quote_snapshots,
// snags and the invoices tables), so the schema is created lazily on first
// use behind the routes that need it -- once per process, memoised.

const DELIVERY_METHODS = new Set(['collect', 'site', 'home']);

// Field caps: generous for anything a person would type, small enough that a
// runaway paste can't park megabytes in a row that's read on every job open.
const SHORT_MAX = 200;
const LONG_MAX = 2000;
const BODY_MAX = 20000;

let schemaReady = null;
function ensureSupplierSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id VARCHAR PRIMARY KEY,
          name VARCHAR NOT NULL,
          email VARCHAR NOT NULL,
          account_number VARCHAR NOT NULL DEFAULT '',
          branch_name VARCHAR NOT NULL DEFAULT '',
          branch_address VARCHAR NOT NULL DEFAULT '',
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      // supplier_name is a snapshot, like shopping_list.job_tags: the history
      // has to keep reading "Brewers" after the supplier is edited or deleted
      // from Settings, and supplier_id is deliberately not a foreign key.
      await db.query(`
        CREATE TABLE IF NOT EXISTS supplier_orders (
          id VARCHAR PRIMARY KEY,
          supplier_id VARCHAR,
          supplier_name VARCHAR NOT NULL DEFAULT '',
          delivery_method VARCHAR NOT NULL,
          delivery_address VARCHAR NOT NULL DEFAULT '',
          delivery_notes VARCHAR NOT NULL DEFAULT '',
          required_by DATE,
          body_text TEXT NOT NULL DEFAULT '',
          sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`);
      await db.query(`
        CREATE TABLE IF NOT EXISTS supplier_order_jobs (
          order_id VARCHAR NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
          job_id VARCHAR NOT NULL,
          PRIMARY KEY (order_id, job_id)
        )`);
      // One row per SOURCE JOB for a line merged across jobs, so "ordered" is
      // tracked per job: ordering Ermine Street's tins says nothing about
      // whether Mill Lane's have been. line_no groups those rows back into
      // the one line the email carried (history's item count reads it).
      await db.query(`
        CREATE TABLE IF NOT EXISTS supplier_order_lines (
          id VARCHAR PRIMARY KEY,
          order_id VARCHAR NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
          line_no INTEGER NOT NULL DEFAULT 0,
          product_key VARCHAR,
          job_id VARCHAR,
          description VARCHAR NOT NULL,
          quantity NUMERIC NOT NULL DEFAULT 0,
          is_extra BOOLEAN NOT NULL DEFAULT FALSE
        )`);
      await db.query('CREATE INDEX IF NOT EXISTS supplier_order_jobs_job ON supplier_order_jobs (job_id)');
      await db.query('CREATE INDEX IF NOT EXISTS supplier_order_lines_order ON supplier_order_lines (order_id)');
      await db.query('CREATE INDEX IF NOT EXISTS supplier_order_lines_job ON supplier_order_lines (job_id)');
    })().catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// Loose on purpose: the address only has to be good enough for a mailto: link
// the user then sees in their mail app before sending. One @ with something
// either side and no spaces.
function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+$/.test(s);
}

// Returns { supplier } or { error }.
function normaliseSupplier(body) {
  body = body || {};
  const name = str(body.name, SHORT_MAX);
  const email = str(body.email, SHORT_MAX);
  if (!name) return { error: 'name is required' };
  if (!email) return { error: 'email is required' };
  if (!looksLikeEmail(email)) return { error: 'email does not look like an email address' };
  return {
    supplier: {
      name,
      email,
      accountNumber: str(body.accountNumber, SHORT_MAX),
      branchName: str(body.branchName, SHORT_MAX),
      branchAddress: str(body.branchAddress, LONG_MAX),
    },
  };
}

function isoDateOrNull(v) {
  const s = str(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return Number.isNaN(Date.parse(s + 'T00:00:00Z')) ? null : s;
}

// Returns { order } or { error }. The client builds the whole order (it is
// the one holding the calculated materials) and PUTs it once, possibly from
// the offline queue minutes later -- so this is a pure validation/shape pass
// and the route upserts by the client's id, which makes a replayed PUT a
// no-op rather than a second order.
function normaliseOrder(body) {
  body = body || {};
  const method = str(body.deliveryMethod, 20);
  if (!DELIVERY_METHODS.has(method)) return { error: 'deliveryMethod must be collect, site or home' };
  const jobIds = Array.isArray(body.jobIds)
    ? [...new Set(body.jobIds.map(j => str(j, SHORT_MAX)).filter(Boolean))]
    : [];
  if (!jobIds.length) return { error: 'jobIds is required' };
  const lines = [];
  (Array.isArray(body.lines) ? body.lines : []).forEach((l, i) => {
    if (!l) return;
    const description = str(l.description, LONG_MAX);
    const quantity = +l.quantity;
    if (!description || !Number.isFinite(quantity) || quantity <= 0) return;
    const isExtra = !!l.isExtra;
    lines.push({
      id: str(l.id, SHORT_MAX) || null,
      lineNo: Number.isFinite(+l.lineNo) ? Math.trunc(+l.lineNo) : i,
      // An extra item has no product and belongs to no job: it is a sundry
      // typed into this one order and never marks anything as ordered.
      productKey: isExtra ? null : (str(l.productKey, LONG_MAX) || null),
      jobId: isExtra ? null : (str(l.jobId, SHORT_MAX) || null),
      description,
      quantity: Math.round(quantity * 100) / 100,
      isExtra,
    });
  });
  if (!lines.length) return { error: 'an order needs at least one line' };
  const sentAt = Number.isNaN(Date.parse(body.sentAt)) ? null : new Date(body.sentAt).toISOString();
  return {
    order: {
      supplierId: str(body.supplierId, SHORT_MAX) || null,
      supplierName: str(body.supplierName, SHORT_MAX),
      deliveryMethod: method,
      // Collect has no address by definition -- don't store one the UI hid.
      deliveryAddress: method === 'collect' ? '' : str(body.deliveryAddress, LONG_MAX),
      deliveryNotes: str(body.deliveryNotes, LONG_MAX),
      requiredBy: isoDateOrNull(body.requiredBy),
      bodyText: String(body.bodyText == null ? '' : body.bodyText).slice(0, BODY_MAX),
      sentAt,
      jobIds,
      lines,
    },
  };
}

function mapSupplierRow(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    accountNumber: r.account_number || '',
    branchName: r.branch_name || '',
    branchAddress: r.branch_address || '',
  };
}

// Orders arrive from three queries (orders, their jobs, their lines) and are
// stitched here so the route stays a list of SELECTs.
function assembleOrders(orderRows, jobRows, lineRows) {
  const byId = new Map();
  const out = orderRows.map(r => {
    const o = {
      id: r.id,
      supplierId: r.supplier_id || null,
      supplierName: r.supplier_name || '',
      deliveryMethod: r.delivery_method,
      deliveryAddress: r.delivery_address || '',
      deliveryNotes: r.delivery_notes || '',
      requiredBy: r.required_by || null,
      bodyText: r.body_text || '',
      sentAt: r.sent_at instanceof Date ? r.sent_at.toISOString() : r.sent_at,
      jobIds: [],
      lines: [],
    };
    byId.set(o.id, o);
    return o;
  });
  jobRows.forEach(j => { const o = byId.get(j.order_id); if (o) o.jobIds.push(j.job_id); });
  lineRows.forEach(l => {
    const o = byId.get(l.order_id);
    if (!o) return;
    o.lines.push({
      id: l.id,
      lineNo: +l.line_no || 0,
      productKey: l.product_key || null,
      jobId: l.job_id || null,
      description: l.description,
      quantity: +l.quantity,
      isExtra: !!l.is_extra,
    });
  });
  return out;
}

module.exports = {
  DELIVERY_METHODS,
  ensureSupplierSchema,
  normaliseSupplier,
  normaliseOrder,
  mapSupplierRow,
  assembleOrders,
  // Test hook: a fresh process-level memo, for the harness only.
  _resetSchemaMemo() { schemaReady = null; },
};
