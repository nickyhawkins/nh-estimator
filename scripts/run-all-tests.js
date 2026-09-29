#!/usr/bin/env node
// `npm test`: run every `test:*` script in package.json, one after another,
// and exit non-zero if any of them fails. Run it before every promotion to
// `stable`. Each test is its own process (they share no state), so one
// crashing never hides the results of the rest.
//
//   npm test                 -- everything
//   npm test -- snap quote   -- only test:* names containing "snap" or "quote"

const { spawnSync } = require('child_process');
const path = require('path');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const filters = process.argv.slice(2);
const names = Object.keys(pkg.scripts)
  .filter(n => n.startsWith('test:'))
  .filter(n => !filters.length || filters.some(f => n.includes(f)));

const failed = [];
const started = Date.now();
for (const name of names) {
  const t0 = Date.now();
  const r = spawnSync('npm', ['run', '--silent', name], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`  ok    ${name} (${secs}s)`);
  } else {
    failed.push(name);
    console.log(`  FAIL  ${name} (${secs}s)`);
    const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n');
    console.log(out.slice(-25).map(l => '        ' + l).join('\n'));
  }
}

const total = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${names.length - failed.length}/${names.length} passed in ${total}s`);
if (failed.length) {
  console.log('Failed: ' + failed.join(', '));
  process.exit(1);
}
