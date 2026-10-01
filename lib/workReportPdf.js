// The Windows and doors work report, as a PDF (WINDOWS_DOORS_INVOICE_SPEC.md
// section 2). Attached to the final Xero invoice, and downloadable from the
// job first so it can be checked before it goes.
//
// WHY PDFKIT (and not headless Chrome): the app runs on Render's Starter
// tier, where a Chromium process is ~150MB of memory for one page and a cold
// start of seconds. pdfkit is pure JavaScript, draws straight to PDF, embeds
// a TrueType font by subsetting it (so Barlow costs a few KB, not the whole
// face), and svg-to-pdfkit turns the module's own SVG drawings -- the very
// elevation and window drawings the app shows -- into vector paths, so the
// drawings are sharp at any zoom and a 20-opening report stays a few hundred
// KB, far under Xero's attachment limit. The drawings use only plain shapes
// and text (rect, path, polygon, polyline, circle, line, g, text), all of
// which svg-to-pdfkit draws.
//
// Pure: the caller (lib/windoors.js buildWorkReport) reads the rows and hands
// over the model; this turns it into bytes. No prices reach this file --
// Windoors.workReportModel carries none.

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const Windoors = require('../public/windoors');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONTS = {
  regular: path.join(FONT_DIR, 'Barlow-Regular.ttf'),
  semibold: path.join(FONT_DIR, 'Barlow-SemiBold.ttf'),
  bold: path.join(FONT_DIR, 'Barlow-Bold.ttf'),
};
const STOCK_LOGO = path.join(__dirname, '..', 'public', 'logo.png');

const C = {
  steel: '#1e6497', ink: '#1a1f2e', mut: '#5a6270', rule: '#dde2e8', panel: '#eef4f9',
  work: '#f0a020', glass: '#5fb3e6', siteInk: '#8a5300', siteBg: '#fdf1dc', siteLine: '#e0a23a',
};
const PAGE = { w: 595.28, h: 841.89, margin: 40 };
const L = PAGE.margin, R = PAGE.w - PAGE.margin, W = R - L;
const BOTTOM = PAGE.h - PAGE.margin - 22; // room for the footer

// The logo: an uploaded one (Settings > Business) when it is a PNG or JPEG
// pdfkit can draw, else the stock one.
function logoBuffer(dataUri) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUri || ''));
  if (m) {
    try { return Buffer.from(m[2], 'base64'); } catch (e) { /* fall through */ }
  }
  try { return fs.readFileSync(STOCK_LOGO); } catch (e) { return null; }
}

function viewBox(svg) {
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
  return vb ? { w: +vb[3], h: +vb[4] } : null;
}

// svg-to-pdfkit has no paint-order, so the opening numbers' white halo
// (paint-order="stroke": the stroke under the fill) would be drawn OVER the
// number and hide it. Split each such label into its halo, then its fill.
function forPdf(svg) {
  return svg.replace(/<text([^>]*?) paint-order="stroke"([^>]*)>([^<]*)<\/text>/g, (m, a, b, t) => {
    const attrs = a + b;
    const halo = attrs.replace(/ fill="[^"]*"/, '') + ' fill="none"';
    const fill = attrs.replace(/ stroke="[^"]*"/, '').replace(/ stroke-width="[^"]*"/, '');
    return '<text' + halo + '>' + t + '</text><text' + fill + '>' + t + '</text>';
  });
}

// Draw one of the module's SVGs into a box, keeping its shape. Returns the
// height actually used.
function drawSvg(doc, rawSvg, x, y, maxW, maxH) {
  const svg = forPdf(rawSvg);
  const vb = viewBox(svg);
  if (!vb) return 0;
  let w = maxW, h = maxW * vb.h / vb.w;
  if (h > maxH) { h = maxH; w = maxH * vb.w / vb.h; }
  const ox = x + (maxW - w) / 2;
  SVGtoPDF(doc, svg, ox, y, {
    width: w, height: h, preserveAspectRatio: 'xMidYMid meet', assumePt: false,
    fontCallback: (family, bold) => (bold ? 'Barlow-Bold' : 'Barlow'),
    warningCallback: () => {},
  });
  return h;
}

function fmtLongDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

// p: { model, data, businessName, logoDataUri, clientName, address, jobName,
//      completedAt, invoiceNumber, generatedAt }
// Resolves to a Buffer.
function renderWorkReportPdf(p) {
  const model = p.model;
  const data = p.data;
  const doc = new PDFDocument({
    size: 'A4', margin: PAGE.margin, bufferPages: true, autoFirstPage: true,
    info: {
      Title: 'Windows and doors work report' + (p.invoiceNumber ? ' ' + p.invoiceNumber : ''),
      Author: p.businessName || '', Subject: p.jobName || '',
    },
  });
  doc.registerFont('Barlow', FONTS.regular);
  doc.registerFont('Barlow-SemiBold', FONTS.semibold);
  doc.registerFont('Barlow-Bold', FONTS.bold);
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const text = (s, x, y, opts) => {
    const o = opts || {};
    doc.font(o.font || 'Barlow').fontSize(o.size || 10).fillColor(o.color || C.ink);
    doc.text(s, x, y, Object.assign({ lineBreak: o.width != null, width: o.width }, o.align ? { align: o.align } : {}));
  };
  const heightOf = (s, font, size, width) => doc.font(font).fontSize(size).heightOfString(s, { width });
  const need = (h) => { if (doc.y + h > BOTTOM) { doc.addPage(); doc.y = PAGE.margin; return true; } return false; };

  // ── Header ────────────────────────────────────────────────────────────────
  let y = PAGE.margin;
  const logo = logoBuffer(p.logoDataUri);
  let hx = L;
  if (logo) {
    try { doc.image(logo, L, y, { fit: [58, 52] }); hx = L + 70; } catch (e) { hx = L; }
  }
  text(p.businessName || '', hx, y + 2, { font: 'Barlow-Bold', size: 17, color: C.steel });
  text('Windows and doors: work report', hx, y + 24, { font: 'Barlow-SemiBold', size: 12.5 });
  // The right-hand column: which invoice, when.
  const facts = [];
  if (p.invoiceNumber) facts.push(['Invoice', p.invoiceNumber]);
  if (p.completedAt) facts.push(['Completed', fmtLongDate(p.completedAt)]);
  facts.push(['Report date', fmtLongDate(p.generatedAt || new Date().toISOString())]);
  facts.forEach((f, i) => {
    text(f[0].toUpperCase(), R - 200, y + 3.5 + i * 15, { font: 'Barlow-SemiBold', size: 7.5, color: C.mut });
    text(f[1], R - 130, y + i * 15, { size: 10, width: 130, align: 'right' });
  });
  y = PAGE.margin + 58;
  const who = [p.clientName, p.address].filter(Boolean);
  if (who.length) {
    text('PREPARED FOR', L, y, { font: 'Barlow-SemiBold', size: 7.5, color: C.mut });
    y += 11;
    text(who[0], L, y, { font: 'Barlow-SemiBold', size: 11 });
    y += 14;
    if (who[1]) { text(who[1], L, y, { size: 10, color: C.mut, width: W }); y += heightOf(who[1], 'Barlow', 10, W) + 2; }
  }
  y += 6;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.5).strokeColor(C.steel).stroke();
  y += 12;

  // ── Summary ───────────────────────────────────────────────────────────────
  const stats = [
    [String(model.counts.windows), model.counts.windows === 1 ? 'window' : 'windows'],
    [String(model.counts.doors), model.counts.doors === 1 ? 'door' : 'doors'],
    [String(model.onSiteOpenings), (model.onSiteOpenings === 1 ? 'opening' : 'openings') + ' with work found on site'],
  ];
  const gap = 10, bw = (W - gap * 2) / 3, bh = 50;
  stats.forEach((s, i) => {
    const bx = L + i * (bw + gap);
    doc.roundedRect(bx, y, bw, bh, 5).fillColor(i === 2 && model.onSiteOpenings ? C.siteBg : C.panel).fill();
    text(s[0], bx + 12, y + 7, { font: 'Barlow-Bold', size: 22, color: i === 2 && model.onSiteOpenings ? C.siteInk : C.steel });
    text(s[1], bx + 12, y + 33, { size: 9, color: C.mut, width: bw - 20 });
  });
  y += bh + 12;
  const note = 'Outside faces only. Openings are numbered left to right as you face each side of the house, as on the drawings. '
    + 'Each opening lists the work done to it. Work marked FOUND ON SITE was not in the quote: it was found once the work was under way, '
    + 'and agreed with you or covered by the quote terms. This is why the invoice total can be above the quoted figure.';
  text(note, L, y, { size: 9, color: C.mut, width: W });
  y += heightOf(note, 'Barlow', 9, W) + 6;
  // The drawing key.
  let kx = L;
  [[C.work, 'work done'], [C.glass, 'glass replaced']].forEach(k => {
    doc.rect(kx, y + 1.5, 12, 8).fillAndStroke(k[0], '#555555');
    text(k[1], kx + 16, y, { size: 8.5, color: C.mut });
    kx += 16 + doc.widthOfString(k[1]) + 16;
  });
  y += 18;
  doc.y = y;

  // ── Per side ──────────────────────────────────────────────────────────────
  const reportData = { property: data.property, openings: data.openings, marks: model.marks };
  const TAG = 'FOUND ON SITE';
  const tagW = () => doc.font('Barlow-Bold').fontSize(6.5).widthOfString(TAG) + 8;
  model.sides.forEach(side => {
    const secs = model.sections.filter(s => s.opening.side === side);
    const elev = Windoors.elevationSvg(reportData, side, { highlight: model.highlight, markers: false });
    const vb = viewBox(elev);
    let eh = vb ? Math.min(250, W * vb.h / vb.w) : 0;
    need(24 + eh + 20);
    y = doc.y;
    text(Windoors.sideLabel(side).toUpperCase(), L, y, { font: 'Barlow-Bold', size: 11, color: C.steel });
    const count = secs.filter(s => s.opening.kind !== 'bay').length;
    text(count + (count === 1 ? ' opening' : ' openings'), L, y + 1, { size: 9, color: C.mut, width: W, align: 'right' });
    y += 18;
    if (vb) y += drawSvg(doc, elev, L, y, W, eh) + 10;
    doc.y = y;

    secs.forEach(sec => {
      if (sec.standard) {
        // Nothing beyond the painting: a small drawing and one line.
        const line = sec.paint + '.';
        const tx = L + 34, tw = R - tx;
        const labelW = doc.font('Barlow-SemiBold').fontSize(9.5).widthOfString(sec.label + '  ');
        const h = Math.max(30, heightOf(sec.label + '  ' + line, 'Barlow', 9.5, tw) + 8);
        need(h + 2);
        y = doc.y;
        doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(C.rule).stroke();
        drawSvg(doc, Windoors.detailSvg(sec.opening, model.marks, { children: sec.children, property: data.property }), L, y + 3, 24, 26);
        text(sec.label, tx, y + 5, { font: 'Barlow-SemiBold', size: 9.5 });
        text(line, tx + labelW, y + 5, { size: 9.5, color: C.mut, width: tw - labelW });
        doc.y = y + h;
        return;
      }
      // Work beyond the standard: its own drawing, and a line per item.
      const tx = L + 100, tw = R - tx;
      const rows = [];
      rows.push({ t: sec.label, font: 'Barlow-Bold', size: 10.5, color: C.ink, gap: 0 });
      rows.push({ t: sec.what, font: 'Barlow', size: 8.5, color: C.mut, gap: 1 });
      sec.items.forEach((it, i) => rows.push({ t: it.text, font: 'Barlow', size: 9.5, color: C.ink, gap: i === 0 ? 5 : 2, item: true, onSite: it.onSite }));
      rows.push({ t: sec.paint + '.', font: 'Barlow', size: 9.5, color: C.ink, gap: 2, item: true });
      const ind = (r) => (r.item ? (r.onSite ? tagW() + 5 : 10) : 0);
      rows.forEach(r => { r.h = heightOf(r.t, r.font, r.size, tw - ind(r)); });
      const th = rows.reduce((h, r) => h + r.gap + r.h, 0);
      const dh = 104;
      const h = Math.max(dh, th) + 16;
      need(h);
      y = doc.y;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor(C.rule).stroke();
      if (sec.onSite) doc.rect(L, y + 1, 2.5, h - 2).fillColor(C.siteLine).fill();
      drawSvg(doc, Windoors.detailSvg(sec.opening, model.marks, { children: sec.children, property: data.property }), L + 8, y + 8, 80, dh - 8);
      let yy = y + 8;
      rows.forEach(r => {
        yy += r.gap;
        if (r.item) {
          if (r.onSite) {
            const tw2 = tagW();
            doc.roundedRect(tx, yy + 1, tw2, 10, 2.5).fillColor(C.siteBg).fill();
            doc.roundedRect(tx, yy + 1, tw2, 10, 2.5).lineWidth(0.6).strokeColor(C.siteLine).stroke();
            text(TAG, tx + 4, yy + 2.6, { font: 'Barlow-Bold', size: 6.5, color: C.siteInk });
          } else {
            doc.circle(tx + 3, yy + 6, 1.5).fillColor(C.mut).fill();
          }
        }
        text(r.t, tx + ind(r), yy, { font: r.font, size: r.size, color: r.color, width: tw - ind(r) });
        yy += r.h;
      });
      doc.y = y + h;
    });
    doc.y += 10;
  });

  // ── Footer on every page ──────────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const foot = [p.businessName, 'Windows and doors work report', p.invoiceNumber].filter(Boolean).join('  ·  ');
    // Written inside the bottom margin: switch it off so pdfkit doesn't
    // start a new page for it.
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    text(foot, L, PAGE.h - PAGE.margin + 8, { size: 8, color: C.mut, width: W - 80 });
    text('Page ' + (i + 1) + ' of ' + range.count, L, PAGE.h - PAGE.margin + 8, { size: 8, color: C.mut, width: W, align: 'right' });
    doc.page.margins.bottom = keep;
  }
  doc.end();
  return done;
}

module.exports = { renderWorkReportPdf, FONTS };
