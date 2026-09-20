#!/usr/bin/env node
'use strict';

// ── Regression test: where the room form's toggles live, and the Radiators
//    colour row actually showing up ─────────────────────────────────────────
//
// Three things had gone wrong with the Edit Room form, all of them "I can't
// find it" rather than "it prices wrong":
//
//   1. **The Radiators colour row never appeared.** Both entry paths
//      (goScreen('room') for a new room, editRoom() for an existing one)
//      called renderRadiatorColourRow() ~90 lines BEFORE they filled in the
//      r-rads field it keys off, so the row read the previous form's radiator
//      count -- blank on a fresh load. A room with radiators opened with no
//      Radiators row under the colours at all. Held here: open a room with
//      radiators, the row is there; then start a new room, and it is gone
//      again (the same ordering bug the other way round).
//   2. **Variation sat at the bottom of the Coats card**, which says nothing
//      about coats -- it says what this room IS to the job. It belongs with
//      the room's name, which is where the exterior, kitchen and fitted-unit
//      forms have always kept theirs.
//   3. **Self-priming was in two different cards** -- doors/frames under
//      Doors & Frames, everything else under Preparation -- while the product
//      that can take both of them over (the Woodwork Topcoat) is on a third.
//      Both now sit under Woodwork Primer in Paint & Colour, the primer they
//      cancel, with the topcoat that drives them a few rows above.
//
// The toggles must still WORK from their new homes: flick both, save, reopen,
// and the flags must round-trip.
//
// USAGE
//   node scripts/test-room-form-layout.js
//   npm run test:room-form-layout
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
  colours=[{number:1,label:'All White',brand:'Farrow & Ball',code:'2005'},{number:2,label:'Dead Salmon',brand:'',code:''}];
  const b=(o)=>Object.assign({wc:0,cc:0,xc:0,rads:0,win:0,sills:0,doorQty:0,frameQty:0,doorCoats:0,frameCoats:0,panelItems:[],featureWallArea:0,featureWallMode:'paint',colourNumber:1,ceilingColourNumber:1,woodworkColourNumber:1,featureWallColourNumber:1,panelColourNumber:1,l:4,w:3.5,h:2.4,prepPct:10},o);
  rooms=[
    b({id:'ab12',name:'Lounge',wc:2,cc:2,xc:2,rads:1.4,colourNumber:2}),
    b({id:'cd34',name:'Landing',wc:2,cc:2,xc:2,rads:0})
  ];
  extItems=[];materialsSnapshot=[];materialActuals=[];specTicks=[];snags=[];snagRooms=[];
};

// Which titled card on the room form is this row inside? Walks up to the
// enclosing .card and reads its header -- the same thing the eye does.
const CARD_OF=(id)=>{
  var el=document.getElementById(id);
  if(!el) return '(no such row)';
  var card=el.closest('.card');
  if(!card) return '(not in a card)';
  var head=card.querySelector('.card-header');
  return head ? head.textContent.replace(/›/g,'').trim() : '(card with no header)';
};

(async()=>{
  const srv=await serve();
  const browser=await chromium.launch({executablePath:findChrome(),args:['--no-sandbox']});
  const page=await (await browser.newContext({viewport:{width:390,height:844}})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+srv.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1400);
  await page.evaluate(SEED);
  await page.evaluate(CARD_OF_DEF => { window.CARD_OF = eval(CARD_OF_DEF); }, '(' + CARD_OF.toString() + ')');

  // ── 1. The Radiators colour row, on a room that has radiators ───────────
  await page.evaluate(() => editRoom('ab12'));
  await page.waitForTimeout(200);
  let row = await page.evaluate(() => ({
    rads: document.getElementById('r-rads').value,
    shown: document.getElementById('r-radiator-colour-row').style.display !== 'none',
    chip: !!document.getElementById('r-radiator-same-chip')
  }));
  check('the room opens with its radiator figure in the form', row.rads === '1.4', row);
  check('and the Radiators colour row is on screen with it', row.shown === true, row);
  check('"Same as woodwork" chip is there to turn off', row.chip, row);

  // Turning the chip off mints a colour of its own and reveals the field.
  await page.evaluate(() => toggleRadiatorFollowsWoodwork());
  await page.waitForTimeout(150);
  let off = await page.evaluate(() => ({
    field: document.getElementById('r-radiator-colour-field').style.display,
    num: roomColourNumbers.radiator
  }));
  check('switching the chip off opens the colour field', off.field === 'flex', off);
  check('and puts the radiators on a colour of their own', !!off.num, off);

  // ── 2. A room with NO radiators does not get the row (the same ordering
  //       bug in the other direction: it used to linger from the last room) ─
  await page.evaluate(() => editRoom('cd34'));
  await page.waitForTimeout(200);
  let none = await page.evaluate(() => ({
    rads: document.getElementById('r-rads').value,
    shown: document.getElementById('r-radiator-colour-row').style.display !== 'none'
  }));
  check('a room with no radiators has no Radiators colour row', none.shown === false, none);

  // A brand new room, straight after a room that had radiators.
  await page.evaluate(() => editRoom('ab12'));
  await page.waitForTimeout(150);
  await page.evaluate(() => goScreen('room'));
  await page.waitForTimeout(200);
  let fresh = await page.evaluate(() => ({
    rads: document.getElementById('r-rads').value,
    shown: document.getElementById('r-radiator-colour-row').style.display !== 'none'
  }));
  check('a new room does not inherit the last room\'s Radiators row',
    fresh.rads === '' && fresh.shown === false, fresh);

  // Typing a radiator figure brings the row up there and then. (The form
  // opens with its sections collapsed, so open Extras the way a user would.)
  await page.evaluate(() => toggleFormSection('extras'));
  await page.fill('#r-rads', '2');
  await page.waitForTimeout(200);
  check('typing a radiator area brings the row up',
    await page.evaluate(() => document.getElementById('r-radiator-colour-row').style.display !== 'none'));

  // ── 3. Where the toggles live ───────────────────────────────────────────
  const homes = await page.evaluate(() => ({
    variation: CARD_OF('variation-row'),
    doorSelfPriming: CARD_OF('tog-doorselfpriming'),
    woodSelfPriming: CARD_OF('tog-selfprimingwoodwork')
  }));
  check('Variation sits with the room\'s identity, not under Coats',
    /Room Details/.test(homes.variation), homes);
  check('doors & frames self-priming is in Paint & Colour',
    /Paint & Colour/.test(homes.doorSelfPriming), homes);
  check('the other woodwork\'s self-priming is there too',
    /Paint & Colour/.test(homes.woodSelfPriming), homes);
  check('the two self-priming toggles are on the same card',
    homes.doorSelfPriming === homes.woodSelfPriming, homes);

  // Both are still the rows a product-driven topcoat takes over (the "set by
  // the product" note swaps in for the toggle).
  const driven = await page.evaluate(() => {
    var seen = [];
    var orig = coverageSelfPrimingFor;
    coverageSelfPrimingFor = function(){ return true; };
    roomOverrides.topcoat.range = 'Test Topcoat';
    updateSelfPrimingDrivenUI();
    ['doorselfpriming','selfprimingwoodwork'].forEach(function(k){
      seen.push(document.getElementById('tog-'+k).style.display + '/' +
                document.getElementById('driven-'+k).textContent);
    });
    coverageSelfPrimingFor = orig;
    roomOverrides.topcoat.range = '';
    updateSelfPrimingDrivenUI();
    return seen;
  });
  check('a product-driven topcoat still takes over both toggles',
    driven.every(s => /^none\/On — Test Topcoat$/.test(s)), driven);

  // ── 4. And they still work from where they now are ──────────────────────
  await page.evaluate(() => editRoom('ab12'));
  await page.waitForTimeout(200);
  await page.evaluate(() => toggleFormSection('paint'));
  await page.click('#tog-doorselfpriming');
  await page.click('#tog-selfprimingwoodwork');
  await page.click('#tog-variation');
  const flags = await page.evaluate(() => ({
    door: doorSelfPriming, wood: selfPrimingWoodwork, variation: roomIsVariation,
    doorOn: document.getElementById('tog-doorselfpriming').classList.contains('on'),
    woodOn: document.getElementById('tog-selfprimingwoodwork').classList.contains('on'),
    varOn: document.getElementById('tog-variation').classList.contains('on')
  }));
  check('tapping them still flips the flags and the toggles',
    flags.door === flags.doorOn && flags.wood === flags.woodOn && flags.variation === flags.varOn,
    flags);

  await page.evaluate(() => saveRoom());
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => {
    var r = rooms.find(function(x){return x.id==='ab12';});
    return { door: !!r.doorSelfPriming, wood: !!r.selfPrimingWoodwork, variation: !!r.isVariation };
  });
  await page.evaluate(() => editRoom('ab12'));
  await page.waitForTimeout(200);
  const reopened = await page.evaluate(() => ({
    door: document.getElementById('tog-doorselfpriming').classList.contains('on'),
    wood: document.getElementById('tog-selfprimingwoodwork').classList.contains('on'),
    variation: document.getElementById('tog-variation').classList.contains('on')
  }));
  check('both self-priming flags survive a save', saved.door === flags.door && saved.wood === flags.wood,
    { saved: saved, set: flags });
  check('and come back on reopening the room',
    reopened.door === saved.door && reopened.wood === saved.wood, { saved: saved, reopened: reopened });
  check('the Variation flag round-trips from its new home',
    saved.variation === flags.variation && reopened.variation === saved.variation,
    { saved: saved, reopened: reopened });

  check('nothing threw along the way', errors.length === 0, errors);

  await browser.close(); srv.close();
  console.log('\nRoom form layout\n');
  pass.forEach(n=>console.log('  ✓ '+n)); fail.forEach(n=>console.log('  ✗ '+n));
  console.log('\n'+pass.length+' passed, '+fail.length+' failed\n');
  process.exit(fail.length?1:0);
})();
