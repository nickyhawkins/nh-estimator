// Putting a file on a Xero invoice (WINDOWS_DOORS_INVOICE_SPEC.md section 3):
// the Windows and doors work report, attached to the final invoice with
// IncludeOnline=true so the client sees it on the online invoice and in the
// emailed one.
//
// IDEMPOTENT BY FILE NAME. Xero's Attachments API has no delete, and no
// Idempotency-Key for a file upload, so a retry after a lost reply must not
// add a second copy. Before uploading, the invoice's attachments are listed,
// and one already carrying this file name means the earlier attempt landed:
// it's recorded as attached and nothing is sent. The name carries the invoice
// number (Work-Report-INV-0421.pdf), so it is unique per invoice.
//
// LIMITS (Xero developer docs, checked 2026-09-30): at most 10 attachments
// per invoice. The Invoices page says each file may be up to 25MB, but the
// Attachments endpoint's own page says 10MB per file -- the stricter figure is
// the one to plan for. The report is vector drawings and a subset font (a
// 22-opening job is ~80KB), and MAX_BYTES below refuses anything that has
// somehow grown past 5MB rather than let Xero reject it.
//
// Pure apart from the http it's given, so the rules are testable with no
// Xero connection (scripts/test-windoors-invoice.js).

const XERO_API_URL = 'https://api.xero.com/api.xro/2.0';
const ATTACHMENTS_SCOPE = 'accounting.attachments';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

// Does a token carry the scope? A connection made before attachments were
// asked for can't attach until it is reconnected once.
function hasAttachmentsScope(token) {
  const scope = (token && token.scope) || '';
  return String(scope).split(/\s+/).indexOf(ATTACHMENTS_SCOPE) !== -1;
}

// A 401/403 from the attachments endpoints is the permission this connection
// wasn't granted.
function isPermissionError(err) {
  const status = err && err.response && err.response.status;
  return status === 401 || status === 403;
}

// http: an axios-shaped function ({ method, url, data, headers }) => { data }.
// Resolves { attachmentId, skipped } -- skipped: it was already there.
async function attachPdfOnce({ http, accessToken, tenantId, invoiceId, fileName, bytes }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(invoiceId || ''))) throw new Error('invoiceId is not a Xero invoice id');
  if (!bytes || bytes.length < 8 || bytes.slice(0, 5).toString('latin1') !== '%PDF-') throw new Error('the report is not a PDF');
  if (bytes.length > MAX_BYTES) throw new Error('the report is ' + Math.round(bytes.length / 1024 / 1024) + 'MB, over the ' + (MAX_BYTES / 1024 / 1024) + 'MB this app sends to Xero');
  const base = `${XERO_API_URL}/Invoices/${encodeURIComponent(invoiceId)}/Attachments`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' };
  const listed = await http({ method: 'get', url: base, headers });
  const existing = ((listed && listed.data && listed.data.Attachments) || []);
  const same = existing.find(a => a && a.FileName === fileName);
  if (same) return { attachmentId: same.AttachmentID || null, skipped: true };
  if (existing.length >= MAX_ATTACHMENTS) throw new Error('the invoice already has ' + existing.length + ' attachments, Xero\'s limit');
  const up = await http({
    method: 'post',
    url: `${base}/${encodeURIComponent(fileName)}?IncludeOnline=true`,
    data: bytes,
    headers: Object.assign({}, headers, { 'Content-Type': 'application/pdf' }),
    maxBodyLength: Infinity,
  });
  const att = up && up.data && up.data.Attachments && up.data.Attachments[0];
  return { attachmentId: (att && att.AttachmentID) || null, skipped: false };
}

module.exports = { ATTACHMENTS_SCOPE, MAX_BYTES, MAX_ATTACHMENTS, hasAttachmentsScope, isPermissionError, attachPdfOnce };
