// Regenerate the PDF edition of the user manual from its markdown source.
//
//   npm run build:manual
//
// Reads docs/user-manual/README.md, wraps it in print styling (cover page,
// A4, page-number footer), and renders docs/user-manual/NH-Estimator-User-Manual.pdf
// with headless Chrome. Commit the regenerated PDF together with the
// markdown edit that prompted it.
//
// Needs a Chrome/Chromium on the machine. Set CHROME_PATH if the script
// can't find yours.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { marked } = require('marked');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MANUAL_DIR = path.join(ROOT, 'docs', 'user-manual');
const SRC = path.join(MANUAL_DIR, 'README.md');
const PDF = path.join(MANUAL_DIR, 'NH-Estimator-User-Manual.pdf');
const TMP_HTML = path.join(MANUAL_DIR, '.manual-print.html');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
    try {
      const p = execSync(`which ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (p) return p;
    } catch (e) { /* not installed under this name */ }
  }
  throw new Error('No Chrome/Chromium found. Install one, or point CHROME_PATH at the executable.');
}

// The markdown's closing line names the version it documents. It is the one
// version stamp in the manual that isn't generated (the PDF cover reads
// package.json directly), so it drifts — it sat at v2.45.0 while the app was
// on v2.60.1. Rewrite it from package.json on every build instead, so the
// build:manual step that always follows a manual edit keeps it honest.
function syncVersionStamp() {
  const version = require(path.join(ROOT, 'package.json')).version;
  const md = fs.readFileSync(SRC, 'utf8');
  const synced = md.replace(
    /^(\*Manual for NH Estimator v)[0-9]+\.[0-9]+\.[0-9]+(\.)/m,
    `$1${version}$2`
  );
  if (synced !== md) {
    fs.writeFileSync(SRC, synced);
    console.log('Version stamp in README.md updated to v' + version);
  }
}

function buildHtml() {
  let md = fs.readFileSync(SRC, 'utf8');

  // The PDF gets a designed cover instead of the markdown H1 + tagline, and
  // page-by-page reading instead of the Contents link list.
  const [head, afterContents] = md.split('## Contents');
  const rest = afterContents.slice(afterContents.indexOf('---') + 3);
  let intro = head.replace(/^# .*\n/, '').replace(/^\*A pocket guide.*\n/m, '');
  md = intro + rest;

  let body = marked.parse(md, { gfm: true });

  // The stair diagram is landscape — let CSS size it differently from the
  // portrait phone screenshots.
  body = body.replace(
    /<img([^>]*15-stair-wall-diagram[^>]*)>/,
    '<img class="wide"$1>'
  );

  const version = require(path.join(ROOT, 'package.json')).version;
  const generated = new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  :root {
    --navy: #1b4f6b;
    --ink: #1e2833;
    --muted: #5b6b78;
    --line: #d8dee4;
    --faint: #f2f5f7;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif;
    color: var(--ink);
    font-size: 10.5pt;
    line-height: 1.55;
    margin: 0;
  }
  .cover {
    height: 257mm;
    display: flex; flex-direction: column; justify-content: center;
    page-break-after: always;
    border-left: 10px solid var(--navy);
    padding-left: 14mm;
  }
  .cover .kicker { color: var(--navy); font-weight: 700; letter-spacing: .2em; text-transform: uppercase; font-size: 10pt; }
  .cover h1 { font-size: 34pt; margin: .2em 0 .1em; color: var(--navy); line-height: 1.1; }
  .cover .sub { font-size: 13pt; color: var(--muted); max-width: 130mm; }
  .cover .meta { margin-top: 18mm; color: var(--muted); font-size: 9.5pt; }
  h2 {
    page-break-before: always;
    color: var(--navy);
    font-size: 17pt;
    border-bottom: 2px solid var(--navy);
    padding-bottom: 4px;
    margin: 0 0 .6em;
  }
  h2:first-of-type { page-break-before: avoid; }
  h3 { color: var(--navy); font-size: 12.5pt; margin: 1.3em 0 .4em; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  em { color: var(--muted); }
  a { color: var(--navy); text-decoration: none; }
  hr { display: none; }
  blockquote {
    margin: 1em 0; padding: .5em .9em;
    background: var(--faint); border-left: 4px solid var(--navy);
    border-radius: 0 6px 6px 0;
    page-break-inside: avoid;
  }
  blockquote p { margin: 0; }
  table {
    border-collapse: collapse; width: 100%; margin: .8em 0;
    font-size: 9.5pt; page-break-inside: avoid;
  }
  th { background: var(--navy); color: #fff; text-align: left; }
  th, td { border: 1px solid var(--line); padding: 5px 8px; vertical-align: top; }
  tr:nth-child(even) td { background: var(--faint); }
  code { background: var(--faint); padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
  p > img {
    display: block;
    margin: .9em auto;
    max-width: 78mm;
    max-height: 150mm;
    border: 1px solid var(--line);
    border-radius: 5mm;
    box-shadow: 0 2px 10px rgba(20,40,60,.14);
    page-break-inside: avoid;
  }
  p > img.wide {
    max-width: 150mm;
    max-height: 170mm;
    border-radius: 2mm;
    padding: 3mm;
    background: #fff;
  }
</style></head>
<body>
  <div class="cover">
    <div class="kicker">Nicky Hawkins &middot; Painter &amp; Decorator</div>
    <h1>NH Estimator<br>User Manual</h1>
    <div class="sub">A pocket guide to the paint-estimating app, from first measure to final invoice — measuring rooms, staircases and exteriors, pricing wallpaper and kitchen resprays, quoting through Xero, scheduling, and running the job on site.</div>
    <div class="meta">App version ${version} &nbsp;&middot;&nbsp; Manual generated ${generated}<br>Screenshots taken from the app with example data</div>
  </div>
  ${body}
</body></html>`;
}

(async () => {
  syncVersionStamp();
  // Written next to the markdown so the relative images/ paths resolve.
  fs.writeFileSync(TMP_HTML, buildHtml());
  const browser = await chromium.launch({ executablePath: findChrome() });
  try {
    const page = await browser.newPage();
    await page.goto('file://' + TMP_HTML, { waitUntil: 'networkidle' });
    await page.pdf({
      path: PDF,
      format: 'A4',
      margin: { top: '18mm', bottom: '16mm', left: '16mm', right: '16mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#8a97a3;padding:0 16mm;display:flex;justify-content:space-between;font-family:Arial">
        <span>NH Estimator — User Manual</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      printBackground: true,
    });
  } finally {
    await browser.close();
    fs.unlinkSync(TMP_HTML);
  }
  console.log('Wrote ' + path.relative(ROOT, PDF));
})().catch((err) => { console.error(err.message || err); process.exit(1); });
