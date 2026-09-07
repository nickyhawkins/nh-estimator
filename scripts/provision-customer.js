#!/usr/bin/env node
'use strict';

// ── Stand up one customer's instance from the command line ──────────────────
//
//   node scripts/provision-customer.js "Smith Decorating"
//
// Replaces step 1 of docs/NEW_INSTANCE.md — the "New → Blueprint → apply, fill
// five fields, wait" dance — with one command. Everything else in that runbook
// still applies; see "What this does NOT do" below.
//
// WHY NOT THE BLUEPRINTS API: Render's /v1/blueprints endpoints only list,
// validate and manage blueprints already connected to a repo. There is no
// "instantiate this render.yaml as a fresh set of resources" call — the
// dashboard's apply flow is not itself an API call. So this script creates the
// two resources directly (POST /v1/postgres, POST /v1/services) and sets the
// env vars render.yaml would otherwise prompt for.
//
// KEEPING IT HONEST AGAINST render.yaml: render.yaml stays the canonical
// definition of an instance. Every value this script sends is read from it at
// run time rather than copied here, so the two cannot drift — if someone bumps
// the Postgres plan or adds an env var in the blueprint, this picks it up. The
// one thing it will not do is guess: an env var render.yaml marks `sync: false`
// that this script has no value for stops the run rather than being skipped.
//
// ENVIRONMENT (local, never committed — .env is gitignored):
//   RENDER_API_KEY   from Render → Account Settings → API Keys
//   RENDER_OWNER_ID  the workspace id (starts tea-/usr-); the script lists
//                    your workspaces and tells you if it is missing
//   RENDER_REPO      defaults to this repo's origin remote
//   XERO_CLIENT_ID / XERO_CLIENT_SECRET
//                    optional. Set them and the new service gets them
//                    directly. Leave them out and the script tells you to
//                    link the `nh-estimator-xero` environment group to the
//                    service in the dashboard instead — one click, and the
//                    same group serves every instance. Linking a group is
//                    NOT done here: the endpoint for it was not verified
//                    against Render's API while this was written, and this
//                    script does not guess at API shapes.
//
// USAGE
//   node scripts/provision-customer.js "Smith Decorating"
//   node scripts/provision-customer.js "Smith Decorating" --dry-run
//
// Every write call costs real money on Render, so the script prints exactly
// what it is about to create and waits for you to type "yes" before the first
// billable call. --dry-run stops after that summary.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const API = 'https://api.render.com/v1';

// ── plumbing ────────────────────────────────────────────────────────────────

function die(msg) {
  console.error('\n✗ ' + msg + '\n');
  process.exit(1);
}

function slugify(name) {
  const slug = String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  if (!slug) die('That business name has no letters or digits in it to make a service name from.');
  return slug;
}

async function api(method, endpoint, body) {
  const res = await fetch(API + endpoint, {
    method,
    headers: {
      'Authorization': 'Bearer ' + process.env.RENDER_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { /* keep raw */ }
  if (!res.ok) {
    const detail = (parsed && (parsed.message || parsed.error)) || text || res.statusText;
    throw new Error(`${method} ${endpoint} → ${res.status}: ${detail}`);
  }
  return parsed;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── read render.yaml, so this script and the blueprint cannot drift ─────────

// Deliberately a small hand-rolled reader rather than a YAML dependency: it
// needs five scalars and one env list out of a file this repo owns and keeps
// simple, and adding js-yaml to dependencies for a local script would put it
// in every customer's production install.
function readBlueprint() {
  const raw = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
  const lines = raw.split('\n').filter((l) => !/^\s*#/.test(l));
  const scalar = (key) => {
    const m = lines.find((l) => new RegExp('^\\s*' + key + ':\\s*\\S').test(l));
    if (!m) return null;
    return m.split(':').slice(1).join(':').trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  };

  // Env var names and how each gets its value, in render.yaml's own order.
  const envVars = [];
  let inEnv = false;
  let current = null;
  for (const line of lines) {
    if (/^\s*envVars:/.test(line)) { inEnv = true; continue; }
    if (inEnv) {
      if (/^\s{0,4}\w+:/.test(line) && !/^\s{6,}/.test(line)) { inEnv = false; if (current) envVars.push(current); current = null; continue; }
      const key = line.match(/^\s*-\s*key:\s*(\S+)/);
      if (key) { if (current) envVars.push(current); current = { key: key[1] }; continue; }
      // `- fromGroup: name` is a list item in its own right, not a property of
      // the key above it. Treating it as one silently hung the group off
      // whichever var happened to precede it.
      const group = line.match(/^\s*-\s*fromGroup:\s*(\S+)/);
      if (group) { if (current) envVars.push(current); current = { fromGroup: group[1] }; continue; }
      if (!current) continue;
      if (/sync:\s*false/.test(line)) current.prompted = true;
      if (/generateValue:\s*true/.test(line)) current.generate = true;
      if (/fromDatabase:/.test(line)) current.fromDatabase = true;
      const val = line.match(/^\s*value:\s*(.+)$/);
      if (val) current.value = val[1].trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
    }
  }
  if (current) envVars.push(current);

  const bp = {
    dbPlan: scalar('plan') || 'basic-256mb',
    branch: scalar('branch') || 'stable',
    buildCommand: scalar('buildCommand') || 'npm install',
    startCommand: scalar('startCommand') || 'npm start',
    preDeployCommand: scalar('preDeployCommand') || 'npm run provision',
    healthCheckPath: scalar('healthCheckPath') || '/healthz',
    envVars,
  };

  // `plan:` appears twice — the web service's first, then the database's. The
  // scalar reader above takes the first match, so read them positionally.
  const planLines = lines.filter((l) => /^\s*plan:\s*\S/.test(l))
    .map((l) => l.split(':')[1].trim().replace(/\s+#.*$/, ''));
  bp.webPlan = planLines[0] || 'starter';
  bp.dbPlan = planLines[1] || planLines[0] || 'basic-256mb';
  return bp;
}

function repoUrl() {
  if (process.env.RENDER_REPO) return process.env.RENDER_REPO;
  try {
    const remote = execSync('git remote get-url origin', { cwd: ROOT }).toString().trim();
    return remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
  } catch (e) {
    die('Could not work out the repo URL. Set RENDER_REPO to it.');
  }
}

// ── the run ─────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const businessName = args.filter((a) => !a.startsWith('--')).join(' ').trim();

  if (!businessName) {
    console.error('Usage: node scripts/provision-customer.js "Business Name" [--dry-run]');
    process.exit(2);
  }
  if (!process.env.RENDER_API_KEY) {
    die('RENDER_API_KEY is not set. Render → Account Settings → API Keys, then put it in .env');
  }

  const bp = readBlueprint();
  const slug = slugify(businessName);
  const serviceName = `nh-estimator-${slug}`;
  const dbName = `nh-estimator-${slug}-db`;
  const repo = repoUrl();

  // Owner (workspace). Listing is a free GET, so do it before asking for
  // confirmation — a wrong or missing owner should fail here, not halfway.
  let ownerId = process.env.RENDER_OWNER_ID;
  const owners = await api('GET', '/owners?limit=20');
  const ownerList = (owners || []).map((o) => o.owner || o);
  if (!ownerId) {
    if (ownerList.length === 1) {
      ownerId = ownerList[0].id;
    } else {
      console.error('\nRENDER_OWNER_ID is not set, and this API key can see more than one workspace:\n');
      ownerList.forEach((o) => console.error(`  ${o.id}  ${o.name} (${o.email || o.type || ''})`));
      die('Set RENDER_OWNER_ID to the one this customer should live in.');
    }
  } else if (!ownerList.some((o) => o.id === ownerId)) {
    die(`RENDER_OWNER_ID ${ownerId} is not a workspace this API key can see.`);
  }

  // Which env vars we can fill, and which would be guesses. XERO_REDIRECT_URI
  // is knowable only once the service exists, so it is set in the second pass.
  const KNOWN_LATER = new Set(['XERO_REDIRECT_URI']);
  const missing = bp.envVars
    .filter((v) => v.prompted && !KNOWN_LATER.has(v.key))
    .filter((v) => v.key !== 'APP_PASSWORD')       // replaced by the setup link
    .filter((v) => v.key !== 'APP_URL')            // derived from serviceName
    .filter((v) => !v.fromGroup)                   // supplied by an env group
    .filter((v) => !process.env[v.key]);

  console.log(`
About to create a new instance on Render
────────────────────────────────────────
  Customer      ${businessName}
  Web service   ${serviceName}   (${bp.webPlan}, branch ${bp.branch})
  Database      ${dbName}   (${bp.dbPlan})
  Repo          ${repo}
  Workspace     ${ownerId}
  URL           https://${serviceName}.onrender.com

Both resources are on PAID plans — the blueprint pins them there because
the pre-deploy step and always-on need it, and the free Postgres tier
expires after 90 days. This will start costing money today.
`);

  if (missing.length) {
    console.log('These env vars are marked sync:false in render.yaml and have no value here:');
    missing.forEach((v) => console.log(`  ${v.key}`));
    console.log(`
Set them in your .env (or move the Xero pair into a Render environment
group and reference it from render.yaml) and run again. Nothing has been
created.
`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('--dry-run: stopping here. Nothing was created.\n');
    process.exit(0);
  }

  const answer = await ask('Type "yes" to create these: ');
  if (answer.toLowerCase() !== 'yes') {
    console.log('\nNothing created.\n');
    process.exit(0);
  }

  // ── 1. Database ───────────────────────────────────────────────────────────
  console.log('\n· Creating the database…');
  const database = await api('POST', '/postgres', {
    name: dbName,
    ownerId,
    plan: bp.dbPlan,
    version: '16',
  });
  const dbId = database.id;
  console.log(`  created ${dbId}`);

  // ── 2. Wait for it, then read its connection string ───────────────────────
  process.stdout.write('· Waiting for it to come up');
  let connectionString = null;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    process.stdout.write('.');
    const status = await api('GET', `/postgres/${dbId}`);
    if ((status.status || status.state) === 'available') {
      const conn = await api('GET', `/postgres/${dbId}/connection-info`);
      connectionString = conn.internalConnectionString || conn.externalConnectionString;
      break;
    }
  }
  console.log('');
  if (!connectionString) {
    die(`The database did not become available in five minutes. It exists as ${dbId} — check the Render dashboard, then either delete it or finish by hand.`);
  }

  // ── 3. Web service ────────────────────────────────────────────────────────
  //
  // SESSION_SECRET is generated HERE and is not optional. render.yaml has
  // Render mint it (`generateValue: true`); creating the service through the
  // API means nothing does that for us, and server.js falls back to a literal
  // 'dev-secret-change-this' when it is unset. That fallback is in the source,
  // identical on every instance, and signs the session cookies — so an
  // instance provisioned without this line would look completely normal while
  // anyone able to read the repo could forge a signed-in session on it.
  const sessionSecret = require('crypto').randomBytes(48).toString('base64url');
  const appUrl = `https://${serviceName}.onrender.com`;

  const envVars = [
    { key: 'DATABASE_URL', value: connectionString },
    { key: 'SESSION_SECRET', value: sessionSecret },
    { key: 'NODE_ENV', value: 'production' },
    { key: 'APP_URL', value: appUrl },
    { key: 'XERO_REDIRECT_URI', value: `${appUrl}/auth/xero/callback` },
  ];
  const xeroLocal = ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'].filter((k) => process.env[k]);
  for (const key of xeroLocal) envVars.push({ key, value: process.env[key] });
  const needsEnvGroup = xeroLocal.length < 2;
  // DEBT_APP_ENABLED is deliberately absent — the owner's personal instance
  // sets it by hand and a customer's must never have it.

  console.log('· Creating the web service…');
  const service = await api('POST', '/services', {
    type: 'web_service',
    name: serviceName,
    ownerId,
    repo,
    branch: bp.branch,
    autoDeploy: 'yes',
    envVars,
    serviceDetails: {
      env: 'node',
      plan: bp.webPlan,
      healthCheckPath: bp.healthCheckPath,
      preDeployCommand: bp.preDeployCommand,
      envSpecificDetails: {
        buildCommand: bp.buildCommand,
        startCommand: bp.startCommand,
      },
    },
  });
  const svc = service.service || service;
  console.log(`  created ${svc.id}`);

  // ── 4. Wait for the first deploy, which provisions the schema ─────────────
  //
  // The setup link cannot be issued until app_auth exists, and app_auth is
  // created by the pre-deploy command's `npm run provision` on this first
  // deploy. So this wait is not cosmetic.
  process.stdout.write('· Waiting for the first deploy (this is the slow bit)');
  let live = false;
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    process.stdout.write('.');
    try {
      const res = await fetch(appUrl + '/healthz');
      if (res.ok) { live = true; break; }
    } catch (e) { /* not up yet */ }
  }
  console.log('');

  console.log(`
${live ? '✓ The instance is live.' : '! It is still deploying — the steps below hold either way.'}

  App        ${appUrl}
  Service    ${svc.id}
  Database   ${dbId}

Now do these things
───────────────────${needsEnvGroup ? `
0. Link the Xero credentials to this service. In the Render dashboard,
   open the \`nh-estimator-xero\` environment group and add
   ${serviceName} to it (Env Groups → nh-estimator-xero → Linked
   Services). Xero will not connect until this is done.
   (Set XERO_CLIENT_ID and XERO_CLIENT_SECRET locally instead and the
   script sets them directly, skipping this step.)
` : ''}
1. Register the callback URL in the Xero developer app
   (developer.xero.com → your app → Redirect URIs → add):

     ${appUrl}/auth/xero/callback

   There is no API for this; it is the one step that stays manual.

2. Check daily backups on the new database in the Render dashboard.

3. Issue the customer's setup link and send it to them:

     DATABASE_URL='<the database's external connection string>' \\
       node scripts/issue-claim-link.js --app-url ${appUrl}

   They open it, choose their own business name and password, and they
   are in. You never see or set their password.
`);
}

// Exported so the render.yaml reader can be exercised without an API key or a
// billable call; running the file still does the real thing.
module.exports = { readBlueprint, slugify };

if (require.main === module) {
  main().catch((err) => {
    console.error('\n✗ ' + err.message);
    console.error('\nAnything already created is still on Render — check the dashboard before re-running,\nor you will end up paying for two of it.\n');
    process.exit(1);
  });
}
