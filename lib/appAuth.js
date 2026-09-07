// Where an instance's app password actually lives (MULTI_INSTANCE_PILOT_SPEC.md
// WS1, extended for self-serve onboarding).
//
// WS1 put the password in the APP_PASSWORD env var: the owner generated one,
// set it on the customer's Render service, and sent it to them. The customer
// could never change it, and every change meant an env-var edit and a redeploy.
// This module moves the password into the instance's own database, so the
// person using the app owns it — and reduces provisioning a new customer to
// "create the service, send them a link".
//
// THREE STATES, in the order they are checked:
//
//   1. A password set in the database (app_auth.password_hash). The customer
//      chose it via their setup link and can change it in Settings. Wins over
//      everything below.
//   2. A pending claim — a setup link has been issued but not used yet. The
//      gate is ON and NO password opens it; only the link does. This matters:
//      a freshly provisioned instance has no password of any kind, and without
//      this rule it would sit wide open on the public internet between being
//      created and being claimed.
//   3. APP_PASSWORD in the environment. The WS1 behaviour, kept working
//      untouched so instances provisioned the old way (including the owner's)
//      keep signing in exactly as before.
//
// None of the three ⇒ no gate at all, which is the app's historical behaviour
// and what an owner who never opted in still gets.
//
// The state is cached in memory because requireAuth runs on every request and
// is synchronous. init() loads it before the server accepts traffic; every
// write below refreshes it. Nothing here re-reads the database per request.

const crypto = require('crypto');
const db = require('../db');

// scrypt with a per-instance random salt. Node's own crypto rather than bcrypt
// so this adds no dependency to a project that has deliberately few — the
// parameters below are the Node defaults' cost, which is ample for a gate that
// throttles at 8 attempts and guards one decorator's job list.
const KEYLEN = 64;
const CLAIM_TTL_DAYS = 14;

let state = { loaded: false, hasPassword: false, hash: null, salt: null, claimPending: false };

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
}

// Tokens are compared by digest so the stored value is useless if the database
// leaks, and compared in constant time so the comparison itself says nothing.
function tokenDigest(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function safeEqualHex(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function refresh() {
  const result = await db.query(
    `SELECT password_hash, password_salt, claim_token_hash, claim_expires_at, claimed_at
       FROM app_auth WHERE id = 1`
  );
  const row = result.rows[0] || {};
  const claimLive = !!row.claim_token_hash
    && !!row.claim_expires_at
    && new Date(row.claim_expires_at).getTime() > Date.now();
  state = {
    loaded: true,
    hasPassword: !!row.password_hash,
    hash: row.password_hash || null,
    salt: row.password_salt || null,
    claimPending: claimLive,
  };
  return state;
}

// Called once from server.js before app.listen. A database that isn't reachable
// yet must not silently produce an ungated instance, so a failure here leaves
// loaded:false and gateEnabled() falls back to "gate on if a claim or an
// APP_PASSWORD could exist" — see below.
async function init() {
  try {
    await refresh();
  } catch (err) {
    console.error('Could not read app_auth — the login gate will fail closed until the database answers', err.message);
  }
  return state;
}

// Fail-closed on an unread state: if we could not load, we do not know whether
// this instance has a password, and guessing "no" would serve someone else's
// jobs to the internet. Guessing "yes" only ever costs a login screen.
function gateEnabled() {
  if (!state.loaded) return true;
  return state.hasPassword || state.claimPending || !!process.env.APP_PASSWORD;
}

// True when the instance has been created but nobody has set a password yet.
// The login page uses this to say "use your setup link" rather than asking for
// a password that does not exist.
function awaitingClaim() {
  return state.loaded && !state.hasPassword && state.claimPending;
}

function passwordMatches(attempt) {
  // A pending, unclaimed instance has no password. Refuse everything rather
  // than falling through to an APP_PASSWORD that may also be unset — which
  // would be an empty-string match against an empty environment variable.
  if (state.loaded && !state.hasPassword && state.claimPending) return false;

  if (state.loaded && state.hasPassword) {
    return safeEqualHex(hashPassword(attempt, state.salt), state.hash);
  }
  // Legacy WS1 path, unchanged in behaviour: sha256 both sides so
  // timingSafeEqual gets equal lengths without leaking the length.
  if (!process.env.APP_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(attempt || '')).digest();
  const b = crypto.createHash('sha256').update(process.env.APP_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Minimum only — no composition rules. A decorator picking a password for
// their own phone is not helped by being told it needs a symbol, and the
// throttle in appLogin.js is what actually stops guessing.
const MIN_PASSWORD_LENGTH = 8;

function passwordProblem(password) {
  const pw = String(password == null ? '' : password);
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

async function setPassword(password) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  await db.query(
    `UPDATE app_auth
        SET password_hash = $1, password_salt = $2,
            claim_token_hash = NULL, claim_expires_at = NULL,
            claimed_at = COALESCE(claimed_at, NOW()), updated_at = NOW()
      WHERE id = 1`,
    [hash, salt]
  );
  await refresh();
}

// Issues a setup link's token. Used by provision-customer.js for a new
// instance and by issue-claim-link.js when someone has locked themselves out.
// Returns the raw token — the only time it exists in readable form. The
// database stores its digest, so a stolen backup cannot be used to claim.
//
// Issuing does NOT clear an existing password: a customer who has locked
// themselves out keeps working on any device still signed in, right up until
// they use the link.
async function issueClaimToken(ttlDays = CLAIM_TTL_DAYS) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `UPDATE app_auth
        SET claim_token_hash = $1,
            claim_expires_at = NOW() + ($2 || ' days')::interval,
            updated_at = NOW()
      WHERE id = 1`,
    [tokenDigest(token), String(ttlDays)]
  );
  await refresh();
  return { token, expiresInDays: ttlDays };
}

// Checked against the database rather than the cache: a token is single-use
// and the cache only knows whether *a* claim is live, not which one.
async function claimTokenValid(token) {
  if (!token) return false;
  const result = await db.query(
    `SELECT claim_token_hash, claim_expires_at FROM app_auth WHERE id = 1`
  );
  const row = result.rows[0];
  if (!row || !row.claim_token_hash || !row.claim_expires_at) return false;
  if (new Date(row.claim_expires_at).getTime() <= Date.now()) return false;
  return safeEqualHex(tokenDigest(token), row.claim_token_hash);
}

// Sets the password and burns the token in one statement, so two people
// opening the same link cannot both succeed.
async function redeemClaim(token, password) {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, reason: problem };
  if (!(await claimTokenValid(token))) return { ok: false, reason: 'invalid' };

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const result = await db.query(
    `UPDATE app_auth
        SET password_hash = $1, password_salt = $2,
            claim_token_hash = NULL, claim_expires_at = NULL,
            claimed_at = COALESCE(claimed_at, NOW()), updated_at = NOW()
      WHERE id = 1 AND claim_token_hash = $3
      RETURNING id`,
    [hash, salt, tokenDigest(token)]
  );
  await refresh();
  if (!result.rowCount) return { ok: false, reason: 'invalid' };
  return { ok: true };
}

module.exports = {
  init, refresh, gateEnabled, awaitingClaim, passwordMatches,
  setPassword, passwordProblem, issueClaimToken, claimTokenValid, redeemClaim,
  MIN_PASSWORD_LENGTH,
  _state: () => state,
};
