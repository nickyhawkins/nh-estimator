#!/usr/bin/env node
'use strict';

// ── Regression test: wallpaper stripping as a chargeable prep task ─────────
//
// Stripping is priced the mist coat's way, not the Kitchen's: the room's
// walls and ceiling are ALREADY measured in m² for paint, so stripping
// multiplies that same figure by a per-m² minute rate picked from four
// difficulty tiers on Rates. What this file holds:
//
//   1. **The rate constants ship at 0 and are not guessed.** Four tiers,
//      all zero out of the box -- they are Nicky's own calibration figures,
//      and a plausible-looking default would quietly price real jobs at a
//      number nobody chose. A tier still at 0 with its toggle on must say
//      so on the form rather than adding £0 in silence.
//   2. **Walls and ceiling are independent, and carry their own tier.**
//      A room papered on the walls and painted on the ceiling is the normal
//      case; woodchip walls under a lining-paper ceiling is an ordinary
//      find. One shared tier would get one of them wrong.
//   3. **The time lands in the room's labour, not in a line item of its
//      own.** It joins baseTotal beside the mist coat, so it takes the
//      room's prep uplift and shows up in `time` -- the diary-day figure
//      the whole scheduling model runs on. The bug this guards against is
//      a strip that prices into `total` but never moves `time`, which
//      would quote the money and then not book the day.
//   4. **It reads the room's REAL wall area.** Walls excluded from the job
//      (paper that's staying) and walls deducted for panelling are not
//      being stripped either, so the strip must shrink with them.
//   5. **It round-trips.** Toggles and tiers survive a save and come back
//      on reopening, and a room saved before this feature existed reads as
//      "not being stripped" rather than throwing.
//
// USAGE
//   node scripts/test-wallpaper-stripping.js
//   npm run test:wallpaper-strip
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
// The Xero send is captured rather than mocked in the page: the payload is
// the actual thing the server turns into line items, and the description
// chain that builds it (which line carries the quote-text block, which says
// "same as above") is exactly what a stripping line has to stay out of.
let lastQuotePayload = null;
function serve(){return new Promise(r=>{const s=http.createServer((req,res)=>{const rel=decodeURIComponent(req.url.split('?')[0]);
 if(req.method==='POST'&&rel==='/auth/create-quote'){let b='';req.on('data',c=>b+=c);req.on('end',()=>{
   try{lastQuotePayload=JSON.parse(b);}catch(e){lastQuotePayload=null;}
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:'captured by the test'}));});return;}
 const f=path.join(PUBLIC,rel==='/'?'index.html':rel);
 if(!f.startsWith(PUBLIC)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end('nf');return;}
 res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'});res.end(fs.readFileSync(f));});
 s.listen(0,'127.0.0.1',()=>r(s));});}
const pass=[],fail=[];const check=(n,ok,d)=>(ok?pass:fail).push(n+(!ok&&d!==undefined?'  -- '+JSON.stringify(d):''));
const near=(a,b,tol)=>Math.abs(a-b)<(tol===undefined?0.01:tol);

// A 4 x 3.5 x 2.4 room: perimeter 15m, walls 36m² gross, ceiling 14m².
// No doors/windows, so nothing is cut out of the wall and the arithmetic
// below stays readable.
const SEED=()=>{
  jobs=[{id:'j1',name:'Test',status:'draft',contact:{},kitchen:null,fittedUnits:[],customItems:[]}];
  activeJobId='j1';
  colours=[{number:1,label:'All White',brand:'Farrow & Ball',code:'2005'}];
  const b=(o)=>Object.assign({wc:0,cc:0,xc:0,rads:0,win:0,sills:0,doorQty:0,frameQty:0,doorCoats:0,frameCoats:0,
    panelItems:[],excludedWalls:[],featureWallArea:0,featureWallMode:'paint',
    colourNumber:1,ceilingColourNumber:1,woodworkColourNumber:1,featureWallColourNumber:1,panelColourNumber:1,
    l:4,w:3.5,h:2.4,prepPct:0},o);
  rooms=[
    b({id:'ab12',name:'Lounge',wc:2,cc:2,xc:2}),
    // Saved long before this feature: no stripWall/stripCeil at all.
    b({id:'old1',name:'Old Room',wc:2,cc:2})
  ];
  extItems=[];materialsSnapshot=[];materialActuals=[];specTicks=[];snags=[];snagRooms=[];
};

(async()=>{
  const srv=await serve();
  const browser=await chromium.launch({executablePath:findChrome(),args:['--no-sandbox']});
  const page=await (await browser.newContext({viewport:{width:390,height:844}})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+srv.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1400);
  await page.evaluate(SEED);

  // ── 1. The tiers ship uncalibrated ──────────────────────────────────────
  const shipped = await page.evaluate(() => {
    var s = mergeSettings(null);
    return WALLPAPER_STRIP_TIERS.map(function(t){ return [t.key, s[t.setting]]; });
  });
  check('four difficulty tiers exist', shipped.length === 4, shipped);
  check('and every one ships at 0 min/m² — no guessed defaults',
    shipped.every(function(p){ return p[1] === 0; }), shipped);

  // A tier left at 0 with the toggle on is the case that must not go
  // unremarked: it prices at £0 by construction, so the form says why.
  await page.evaluate(() => { settings = mergeSettings(null); });
  await page.evaluate(() => editRoom('ab12'));
  await page.waitForTimeout(250);
  await page.evaluate(() => toggleFormSection('wpstrip'));
  await page.click('#tog-sw');
  await page.waitForTimeout(200);
  const uncal = await page.evaluate(() => ({
    shown: document.getElementById('wpstrip-summary').style.display !== 'none',
    text: document.getElementById('wpstrip-summary').textContent
  }));
  check('an uncalibrated tier warns instead of charging nothing in silence',
    uncal.shown && /No minutes\/m² set/.test(uncal.text) && /Rates/.test(uncal.text), uncal);

  // ── 2. Real rates: walls and ceiling, independently, at their own tier ──
  // Textured walls at 12 min/m², lining-paper ceiling at 3 min/m².
  await page.evaluate(() => {
    settings.stripWpTexturedMins = 12;
    settings.stripWpLiningMins = 3;
    settings.stripWpStandardMins = 6;
    settings.stripWpLayersMins = 18;
  });
  const rateInfo = await page.evaluate(() => ({ rpm: rpm(), hpd: settings.hpd }));

  const wallsOnly = await page.evaluate(() => {
    var r = { l:4, w:3.5, h:2.4, wc:2, cc:2, xc:0, win:0, sills:0, rads:0,
              doorQty:0, frameQty:0, prepPct:0,
              stripWall:true, stripWallType:'textured' };
    var c = calcRoom(r);
    var bare = calcRoom({ l:4, w:3.5, h:2.4, wc:2, cc:2, xc:0, win:0, sills:0, rads:0,
                          doorQty:0, frameQty:0, prepPct:0 });
    return { wallArea:c.wallArea, ceilArea:c.ceilArea, stripW:c.stripWCost, stripC:c.stripCCost,
             total:c.total, bareTotal:bare.total, time:c.time, bareTime:bare.time };
  });
  check('walls measure 36 m² and the ceiling 14 m²',
    near(wallsOnly.wallArea, 36) && near(wallsOnly.ceilArea, 14), wallsOnly);
  check('stripping walls = wall m² × the tier\'s min/m² × the rate per minute',
    near(wallsOnly.stripW, 36 * 12 * rateInfo.rpm, 0.5), { got: wallsOnly.stripW, rpm: rateInfo.rpm });
  check('the ceiling is untouched while only the walls are ticked',
    wallsOnly.stripC === 0, wallsOnly);
  check('and the strip lands in the room total',
    near(wallsOnly.total - wallsOnly.bareTotal, wallsOnly.stripW, 0.5), wallsOnly);

  // 3. The time, not just the money — this is the one that books the day.
  const addedMins = (wallsOnly.time - wallsOnly.bareTime) * rateInfo.hpd * 60;
  check('the stripping time reaches the room\'s labour days, not just its price',
    near(addedMins, 36 * 12, 1), { addedMins: addedMins, expected: 36 * 12 });

  // Ceiling on its own, at its own tier — a papered ceiling over painted
  // walls, and the two tiers must not bleed into each other.
  const bothSurfaces = await page.evaluate(() => {
    var base = { l:4, w:3.5, h:2.4, wc:2, cc:2, xc:0, win:0, sills:0, rads:0,
                 doorQty:0, frameQty:0, prepPct:0 };
    var ceilOnly = calcRoom(Object.assign({}, base, { stripCeil:true, stripCeilType:'lining' }));
    var both = calcRoom(Object.assign({}, base, {
      stripWall:true, stripWallType:'textured', stripCeil:true, stripCeilType:'lining' }));
    return { ceilOnlyW: ceilOnly.stripWCost, ceilOnlyC: ceilOnly.stripCCost,
             bothW: both.stripWCost, bothC: both.stripCCost };
  });
  check('the ceiling strips on its own, at its own tier',
    bothSurfaces.ceilOnlyW === 0 && near(bothSurfaces.ceilOnlyC, 14 * 3 * rateInfo.rpm, 0.5),
    bothSurfaces);
  check('walls and ceiling keep separate tiers when both are on',
    near(bothSurfaces.bothW, 36 * 12 * rateInfo.rpm, 0.5) &&
    near(bothSurfaces.bothC, 14 * 3 * rateInfo.rpm, 0.5), bothSurfaces);

  // ── 3. Prep uplift: stripping is prep, so it rides the room's prep % the
  //       same way the mist coat does. Guards against it being added after
  //       the multiplier (or twice).
  const prepped = await page.evaluate(() => {
    var base = { l:4, w:3.5, h:2.4, wc:0, cc:0, xc:0, win:0, sills:0, rads:0,
                 doorQty:0, frameQty:0, prepPct:40 };
    var c = calcRoom(Object.assign({}, base, { stripWall:true, stripWallType:'standard' }));
    return { total: c.total, raw: c.stripWCost };
  });
  check('the room\'s prep % applies to stripping once, like the mist coat',
    near(prepped.total, prepped.raw * 1.4, 0.5), prepped);

  // ── 4. It strips the wall area the room is actually painting ────────────
  // A 3m x 2.4m wall (7.2 m²) excluded from the job is paper that's
  // staying, and is not being stripped either.
  const excluded = await page.evaluate(() => {
    var base = { l:4, w:3.5, h:2.4, wc:2, cc:2, xc:0, win:0, sills:0, rads:0,
                 doorQty:0, frameQty:0, prepPct:0,
                 stripWall:true, stripWallType:'standard' };
    var plain = calcRoom(base);
    var withExcl = calcRoom(Object.assign({}, base, {
      excludedWalls: [{ id:'x1', width:3, height:2.4 }] }));
    return { plainArea: plain.wallArea, plainCost: plain.stripWCost,
             exclArea: withExcl.wallArea, exclCost: withExcl.stripWCost };
  });
  check('a wall excluded from the job is not stripped either',
    near(excluded.exclArea, 36 - 7.2) && near(excluded.exclCost, (36 - 7.2) * 6 * rateInfo.rpm, 0.5),
    excluded);

  // ── 5. Round-trip through a real save ───────────────────────────────────
  await page.evaluate(() => editRoom('ab12'));
  await page.waitForTimeout(250);
  await page.evaluate(() => toggleFormSection('wpstrip'));
  await page.click('#tog-sw');
  await page.click('#tog-sc');
  await page.waitForTimeout(150);
  const typeRows = await page.evaluate(() => ({
    wall: document.getElementById('wpstrip-wall-type-row').style.display,
    ceil: document.getElementById('wpstrip-ceil-type-row').style.display,
    wallBtns: document.querySelectorAll('#seg-wpstrip-wall .seg-btn').length
  }));
  check('the type selector only appears once its toggle is on',
    typeRows.wall === 'block' && typeRows.ceil === 'block' && typeRows.wallBtns === 4, typeRows);

  // Four tiers whose names are words, not digits, do not fit a seg placed
  // beside a label on a 390px phone -- the last button ran off the card's
  // right edge. The tier rows are stacked for that reason, and this holds it.
  const fits = await page.evaluate(() => {
    return ['seg-wpstrip-wall','seg-wpstrip-ceil'].map(function(id){
      var seg = document.getElementById(id);
      var card = seg.closest('.card');
      return { id: id, overflow: seg.scrollWidth - seg.clientWidth,
               past: Math.round(seg.getBoundingClientRect().right - card.getBoundingClientRect().right) };
    });
  });
  check('all four tier buttons fit inside the card at phone width',
    fits.every(function(f){ return f.overflow <= 1 && f.past <= 0; }), fits);

  await page.evaluate(() => { setWpStripType('wall','textured'); setWpStripType('ceil','lining'); });
  await page.waitForTimeout(150);
  await page.evaluate(() => saveRoom());
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => {
    var r = rooms.find(function(x){ return x.id==='ab12'; });
    return { sw: !!r.stripWall, sc: !!r.stripCeil, swt: r.stripWallType, sct: r.stripCeilType };
  });
  check('both toggles and both tiers are saved',
    saved.sw && saved.sc && saved.swt === 'textured' && saved.sct === 'lining', saved);

  await page.evaluate(() => editRoom('ab12'));
  await page.waitForTimeout(250);
  const reopened = await page.evaluate(() => ({
    swOn: document.getElementById('tog-sw').classList.contains('on'),
    scOn: document.getElementById('tog-sc').classList.contains('on'),
    swt: stripWallType, sct: stripCeilType,
    wallActive: (document.querySelector('#seg-wpstrip-wall .seg-btn.active')||{}).textContent,
    ceilActive: (document.querySelector('#seg-wpstrip-ceil .seg-btn.active')||{}).textContent
  }));
  check('and come back on reopening the room',
    reopened.swOn && reopened.scOn && reopened.swt === 'textured' && reopened.sct === 'lining' &&
    reopened.wallActive === 'Textured' && reopened.ceilActive === 'Lining', reopened);

  // Turning a surface back off drops its tier rather than leaving a stored
  // wallpaper type on a room that isn't being stripped.
  await page.evaluate(() => { toggleWpStrip('sc'); saveRoom(); });
  await page.waitForTimeout(300);
  const ceilOff = await page.evaluate(() => {
    var r = rooms.find(function(x){ return x.id==='ab12'; });
    return { sc: !!r.stripCeil, sct: r.stripCeilType, cost: calcRoom(r).stripCCost };
  });
  check('switching a surface off stops its strip and forgets its tier',
    ceilOff.sc === false && ceilOff.sct === undefined && ceilOff.cost === 0, ceilOff);

  // Summary's own breakdown names it — this view is Nicky's working record
  // of where a room's labour went, and a strip that moved the total without
  // appearing here would be unexplainable money. It names the tier too: the
  // difference between lining paper and four layers is the whole point.
  const breakdown = await page.evaluate(() => {
    var r = rooms.find(function(x){ return x.id==='ab12'; });
    r.stripCeil = true; r.stripCeilType = 'lining';
    renderSummary();
    var el = document.getElementById('screen-summary') || document.body;
    return el.textContent;
  });
  check('Summary\'s breakdown names the strip and the tier it was priced at',
    /Strip wallpaper — walls \(Textured \/ woodchip\)/.test(breakdown) &&
    /Strip wallpaper — ceiling \(Lining paper\)/.test(breakdown),
    breakdown.slice(0, 400));

  // ── 6. A room saved before the feature existed ──────────────────────────
  const legacy = await page.evaluate(() => {
    var r = rooms.find(function(x){ return x.id==='old1'; });
    var c = calcRoom(r);
    return { sw: c.stripWCost, sc: c.stripCCost, total: c.total };
  });
  check('a room saved before this feature prices exactly as it always did',
    legacy.sw === 0 && legacy.sc === 0 && legacy.total > 0, legacy);

  await page.evaluate(() => editRoom('old1'));
  await page.waitForTimeout(250);
  const legacyForm = await page.evaluate(() => ({
    swOn: document.getElementById('tog-sw').classList.contains('on'),
    scOn: document.getElementById('tog-sc').classList.contains('on'),
    summary: document.getElementById('wpstrip-summary').style.display
  }));
  check('and opens with the stripping card off and quiet',
    !legacyForm.swOn && !legacyForm.scOn && legacyForm.summary === 'none', legacyForm);

  // ── 6b. Staircase / HSL rooms ───────────────────────────────────────────
  // A hall, stairs and landing is one of the likeliest places to meet
  // woodchip, and it is also where a strip is easiest to lose: an HSL room
  // freezes its labour into `totalOverride` at save time, so a strip that
  // computeHSLOverrides() didn't bake in would show on the staircase
  // preview and then quietly vanish from the saved room's price.
  const hsl = await page.evaluate(() => {
    goScreen('room');
    setRoomStaircase(true);
    document.getElementById('hsl-h1-l').value = 3;
    document.getElementById('hsl-h1-w').value = 2;
    document.getElementById('hsl-h1-h').value = 2.4;
    setHSLFloors(2);
    document.getElementById('r-name').value = 'HSL';
    calcHSLNow();
    var before = computeHSLOverrides().totalOverride;
    stripWall = true; stripWallType = 'textured';
    stripCeil = true; stripCeilType = 'lining';
    applyWpStripUI();
    calcHSLNow();
    var ov = computeHSLOverrides();
    var saved = calcRoom(buildRoomFromForm());
    return { before: before, after: ov.totalOverride,
             wallArea: ov.wallAreaOverride, ceilArea: ov.ceilAreaOverride,
             previewShown: document.getElementById('hsl-r-cost').textContent,
             savedTotal: saved.total, savedTime: saved.time,
             prepPct: prepPct, rpm: rpm() };
  });
  const hslRaw = (hsl.wallArea * 12 + hsl.ceilArea * 3) * hsl.rpm;
  check('a staircase room strips against its own geometry-derived areas',
    near(hsl.after - hsl.before, hslRaw * (1 + hsl.prepPct / 100), 0.05),
    { delta: hsl.after - hsl.before, expected: hslRaw * (1 + hsl.prepPct / 100) });
  check('and the saved staircase total matches what its preview showed',
    near(hsl.savedTotal, hsl.after, 0.005) &&
    hsl.previewShown.replace(/[£,]/g, '') === hsl.after.toFixed(2),
    { preview: hsl.previewShown, saved: hsl.savedTotal, override: hsl.after });
  check('with the stripping time in the staircase room\'s days too',
    hsl.savedTime > 0, hsl);

  // ── 7. An accepted quote frozen before these rates existed ──────────────
  // Adding rows to SETTINGS_FIELDS must not make every already-accepted
  // quote announce a rates drift it never had ("Strip — lining paper
  // undefined → 0"). A key the snapshot predates is not a change.
  const drift = await page.evaluate(() => {
    var was = JSON.parse(JSON.stringify(settings));
    WALLPAPER_STRIP_TIERS.forEach(function(t){ delete was[t.setting]; });
    var d = ratesDriftSince({ data: { rates: was } });
    return { clean: d.clean, named: d.named.map(function(x){ return x.key; }) };
  });
  check('a quote accepted before these rates existed reports no drift from them',
    drift.clean === true, drift);

  // A rate that genuinely moves since acceptance still reports, by a label
  // that can't be confused with the £-per-roll "Lining paper" row above it.
  const realDrift = await page.evaluate(() => {
    var was = JSON.parse(JSON.stringify(settings));
    was.stripWpTexturedMins = 9;
    var d = ratesDriftSince({ data: { rates: was } });
    return { named: d.named, label: settingsFieldLabel('stripWpTexturedMins'),
             hungLabel: settingsFieldLabel('wpLiningRate') };
  });
  check('a stripping rate that really moves is still reported',
    realDrift.named.length === 1 && realDrift.named[0].key === 'stripWpTexturedMins', realDrift);
  check('and its label is distinct from the £-per-roll wallpaper rates',
    realDrift.label === 'Strip — textured / woodchip' && realDrift.label !== realDrift.hungLabel,
    realDrift);

  // ── 8. Its own line on the quote and the invoice ────────────────────────
  // The client has to see WHY the labour costs what it does, and a room
  // line reading "Back Bedroom £480" with nothing painted looks like a
  // mistake rather than a day with a steamer. The £ is CARVED OUT of the
  // room's line, never added to it: the two lines must sum to exactly what
  // the room summed to before, or the split has quietly re-priced the job.
  await page.evaluate(() => {
    settings.stripWpTexturedMins = 12; settings.stripWpLiningMins = 3;
    const base = (o) => Object.assign({
      wc: 0, cc: 0, xc: 0, rads: 0, win: 0, sills: 0, doorQty: 0, frameQty: 0,
      doorCoats: 0, frameCoats: 0, panelItems: [], excludedWalls: [],
      featureWallArea: 0, featureWallMode: 'paint',
      colourNumber: 1, ceilingColourNumber: 1, woodworkColourNumber: 1,
      featureWallColourNumber: 1, panelColourNumber: 1,
      l: 4, w: 3.5, h: 2.4, prepPct: 10 }, o);
    rooms = [
      // Painted AND stripped — two lines.
      base({ id: 'mix1', name: 'Lounge', wc: 2, cc: 2, xc: 2,
             stripWall: true, stripWallType: 'textured' }),
      // Stripped ONLY — the headline case: one line, and no £0 paint row.
      base({ id: 'str1', name: 'Back Bedroom',
             stripWall: true, stripWallType: 'textured',
             stripCeil: true, stripCeilType: 'lining' }),
      // Neither — untouched by any of this.
      base({ id: 'pnt1', name: 'Hall', wc: 2, cc: 2 })
    ];
    materialsSnapshot = [];
  });

  const quote = await page.evaluate(() => {
    var job = activeJob();
    var model = buildClientQuoteModel(job, rooms, [], null, calcKitchen(null),
      calcFittedUnitsAgg([]),
      { hasVariations: false, varLines: [], freeVars: [], varSundries: 0, varMk: 1,
        variationsTotal: 0, approvedTotal: 0, pendingCount: 0 }, 0, null);
    return {
      rows: model.work.rows.map(function(r){ return { label: r.label, sub: r.sub, amount: r.amount, key: r.key }; }),
      workTotal: model.work.subtotal,
      roomTotals: rooms.map(function(r){ return calcRoom(r).total; }),
      stripCharged: rooms.map(function(r){ return calcRoom(r).stripChargedCost; })
    };
  });
  const rowFor = (k) => quote.rows.filter(function(r){ return r.key === k; })[0];

  check('a painted-and-stripped room gets two lines on the client quote',
    !!rowFor('room:mix1') && !!rowFor('roomstrip:mix1'), quote.rows);
  check('a strip-only room gets ONE line, not a £0.00 paint line beside it',
    !rowFor('room:str1') && !!rowFor('roomstrip:str1'), quote.rows);
  check('a room with no stripping is untouched',
    !!rowFor('room:pnt1') && !rowFor('roomstrip:pnt1'), quote.rows);
  check('the stripping line names the room and the paper type',
    rowFor('roomstrip:str1').label === 'Wallpaper Stripping — Back Bedroom' &&
    /walls \(textured \/ woodchip\)/.test(rowFor('roomstrip:str1').sub) &&
    /ceiling \(lining paper\)/.test(rowFor('roomstrip:str1').sub),
    rowFor('roomstrip:str1'));

  // The invariant the whole carve-out rests on.
  const mixPair = rowFor('room:mix1').amount + rowFor('roomstrip:mix1').amount;
  const mixRatio = mixPair / quote.roomTotals[0];
  const strRatio = rowFor('roomstrip:str1').amount / quote.roomTotals[1];
  const pntRatio = rowFor('room:pnt1').amount / quote.roomTotals[2];
  check('the two lines sum to what the room billed as one — same markup, no drift',
    near(mixRatio, pntRatio, 0.0005) && near(strRatio, pntRatio, 0.0005),
    { mixRatio: mixRatio, strRatio: strRatio, pntRatio: pntRatio });

  // The same job with stripping OFF, to prove the grand total only moves by
  // the stripping itself and not by the act of splitting the lines.
  const totals = await page.evaluate(() => {
    var job = activeJob();
    var vv = { hasVariations: false, varLines: [], freeVars: [], varSundries: 0, varMk: 1,
               variationsTotal: 0, approvedTotal: 0, pendingCount: 0 };
    var withStrip = buildClientQuoteModel(job, rooms, [], null, calcKitchen(null), calcFittedUnitsAgg([]), vv, 0, null);
    var sumRows = function(m) {
      return Math.round(m.work.rows.reduce(function(t, r){ return t + r.amount; }, 0) * 100) / 100;
    };
    return { rowsSum: sumRows(withStrip), workTotal: withStrip.work.subtotal };
  });
  check('the printed stripping rows still add up to the printed work total',
    near(totals.rowsSum, totals.workTotal, 0.011), totals);

  // The final invoice bills it the same way, from live figures.
  const inv = await page.evaluate(() => {
    var m = buildFinalInvoiceModel();
    return m.labour.map(function(l){ return { id: l.id, desc: l.desc, amount: l.amount, ownText: !!l.ownText, scope: l.scope || '' }; });
  });
  const invStrip = inv.filter(function(l){ return /^Wallpaper Stripping/.test(l.desc); });
  check('the final invoice bills stripping on its own line too',
    invStrip.length === 2, inv);
  check('and those lines carry their own past-tense sentence, not the block',
    invStrip.every(function(l){ return l.ownText && /^Existing wallpaper stripped from the /.test(l.scope); }),
    invStrip);
  check('a strip-only room leaves no £0.00 paint line on the invoice either',
    !inv.some(function(l){ return l.desc === 'Back Bedroom'; }), inv);

  // An accepted quote freezes the split, so the frozen invoice reproduces it.
  const frozen = await page.evaluate(() => {
    var snap = buildAcceptedQuoteSnapshot(activeJob());
    var work = snap.lines.work;
    return { keys: work.map(function(r){ return r.sourceKey; }),
             labels: work.map(function(r){ return r.description; }),
             sum: Math.round(work.reduce(function(t, r){ return t + r.lineTotal; }, 0) * 100) / 100,
             agreed: snap.labour.labourTotal };
  });
  check('an accepted quote freezes the stripping lines as their own rows',
    frozen.keys.indexOf('roomstrip:mix1') !== -1 && frozen.keys.indexOf('roomstrip:str1') !== -1 &&
    frozen.keys.indexOf('room:str1') === -1, frozen);
  check('and the frozen rows still sum to the agreed labour figure',
    near(frozen.sum, frozen.agreed, 0.005), frozen);

  // ── 9. The Xero quote, and which line carries the description block ─────
  // The block is the quote's wording — protection, preparation, standards,
  // completion — and it rides ONE line, describing that line. A stripping
  // line must not be it (the block enumerates ceilings, walls and woodwork)
  // and must not say "- same as above" either.
  page.on('dialog', function(d){ d.accept(); });
  const sendQuote = async (spec) => {
    lastQuotePayload = null;
    await page.evaluate((s) => {
      var B = function(o){ return Object.assign({
        wc:0, cc:0, xc:0, rads:0, win:0, sills:0, doorQty:0, frameQty:0, doorCoats:0, frameCoats:0,
        panelItems:[], excludedWalls:[], featureWallArea:0, featureWallMode:'paint',
        colourNumber:1, ceilingColourNumber:1, woodworkColourNumber:1,
        featureWallColourNumber:1, panelColourNumber:1,
        l:4, w:3.5, h:2.4, prepPct:10 }, o); };
      rooms = s.map(B); extItems = []; materialsSnapshot = [];
      jobs[0].xeroClient = 'Mrs Smith'; jobs[0].quoteText = null; jobs[0].xeroQuoteId = null;
    }, spec);
    await page.evaluate(async () => {
      var orig = blockIfOffline;            // the test server is the "Xero" here
      blockIfOffline = function(){ return false; };
      try { await createXeroQuote(true); } catch (e) { /* captured server-side */ }
      blockIfOffline = orig;
    });
    await page.waitForTimeout(400);
    return lastQuotePayload;
  };
  const hasBlock = (d) => /PROTECTION & PREPARATION/.test(d || '');

  // A room stripped AND painted, then a room only stripped.
  let sent = await sendQuote([
    { id: 'q1', name: 'Lounge', wc: 2, cc: 2, xc: 2, stripWall: true, stripWallType: 'textured' },
    { id: 'q2', name: 'Back Bedroom', stripWall: true, stripWallType: 'textured' }
  ]);
  check('the Xero quote gets a stripping line of its own', !!sent &&
    sent.rooms.filter(function(r){ return /^Wallpaper Stripping/.test(r.name); }).length === 2,
    sent && sent.rooms.map(function(r){ return r.name; }));
  check('the Xero payload carries only name/total/description per line',
    !!sent && sent.rooms.every(function(r){
      return Object.keys(r).sort().join(',') === 'description,name,total'; }),
    sent && Object.keys(sent.rooms[0]));
  const stripLines = (sent.rooms || []).filter(function(r){ return /^Wallpaper Stripping/.test(r.name); });
  check('a stripping line takes neither the block nor "same as above"',
    stripLines.every(function(r){ return !hasBlock(r.description) && !/same as above/.test(r.description); }),
    stripLines.map(function(r){ return r.description; }));
  check('and states which surfaces are being stripped',
    stripLines.every(function(r){ return /Existing wallpaper to be stripped from the /.test(r.description); }),
    stripLines.map(function(r){ return r.description; }));

  // A strip-only room FIRST. The block has to skip it and land on the first
  // room that is actually being painted — and name THAT room, not the one
  // that is only having paper taken off. Two identical painted rooms after
  // it must still collapse to "same as above".
  sent = await sendQuote([
    { id: 'q1', name: 'Back Bedroom', stripWall: true, stripWallType: 'textured' },
    { id: 'q2', name: 'Bedroom 1', wc: 2, cc: 2, xc: 2 },
    { id: 'q3', name: 'Bedroom 2', wc: 2, cc: 2, xc: 2 }
  ]);
  const blockLine = (sent.rooms || []).filter(function(r){ return hasBlock(r.description); })[0];
  check('the block skips a strip-only first room and lands on the first painted one',
    !!blockLine && blockLine.name === 'Bedroom 1', sent && sent.rooms.map(function(r){ return r.name; }));
  check('and the block names the room whose line it is on',
    !!blockLine && /Painting of Bedroom 1/.test(blockLine.description),
    blockLine && blockLine.description.slice(0, 120));
  check('an identical room after it still collapses to "same as above"',
    (sent.rooms || []).some(function(r){ return r.name === 'Bedroom 2' && /same as above/.test(r.description); }),
    sent && sent.rooms.map(function(r){ return r.description.slice(0, 60); }));

  // A job that is NOTHING but stripping. This threw while the feature was
  // being built: with no painted room to take the block, the exterior
  // baseline branch ran for the first time on a job with no exterior items
  // and read `.coats` off undefined, and the whole send died.
  sent = await sendQuote([
    { id: 'q1', name: 'Back Bedroom', stripWall: true, stripWallType: 'textured' },
    { id: 'q2', name: 'Landing', stripWall: true, stripWallType: 'layers' }
  ]);
  check('a job that is nothing but stripping still sends',
    !!sent && sent.rooms.length === 2 &&
    sent.rooms.every(function(r){ return /^Wallpaper Stripping/.test(r.name); }),
    sent && sent.rooms.map(function(r){ return r.name; }));
  check('and the quote text is not lost — it rides under the first strip line',
    !!sent && hasBlock(sent.rooms[0].description) &&
    sent.rooms[0].description.indexOf('Existing wallpaper to be stripped') <
      sent.rooms[0].description.indexOf('PROTECTION & PREPARATION') &&
    !hasBlock(sent.rooms[1].description),
    sent && sent.rooms.map(function(r){ return r.description.slice(0, 80); }));

  check('nothing threw along the way', errors.length === 0, errors);

  await browser.close(); srv.close();
  console.log('\nWallpaper stripping\n');
  pass.forEach(n=>console.log('  ✓ '+n)); fail.forEach(n=>console.log('  ✗ '+n));
  console.log('\n'+pass.length+' passed, '+fail.length+' failed\n');
  process.exit(fail.length?1:0);
})();
