#!/usr/bin/env node
'use strict';

// ── Regression test: the radiator colour override's blast radius ──────────
//
// JOB_SPEC_SHEET_SPEC.md. Radiators are priced as labour only (`rRad` minutes
// each) and buy no paint litres of their own -- they ride the woodwork tin. A
// room can now give them a colour anyway, which means a colour number can
// exist whose ONLY area is a radiator, and that is a shape nothing in the
// materials engine had ever seen.
//
// So this holds the one thing that must not move:
//
//   1. **THE TINS DO NOT CHANGE**, before or after switching the override on,
//      and whichever colour it is switched to. A colour on nothing but a
//      radiator must never appear as a buy line or move `computeRoleGroups`,
//      which has no radiator role and must not gain one.
//   2. `colourAreas()` gains a `radiator` area ONLY while the override is on,
//      so no room gets a new "to decide" item unless it asked for one.
//   3. `roomColourSchedule()` -- the ONE function every colour schedule reads,
//      the client's quote included -- names the radiators on the same
//      condition, and its existing merge logic collapses a radiator colour
//      identical to the woodwork's into "Woodwork/Radiators: X".
//   4. The Colours tab renders the new area without a special case, and
//      without erroring on a colour that covers no surface with litres on it.
//   5. Switching it back off restores every one of the above exactly.
//
// Driven in a real browser against the real public/index.html, because what
// is being compared is `computeMaterials()`'s actual output over a real job,
// not a pure function's. The app shell is served straight off disk -- no
// server, no database.
//
// USAGE
//   node scripts/test-radiator-colour.js
//   npm run test:radiator
const fs=require('fs'),path=require('path'),http=require('http');
const { chromium } = require('playwright-core');
const ROOT=path.join(__dirname,'..'), PUBLIC=path.join(ROOT,'public');
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'};

function findChrome(){
  const cands=[process.env.CHROME_PATH,'/opt/pw-browsers/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean);
  for(const c of cands) if(fs.existsSync(c)) return c;
  for(const n of ['google-chrome-stable','google-chrome','chromium','chromium-browser']){
    try{const p=require('child_process').execSync('which '+n,{stdio:['ignore','pipe','ignore']}).toString().trim(); if(p) return p;}catch(e){}
  }
  throw new Error('No Chrome/Chromium found. Install one, or point CHROME_PATH at the executable.');
}
function serve(){return new Promise(r=>{const s=http.createServer((req,res)=>{const rel=decodeURIComponent(req.url.split('?')[0]);
 const f=path.join(PUBLIC,rel==='/'?'index.html':rel);
 if(!f.startsWith(PUBLIC)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end('nf');return;}
 res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'});res.end(fs.readFileSync(f));});
 s.listen(0,'127.0.0.1',()=>r(s));});}
const pass=[],fail=[];const check=(n,ok,d)=>(ok?pass:fail).push(n+(!ok&&d!==undefined?'  -- '+JSON.stringify(d):''));
const SEED=()=>{
  jobs=[{id:'j1',name:'Test',status:'accepted',contact:{},kitchen:null,fittedUnits:[],customItems:[]}];
  activeJobId='j1';
  colours=[{number:1,label:'All White',brand:'Farrow & Ball',code:'2005'},{number:2,label:'Dead Salmon',brand:'',code:''},{number:3,label:'Card Room Green',brand:'',code:''}];
  const b=(o)=>Object.assign({wc:0,cc:0,xc:0,rads:0,win:0,sills:0,doorQty:0,frameQty:0,doorCoats:0,frameCoats:0,panelItems:[],featureWallArea:0,featureWallMode:'paint',colourNumber:1,ceilingColourNumber:1,woodworkColourNumber:1,featureWallColourNumber:1,panelColourNumber:1,l:4,w:3.5,h:2.4,prepPct:10},o);
  rooms=[b({id:'ab12',name:'Lounge',wc:2,cc:2,xc:2,rads:1.4,colourNumber:2})];
  extItems=[];materialsSnapshot=[];materialActuals=[];specTicks=[];snags=[];snagRooms=[];
};
const SNAPSHOT=()=>{
  const mats=computeMaterials();
  const rows=mats.wallRows.concat(mats.ceilingRows,mats.topcoatRows,mats.primerRows,mats.mistRows,mats.featureWallRows,mats.panelRows);
  return { lines: rows.map(r=>r.description+'|'+r.quantity).sort(),
           areas: colourAreas().map(a=>a.label+':'+a.num),
           schedule: roomColourSchedule(rooms[0]) };
};
(async()=>{
  const srv=await serve();
  const browser=await chromium.launch({executablePath:findChrome(),args:['--no-sandbox']});
  const page=await (await browser.newContext({viewport:{width:390,height:844}})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+srv.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1400);
  await page.evaluate(SEED);
  const before=await page.evaluate(SNAPSHOT);
  check('no radiator area before the override', !before.areas.some(a=>/Radiators/.test(a)), before.areas);
  check('schedule reads as it always did', before.schedule === 'Walls: Dead Salmon · Ceiling/Woodwork: Farrow & Ball No. 2005 All White', before.schedule);

  // Turn the override on, to a colour of its own.
  await page.evaluate(() => { rooms[0].radiatorColourNumber = 3; });
  const after=await page.evaluate(SNAPSHOT);
  check('THE TINS ARE UNCHANGED', JSON.stringify(after.lines)===JSON.stringify(before.lines),
    { before: before.lines, after: after.lines });
  check('the radiator joins the areas', after.areas.some(a=>/Lounge Radiators:3/.test(a)), after.areas);
  check('the schedule names the radiators',
    after.schedule.indexOf('Radiators: Card Room Green') >= 0, after.schedule);

  // A radiator colour identical to the woodwork merges.
  await page.evaluate(() => { rooms[0].radiatorColourNumber = 1; });
  const merged=await page.evaluate(SNAPSHOT);
  check('an identical colour merges with the woodwork',
    merged.schedule.indexOf('Woodwork/Radiators') >= 0, merged.schedule);
  check('and the tins still have not moved',
    JSON.stringify(merged.lines)===JSON.stringify(before.lines), merged.lines);

  // The Colours tab renders the new area, and the What-to-buy card survives a
  // colour whose only area is a radiator.
  await page.evaluate(() => { rooms[0].radiatorColourNumber = 3; renderColours(); });
  await page.waitForTimeout(300);
  const colourHtml = await page.evaluate(() => document.getElementById('colour-areas-card').innerText);
  check('the Colours tab lists Radiators as an area', colourHtml.indexOf('Radiators') >= 0, colourHtml.slice(0,200));
  check('no errors rendering Colours with a radiator area', errors.length===0, errors);

  // Off again, and everything is back.
  await page.evaluate(() => { rooms[0].radiatorColourNumber = null; });
  const off=await page.evaluate(SNAPSHOT);
  check('switching it back off restores the areas', JSON.stringify(off.areas)===JSON.stringify(before.areas), off.areas);
  check('and the schedule', off.schedule===before.schedule, off.schedule);

  await browser.close(); srv.close();
  console.log('\nRadiator override blast radius\n');
  pass.forEach(n=>console.log('  ✓ '+n)); fail.forEach(n=>console.log('  ✗ '+n));
  console.log('\n'+pass.length+' passed, '+fail.length+' failed\n');
  process.exit(fail.length?1:0);
})();
