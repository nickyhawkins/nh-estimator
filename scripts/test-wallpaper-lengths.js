#!/usr/bin/env node
'use strict';

// ── Regression test: the number of lengths on the quote description ────────
//
// The Wallpapering and Painting & Papering templates say "[X] lengths of
// [paper name/supplier] to be hung to {papered}". Nicky typed that number
// in by hand; it is now filled from the calc engine.
//
// LENGTHS, not rolls. A length is one strip cut and hung; rolls are what
// gets ordered, and are already the "Rolls to order" figure on the room
// form and the materials list. The two differ by drops-per-roll, so
// printing one where the other belongs misquotes the client. Every
// calculator in this app already computed dropsNeeded and threw it away —
// this file holds the plumbing that keeps it.
//
// What it pins:
//   1. The figure is drops, and it differs from rolls on a real room.
//   2. Lining AND finish on one wall is ONE set of lengths, not two. The
//      sentence names one paper, and lining is prep in the same template.
//      (v2.76.2 shipped this wrong — 58 where 29 was true.) Wide vinyl is
//      hung in drops and counts; a mural is one printed piece and does not.
//   3. It totals the WHOLE JOB, because {papered} beside it in the same
//      sentence always has.
//   4. Panelling taken out of the papered walls takes its drops with it.
//   5. A STAIRCASE room still has a figure. Its drops all differ across the
//      rake, and calcRoom only ever sees dummy l=w=h=1 dims, so the count
//      has to be frozen at save time like the rolls already were.
//   6. A figure that cannot be known falls back to the [X] marker rather
//      than inventing one — a made-up number on a client document is worse
//      than the marker Nicky was filling in anyway.
//
// USAGE
//   node scripts/test-wallpaper-lengths.js
//   npm run test:wallpaper-lengths
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
const eq=(n,got,want)=>check(n,got===want,{got:got,want:want});

(async()=>{
  const srv=await serve();
  const browser=await chromium.launch({executablePath:findChrome(),args:['--no-sandbox']});
  const page=await (await browser.newContext({viewport:{width:390,height:844}})).newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  await page.goto('http://127.0.0.1:'+srv.address().port+'/',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1400);

  await page.evaluate(() => {
    jobs=[{id:'j1',name:'Test',status:'draft',contact:{},kitchen:null,fittedUnits:[],customItems:[]}];
    activeJobId='j1'; colours=[]; extItems=[]; materialsSnapshot=[];
    window.B = function(o){ return Object.assign({
      wc:0, cc:0, xc:0, rads:0, win:0, sills:0, doorQty:0, frameQty:0, doorCoats:0, frameCoats:0,
      panelItems:[], excludedWalls:[], featureWallArea:0, featureWallMode:'paint',
      colourNumber:1, ceilingColourNumber:1, woodworkColourNumber:1,
      featureWallColourNumber:1, panelColourNumber:1,
      // Standard UK roll, no pattern match, so the arithmetic below is
      // readable: 4 x 3.5 x 2.4 gives a 15m perimeter.
      wpRollLen:10.05, wpRollWidth:0.53, wpMatch:'none', wpRepeatMm:0,
      l:4, w:3.5, h:2.4, prepPct:10 }, o); };
  });

  // ── 1. Drops are not rolls ──────────────────────────────────────────────
  // 15m of wall at 0.53m per drop = 29 drops. Drop length 2.4m + trim, so a
  // 10.05m roll gives 4 drops — nowhere near 29.
  const one = await page.evaluate(() => {
    var r = B({ id:'a', name:'Lounge', wpWallFinish:true });
    var c = calcRoom(r);
    var raw = calcWallpaperRolls(2.4, roomShapePerimeter(r), 10.05, 0.53, 'none', 0, settings.wpTrimCm, false);
    return { drops:c.wpwDrops, rolls:c.wpwRolls, perim:roomShapePerimeter(r),
             rawDrops:raw.dropsNeeded, rawRolls:raw.rolls, dropsPerRoll:raw.dropsPerRoll };
  });
  eq('the drops are the calculator\'s own dropsNeeded', one.drops, one.rawDrops);
  eq('the rolls are unchanged by any of this', one.rolls, one.rawRolls);
  check('drops and rolls are genuinely different numbers',
    one.drops !== one.rolls && one.drops > one.rolls, one);
  check('29 drops off a 15m perimeter at 0.53m', one.perim === 15 && one.drops === 29, one);

  // ── 2. Lining AND finish is ONE set of lengths ──────────────────────────
  // How many strips go round a wall is ceil(width / roll width), and that
  // is the same whether the paper is lining or finish — a pattern match
  // changes each drop's LENGTH, never how many there are. The sentence
  // names ONE paper ("[X] lengths of [paper name/supplier]"), and on a
  // lined-and-papered wall only the finish paper's drops are lengths OF
  // that paper; the Wallpapering template's PREPARATION paragraph already
  // says the walls are "sized/lined prior to hanging".
  // This shipped wrong in v2.76.2 — it printed 58 where 29 was true.
  const both = await page.evaluate(() => {
    var lining = calcRoom(B({ id:'b', name:'L', wpWallLining:true }));
    var finish = calcRoom(B({ id:'c', name:'F', wpWallFinish:true }));
    var pair   = calcRoom(B({ id:'d', name:'B', wpWallLining:true, wpWallFinish:true }));
    return { lining:lining.wpwDrops, finish:finish.wpwDrops, pair:pair.wpwDrops };
  });
  eq('lining and finish are the same count on the same wall', both.lining, both.finish);
  eq('so lining under finish is ONE set of lengths, not two', both.pair, both.finish);
  check('and that is not the sum of the two', both.pair !== both.lining + both.finish, both);

  // ── 2b. Wide vinyl counts; a mural does not ─────────────────────────────
  // Vinyl comes off a wide continuous roll but is still hung in drops. A
  // mural is one printed piece, so it has no lengths to state.
  const fw = await page.evaluate(() => {
    var base = { featureWallMode:'wallpaper', featureWallWidth:4, featureWallHeight:2.4,
                 featureWallArea:9.6 };
    var vinyl = calcRoom(B(Object.assign({ id:'v', name:'V', fwWpCommercialType:'wideVinyl',
                                           fwVinylRollWidthCm:137 }, base)));
    var mural = calcRoom(B(Object.assign({ id:'m', name:'M', fwWpCommercialType:'mural' }, base)));
    var paper = calcRoom(B(Object.assign({ id:'p', name:'P', fwWpCommercialType:'none',
                                           fwWpFinish:true }, base)));
    return { vinyl:vinyl.featureWallWpDrops, mural:mural.featureWallWpDrops,
             paper:paper.featureWallWpDrops,
             vinylLengths: buildLengthsValue([B(Object.assign({ id:'v2', name:'V',
               fwWpCommercialType:'wideVinyl', fwVinylRollWidthCm:137 }, base))]) };
  });
  eq('4m of 1.37m wide vinyl is 3 drops', fw.vinyl, 3);
  eq('and it reaches the quote', fw.vinylLengths, '3');
  eq('a mural has no lengths at all', fw.mural, 0);
  check('ordinary feature-wall paper still counts', fw.paper > 0, fw);

  // ── 3. Whole job, like {papered} ────────────────────────────────────────
  const job = await page.evaluate(() => {
    rooms = [ B({ id:'r1', name:'Lounge', wpWallFinish:true }),
              B({ id:'r2', name:'Hall', wpWallFinish:true, wpCeilFinish:true }) ];
    var sum = rooms.reduce(function(t, r){
      var c = calcRoom(r);
      return t + c.wpwDrops + c.wpcDrops + c.featureWallWpDrops;
    }, 0);
    return { lengths: buildLengthsValue(rooms), sum: sum, papered: buildPaperedPhrase(rooms) };
  });
  eq('the lengths total the whole job', job.lengths, String(job.sum));
  check('and cover everything {papered} names',
    /walls/.test(job.papered) && /ceiling/.test(job.papered), job);

  // ── 4. Panelling comes off the paper, and takes its drops ───────────────
  const panelled = await page.evaluate(() => {
    var plain = calcRoom(B({ id:'p1', name:'Lounge', wpWallFinish:true }));
    var withPanel = calcRoom(B({ id:'p2', name:'Lounge', wpWallFinish:true,
      panelItems:[{ id:'x', width:3, height:2.4, coats:2, deduct:true }] }));
    return { plain: plain.wpwDrops, panelled: withPanel.wpwDrops };
  });
  check('a full-height panelled wall takes its drops out of the paper',
    panelled.panelled < panelled.plain && panelled.panelled > 0, panelled);

  // ── 5. A staircase room still has a figure ──────────────────────────────
  // calcRoom sees l=w=h=1 on an HSL room, so the drops have to be frozen at
  // save time beside the rolls — or the one room whose drops vary most
  // would be the one with no number.
  const hsl = await page.evaluate(() => {
    goScreen('room');
    setRoomStaircase(true);
    document.getElementById('hsl-h1-l').value = 3;
    document.getElementById('hsl-h1-w').value = 2;
    document.getElementById('hsl-h1-h').value = 2.4;
    setHSLFloors(2);
    document.getElementById('r-name').value = 'Hall, Stairs & Landing';
    wpWallFinish = true;
    calcHSLNow();
    var ov = computeHSLOverrides();
    var room = buildRoomFromForm();
    var c = calcRoom(room);
    return { override: ov.wallDropsOverrideFinish, rollsOverride: ov.wallRollsOverrideFinish,
             drops: c.wpwDrops, rolls: c.wpwRolls,
             lengths: buildLengthsValue([room]) };
  });
  check('a staircase freezes its drop count at save time',
    hsl.override > 0 && hsl.rollsOverride > 0, hsl);
  eq('and calcRoom reads it back rather than re-deriving from dummy dims',
    hsl.drops, hsl.override);
  eq('so a staircase job states its lengths', hsl.lengths, String(hsl.override));
  check('drops still outnumber rolls on the stairs', hsl.drops > hsl.rolls, hsl);

  // ── 6. What cannot be known is not invented ─────────────────────────────
  // A staircase room saved before the drops override existed: rolls on
  // record, drops absent. The marker comes back rather than a short total.
  const legacy = await page.evaluate(() => {
    var room = B({ id:'old', name:'Stairs', isHSL:true, l:1, w:1, h:1,
                   wpWallFinish:true, wallRollsOverrideFinish:6 });
    var c = calcRoom(room);
    return { drops: c.wpwDrops, rolls: c.wpwRolls,
             lengths: buildLengthsValue([room]),
             mixed: buildLengthsValue([room, B({ id:'n', name:'Lounge', wpWallFinish:true })]) };
  });
  eq('an unrecorded drop count reads as unknown, not zero', legacy.drops, null);
  eq('its rolls are still there, untouched', legacy.rolls, 6);
  eq('so the quote falls back to the marker', legacy.lengths, '[X]');
  eq('and one unknown room makes the whole job fall back, not go short',
    legacy.mixed, '[X]');

  // ── 7. End to end, through the real template ────────────────────────────
  const rendered = await page.evaluate(() => {
    rooms = [ B({ id:'w1', name:'Lounge', wpWallFinish:true }) ];
    jobs[0].templateId = 'wallpapering'; jobs[0].quoteText = null;
    var quote = currentQuoteText();
    jobs[0].templateId = 'paint-paper'; jobs[0].quoteText = null;
    var pp = currentQuoteText();
    // Nothing papered at all — the marker Nicky fills in by hand comes back.
    rooms = [ B({ id:'w2', name:'Lounge', wc:2, cc:2 }) ];
    jobs[0].templateId = 'wallpapering'; jobs[0].quoteText = null;
    var none = currentQuoteText();
    return { quote: quote, pp: pp, none: none,
             drops: calcRoom(B({ id:'w1', name:'Lounge', wpWallFinish:true })).wpwDrops };
  });
  check('the Wallpapering quote reads the real number',
    rendered.quote.includes(rendered.drops + ' lengths of [paper name/supplier] to be hung to the walls'),
    rendered.quote.split('\n').filter(function(l){ return /lengths/.test(l); }));
  check('so does Painting & Papering',
    rendered.pp.includes(rendered.drops + ' lengths of [paper name/supplier]'),
    rendered.pp.split('\n').filter(function(l){ return /lengths/.test(l); }));
  check('and a job with no paper keeps the [X] marker',
    /\[X\] lengths of/.test(rendered.none),
    rendered.none.split('\n').filter(function(l){ return /lengths/.test(l); }));
  check('no unresolved {lengths} token reaches a client document',
    !/\{lengths\}/.test(rendered.quote) && !/\{lengths\}/.test(rendered.pp) &&
    !/\{lengths\}/.test(rendered.none), rendered);

  check('nothing threw along the way', errors.length === 0, errors);

  await browser.close(); srv.close();
  console.log('\nWallpaper lengths\n');
  pass.forEach(n=>console.log('  ✓ '+n)); fail.forEach(n=>console.log('  ✗ '+n));
  console.log('\n'+pass.length+' passed, '+fail.length+' failed\n');
  process.exit(fail.length?1:0);
})();
