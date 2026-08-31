// The client-facing variation approval page (CLIENT_APPROVAL_SPEC.md).
//
// PUBLIC. Every route here is reachable with no session, which is the whole
// point: the reader is a customer holding a link that was texted to them, and
// asking them to make an account to say "yes, do the landing ceiling" would
// defeat the feature. So this router is mounted in server.js BEFORE the app's
// login gate, and three rules hold everywhere below:
//
//   1. The token IS the credential. It is 192 bits, compared in constant time
//      (lib/clientQuote.js), and a job with no token can never be opened.
//   2. A bad job id and a bad token give the SAME generic 404 page. Nothing
//      here tells a caller which half of the URL they got wrong.
//   3. The page shows the original quote as ONE FIGURE. The itemised
//      breakdown of what was agreed is deliberately not on it — this page
//      exists to answer "do you want these extras", not to reopen the quote.
//
// Nothing in this file touches Xero. Approved variations reach Xero exactly
// as they always have: as line items built into the final invoice
// (FINAL_INVOICE_SPEC.md), at invoicing time.

const express = require('express');
const db = require('../db');
const { ensureClientQuoteSchema, loadClientQuote } = require('../lib/clientQuote');

const router = express.Router();

// ── Abuse throttle ─────────────────────────────────────────────────────────
// Not a security control — a 192-bit token is not brute-forceable and this
// would not save it if it were. It is here so a script hammering /quote/...
// can't spend the single Render instance's database connections on failed
// lookups while Nicky is trying to use the app. Same in-memory, per-IP,
// restart-clearing shape as routes/appLogin.js, and proportionate for the
// same reason: one process, one business.
const MAX_MISSES = 20;
const LOCKOUT_MS = 10 * 60 * 1000;
const misses = new Map(); // ip -> { count, lockedUntil }

function throttled(ip) {
  const m = misses.get(ip);
  return !!(m && m.lockedUntil && m.lockedUntil > Date.now());
}
function recordMiss(ip) {
  const m = misses.get(ip) || { count: 0, lockedUntil: 0 };
  m.count++;
  if (m.count >= MAX_MISSES) { m.lockedUntil = Date.now() + LOCKOUT_MS; m.count = 0; }
  misses.set(ip, m);
}

// ── Rendering ──────────────────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const money = (n) => '£' + (Math.round((+n || 0) * 100) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const shortDate = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Brand: steel blue / warm grey / white, Barlow, the business logo — the same
// palette and type as the quote document the client has already been sent
// (buildClientQuoteHtml in public/index.html), so the approval page reads as
// the next page of the same document rather than a different company's form.
// Barlow loads non-blocking for the reason given there: half this app's life
// happens on one bar of signal, and a webfont is not worth a blank screen.
const PAGE_CSS = `
:root{--steel:#1e6497;--grey:#f4f2ee;--ink:#2b2b2b;--mut:#6b6b6b;--line:#eee9e2;
      --ok:#1e7a4a;--no:#a23b32;--wait:#9a6b12}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Barlow",system-ui,-apple-system,sans-serif;background:var(--grey);color:var(--ink);line-height:1.45}
.page{max-width:640px;margin:0 auto;padding:20px 16px 56px}
.head{background:var(--steel);color:#fff;border-radius:14px;padding:22px;display:flex;align-items:center;gap:16px}
.head img{width:56px;height:56px;border-radius:12px;background:#fff;object-fit:contain;flex:none}
.head h1{font-family:"Barlow Semi Condensed","Barlow",sans-serif;font-size:24px;font-weight:700;letter-spacing:.01em}
.head .sub{font-size:14px;opacity:.85;margin-top:2px}
.for{padding:16px 4px 2px;font-size:16px;font-weight:600}
.for span{display:block;font-size:13.5px;font-weight:400;color:var(--mut);margin-top:2px}
.card{background:#fff;border-radius:14px;padding:16px 18px;margin-top:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.card h2{font-family:"Barlow Semi Condensed","Barlow",sans-serif;font-size:13px;font-weight:700;
         letter-spacing:.08em;text-transform:uppercase;color:var(--steel);margin-bottom:10px}
.orig{display:flex;justify-content:space-between;align-items:baseline;gap:14px}
.orig .label{font-weight:500}
.orig .amount{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
.note{font-size:12.5px;color:var(--mut);margin-top:8px}
.var{padding:14px 0;border-bottom:1px solid var(--line)}
.var:first-of-type{padding-top:2px}
.var:last-child{border-bottom:none;padding-bottom:2px}
.var-top{display:flex;justify-content:space-between;align-items:baseline;gap:14px}
.var-name{font-weight:600}
.var-amt{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.var.declined .var-name,.var.declined .var-amt{text-decoration:line-through;color:var(--mut)}
.state{font-size:13px;font-weight:600;margin-top:5px}
.state.approved{color:var(--ok)}
.state.declined{color:var(--no)}
.state.pending{color:var(--wait)}
.state .when{font-weight:400;color:var(--mut)}
.actions{display:flex;gap:10px;margin-top:10px}
.actions form{flex:1;margin:0}
button{width:100%;font:inherit;font-size:15px;font-weight:700;padding:11px 12px;border-radius:10px;
       border:1px solid var(--steel);cursor:pointer;-webkit-appearance:none}
button.yes{background:var(--steel);color:#fff}
button.no{background:#fff;color:var(--mut);border-color:#d8d2c8}
button:disabled{opacity:.55;cursor:default}
.total{background:var(--steel);color:#fff;border-radius:14px;padding:18px 20px;margin-top:14px;
       display:flex;justify-content:space-between;align-items:baseline;gap:14px}
.total .label{font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.85}
.total .amount{font-size:28px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.total .breakdown{font-size:12.5px;opacity:.85;margin-top:3px;letter-spacing:0;text-transform:none}
.flash{background:#e4f0e8;border:1px solid #b9d9c6;color:var(--ok);border-radius:12px;
       padding:11px 14px;margin-top:14px;font-size:14px;font-weight:600}
.empty{font-size:14px;color:var(--mut)}
.foot{font-size:12px;color:var(--mut);text-align:center;margin-top:26px;line-height:1.6}
`;

function shell(title, body, extraHead) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    + '<meta name="theme-color" content="#1e6497">'
    // A link handed to one client must never turn up in a search result.
    // Belt and braces with the X-Robots-Tag header set on every response.
    + '<meta name="robots" content="noindex, nofollow, noarchive">'
    + '<title>' + esc(title) + '</title>'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">'
    + '<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800'
    + '&family=Barlow+Semi+Condensed:wght@600;700&display=swap" rel="stylesheet" media="print"'
    + ' onload="this.media=\'all\'">'
    + '<style>' + PAGE_CSS + '</style>'
    + (extraHead || '')
    + '</head><body>' + body + '</body></html>';
}

// The generic dead end. Deliberately says nothing about WHY: a wrong job id, a
// wrong token, a job that has since been deleted and a link that was never
// valid all land here reading identically.
function notFoundPage() {
  return shell('Link not found', '<div class="page">'
    + '<div class="card" style="margin-top:40px;text-align:center">'
    + '<h2>Link not found</h2>'
    + '<p class="empty">This link isn\'t valid any more. Check you\'ve opened the most recent '
    + 'message, or get in touch and we\'ll send a fresh one.</p>'
    + '</div></div>');
}

function variationHtml(v, base) {
  const action = base + '/variations/' + encodeURIComponent(v.id);
  let state = '';
  if (v.status === 'approved') {
    state = '<div class="state approved">✓ Approved'
      + (v.answeredAt ? ' <span class="when">· ' + esc(shortDate(v.answeredAt)) + '</span>' : '') + '</div>';
  } else if (v.status === 'declined') {
    state = '<div class="state declined">✗ Declined — not charged'
      + (v.answeredAt ? ' <span class="when">· ' + esc(shortDate(v.answeredAt)) + '</span>' : '') + '</div>';
  } else {
    state = '<div class="state pending">Awaiting your answer'
      + (v.at ? ' <span class="when">· sent ' + esc(shortDate(v.at)) + '</span>' : '') + '</div>'
      // Real forms, so the page works with JavaScript switched off or still
      // loading; the script at the foot upgrades them to answer in place.
      + '<div class="actions">'
      + '<form method="POST" action="' + esc(action) + '/approve"><button class="yes" type="submit">Approve</button></form>'
      + '<form method="POST" action="' + esc(action) + '/decline"><button class="no" type="submit">Decline</button></form>'
      + '</div>';
  }
  return '<div class="var ' + esc(v.status) + '" id="v-' + esc(v.id) + '" data-amount="' + (v.amount || 0) + '">'
    + '<div class="var-top"><div class="var-name">' + esc(v.description) + '</div>'
    + '<div class="var-amt">' + money(v.amount) + '</div></div>'
    + state + '</div>';
}

function quotePage(view, base, flash) {
  const b = view.business;
  // The stock fallback is /logo.png, which routes/appLogin.js already keeps
  // on its open-paths list for the login page — so it resolves for a client
  // with no session on a gated instance too.
  const logo = b.logoDataUri || '/logo.png';
  const heading = view.job.client || view.job.name || 'your job';

  const head = '<div class="head">'
    + '<img src="' + esc(logo) + '" alt="" onerror="this.style.display=\'none\'">'
    + '<div><h1>' + esc(b.name) + '</h1>'
    + '<div class="sub">Painting &amp; Decorating</div></div></div>'
    + '<div class="for">Quote for ' + esc(heading)
    + (view.job.client && view.job.name && view.job.name !== view.job.client
        ? '<span>' + esc(view.job.name) + '</span>' : '')
    + '</div>';

  // The original quote card is omitted entirely when this app holds no agreed
  // total for the job -- a job imported from Xero, or accepted before quote
  // snapshots shipped. A dash against "As agreed" reads to a client as a
  // broken page; leaving the card out reads as what it is, a page about the
  // extras, with the original quote living in the document they already have.
  const original = view.originalTotal == null ? ''
    : '<div class="card"><h2>Original quote</h2>'
      + '<div class="orig"><div class="label">As agreed</div>'
      + '<div class="amount">' + money(view.originalTotal) + '</div></div>'
      + '<div class="note">The price already agreed for the original scope of work. Unchanged.</div>'
      + '</div>';

  const pending = view.variations.filter(v => v.status === 'pending').length;
  const variations = '<div class="card"><h2>Extras since then</h2>'
    + (view.variations.length
        ? view.variations.map(v => variationHtml(v, base)).join('')
        : '<p class="empty">Nothing extra has been added to this job.</p>')
    + (pending
        ? '<div class="note" id="pending-note">Tap Approve or Decline on each item above. '
          + 'Nothing extra is charged unless you approve it.</div>'
        : '')
    + '</div>';

  const total = '<div class="total"><div><div class="label">'
    + (view.originalTotal == null ? 'Approved extras' : 'Total so far') + '</div>'
    + '<div class="breakdown" id="total-breakdown">' + esc(breakdownText(view)) + '</div></div>'
    + '<div class="amount" id="running-total">' + money(view.runningTotal) + '</div></div>';

  const foot = '<div class="foot">Approved extras are added to your final invoice.<br>'
    + 'Any questions, just reply to the message this link came in.</div>';

  return shell('Quote — ' + (b.name || 'Quote'),
    '<div class="page">' + head
    + (flash ? '<div class="flash" id="flash">' + esc(flash) + '</div>' : '')
    + original + variations + total + foot + '</div>'
    // Progressive enhancement only: each form is submitted with fetch so the
    // answer lands without a page reload (this is opened on a phone, mid-job,
    // often on poor signal — a full navigation is where a tap goes missing
    // and gets tapped twice). On any failure the handler falls back to
    // submitting the form for real rather than swallowing the tap.
    + '<script>' + PAGE_JS + '</script>');
}

// The line under the total, saying what went into it. It has to be legible to
// someone who has never seen this page before, so it names the parts rather
// than assuming the arithmetic is obvious.
function breakdownText(view) {
  const n = view.variations.filter(v => v.status === 'approved').length;
  if (view.originalTotal == null) {
    return n ? n + ' approved extra' + (n === 1 ? '' : 's') + ', on top of your original quote'
             : 'Nothing extra approved yet';
  }
  if (!n) return 'Original quote, no extras approved yet';
  return 'Original quote + ' + n + ' approved extra' + (n === 1 ? '' : 's');
}

const PAGE_JS = `
(function () {
  var money = function (n) {
    return '\\u00a3' + (Math.round(n * 100) / 100).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  };
  document.addEventListener('submit', function (ev) {
    var form = ev.target;
    if (!form.action || form.method.toLowerCase() !== 'post') return;
    var row = form.closest('.var');
    if (!row) return;
    ev.preventDefault();
    var buttons = row.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    fetch(form.action, { method: 'POST', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.ok) throw new Error('rejected');
        apply(row, res.body);
      })
      .catch(function () { form.submit(); });
  });
  function apply(row, res) {
    var actions = row.querySelector('.actions');
    if (actions) actions.parentNode.removeChild(actions);
    row.className = 'var ' + res.status;
    var state = row.querySelector('.state');
    if (state) {
      state.className = 'state ' + res.status;
      state.innerHTML = res.status === 'approved'
        ? '\\u2713 Approved <span class="when">\\u00b7 just now</span>'
        : '\\u2717 Declined \\u2014 not charged <span class="when">\\u00b7 just now</span>';
    }
    var total = document.getElementById('running-total');
    if (total && res.runningTotal != null) total.textContent = money(res.runningTotal);
    var breakdown = document.getElementById('total-breakdown');
    if (breakdown && res.breakdown) breakdown.textContent = res.breakdown;
    if (!document.querySelector('.var.pending')) {
      var note = document.getElementById('pending-note');
      if (note) note.parentNode.removeChild(note);
    }
    flash(res.status === 'approved'
      ? 'Thanks \\u2014 that extra is approved and will be added to your final invoice.'
      : 'Thanks \\u2014 that extra is declined and will not be charged.');
  }
  function flash(text) {
    var el = document.getElementById('flash');
    if (!el) {
      el = document.createElement('div');
      el.className = 'flash';
      el.id = 'flash';
      var page = document.querySelector('.page');
      page.insertBefore(el, page.querySelector('.card'));
    }
    el.textContent = text;
  }
})();
`;

// ── Routes ─────────────────────────────────────────────────────────────────

// Applied to every response below: a link to one client's prices must not be
// cached by a shared proxy or indexed by anything that crawls it.
function publicHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

// Two URL shapes reach the same page, and both stay supported forever:
//
//   /q/<token>                the SHORT link — what "Send for approval" mints
//   /quote/<jobId>/<token>    the original — every link already texted out
//
// The short one is what a client actually receives. It is barely half the
// length, so it survives a text message without wrapping into something that
// looks broken, and it carries no job id — one less internal identifier on a
// stranger's screen. Nothing was lost by dropping it: the token is already
// globally unique (the jobs_client_token index), so the job id never did any
// work in the URL beyond making it longer.
const PUBLIC_PATHS = ['/q/:token', '/quote/:jobId/:token'];

// Resolves either shape to the job it names. Looking a job up BY token is a
// plain indexed lookup and is deliberately NOT the authorization decision --
// it only chooses which row to check. The decision is still
// loadClientQuote()'s constant-time compare, so rule 1 at the top of this file
// holds identically for both shapes.
async function resolveTarget(req) {
  const token = req.params.token;
  if (req.params.jobId) {
    return {
      jobId: req.params.jobId,
      token,
      base: '/quote/' + encodeURIComponent(req.params.jobId) + '/' + encodeURIComponent(token),
    };
  }
  const found = await db.query('SELECT id FROM jobs WHERE client_token = $1', [token]);
  // No row means no such link. jobId stays null, loadClientQuote() finds
  // nothing, and the caller renders the same generic 404 as a wrong token --
  // the two are indistinguishable from outside, exactly as before.
  return { jobId: found.rows[0] ? found.rows[0].id : null, token, base: '/q/' + encodeURIComponent(token) };
}

router.use(PUBLIC_PATHS, async (req, res, next) => {
  publicHeaders(res);
  if (throttled(req.ip)) return res.status(429).type('text').send('Too many requests — try again shortly.');
  try {
    await ensureClientQuoteSchema();
    next();
  } catch (err) {
    console.error('Client quote schema could not be prepared', err);
    res.status(500).type('html').send(notFoundPage());
  }
});

// The page. Public, no auth, token-gated.
router.get(PUBLIC_PATHS, async (req, res) => {
  try {
    const { jobId, token, base } = await resolveTarget(req);
    const view = await loadClientQuote(jobId, token);
    if (!view) { recordMiss(req.ip); return res.status(404).type('html').send(notFoundPage()); }
    // Every action on the page is built from the base the reader arrived on,
    // so a client on an old long link stays on long links and one on a short
    // link stays short -- neither ever gets bounced to the other shape.
    // ?answered= is the no-JavaScript path's confirmation: the POST redirects
    // back here so the browser lands on a plain GET (nothing to re-submit on
    // refresh) and the flash says what happened.
    const answered = req.query.answered;
    const flash = answered === 'approved'
      ? 'Thanks — that extra is approved and will be added to your final invoice.'
      : answered === 'declined'
        ? 'Thanks — that extra is declined and will not be charged.'
        : answered === 'already'
          ? 'That extra has already been answered — the current state is shown below.'
          : '';
    res.type('html').send(quotePage(view, base, flash));
  } catch (err) {
    console.error('Client quote page failed', err);
    res.status(500).type('html').send(notFoundPage());
  }
});

// Approve / decline. Token-gated exactly like the page, and both share one
// handler because they differ only in which status and which timestamp they
// write. Two properties matter:
//
//   · The UPDATE is guarded on status = 'pending'. An answered line is
//     history, and a second tap (a double-tap on a phone, a re-submitted
//     form, a forwarded link) must not silently flip an answer the client
//     already gave — it reports the state that stands instead.
//   · The opposite timestamp is cleared, so a row can never carry both an
//     approved_at and a declined_at and leave the audit trail ambiguous.
function answerRoute(status) {
  return async (req, res) => {
    const { variationId } = req.params;
    // Reply in kind: fetch (the page's own script) gets JSON, a real form
    // submission gets a redirect back to the page.
    const wantsJson = (req.headers.accept || '').includes('application/json');
    let base = '/';
    const fail = (code, message, flash) => {
      if (wantsJson) return res.status(code).json({ ok: false, error: message });
      if (code === 404) return res.status(404).type('html').send(notFoundPage());
      return res.redirect(303, base + (flash ? '?answered=' + flash : ''));
    };
    try {
      const target = await resolveTarget(req);
      const { jobId, token } = target;
      base = target.base;
      const view = await loadClientQuote(jobId, token);
      if (!view) { recordMiss(req.ip); return fail(404, 'not found'); }
      const stamp = status === 'approved'
        ? 'approved_at = NOW(), declined_at = NULL'
        : 'declined_at = NOW(), approved_at = NULL';
      const updated = await db.query(
        `UPDATE job_variations SET status = $3, ${stamp}, updated_at = NOW()
          WHERE id = $1 AND job_id = $2 AND status = 'pending'
        RETURNING id`,
        [variationId, jobId, status]
      );
      if (!updated.rows.length) {
        // Either the line belongs to another job / never existed (404, same
        // generic answer as a bad token), or it has already been answered.
        const existing = view.variations.find(v => v.id === variationId);
        if (!existing) return fail(404, 'not found');
        return fail(409, 'That extra has already been answered.', 'already');
      }
      const after = await loadClientQuote(jobId, token);
      if (wantsJson) {
        return res.json({
          ok: true,
          status,
          runningTotal: after.runningTotal,
          breakdown: breakdownText(after),
        });
      }
      res.redirect(303, base + '?answered=' + status);
    } catch (err) {
      console.error('Client variation answer failed', err);
      if (wantsJson) return res.status(500).json({ ok: false, error: 'Could not save that — please try again.' });
      res.status(500).type('html').send(notFoundPage());
    }
  };
}

// Both shapes, same action segment, so variationHtml() builds one action path
// from whichever base the reader arrived on.
const ACTION_PATHS = (verb) => PUBLIC_PATHS.map(p => p + '/variations/:variationId/' + verb);
router.post(ACTION_PATHS('approve'), answerRoute('approved'));
router.post(ACTION_PATHS('decline'), answerRoute('declined'));

module.exports = router;
