'use strict';

// A Windows and doors job big enough to be real: a detached Georgian house,
// 22 openings over four sides (19 windows, 3 doors), with quoted work, a
// resin repair found bigger once exposed, and an approved site variation
// (glass, prep raised) -- plus a pending one and a declined one that the
// report must leave out. Shared by the invoice/report tests and the preview
// script, so they all look at the same house.

const W = require('../../public/windoors');

function build() {
  const appearance = Object.assign(W.periodDefaults('georgian'), { form: 'detached' });
  const layout = {
    front: { floors: [{ windows: 3, doors: 1 }, { windows: 4, doors: 0 }], confirmed: true },
    back: { floors: [{ windows: 3, doors: 1 }, { windows: 4, doors: 0 }], confirmed: true },
    left: { floors: [{ windows: 2, doors: 1 }], confirmed: true },
    right: { floors: [{ windows: 0, doors: 0 }, { windows: 3, doors: 0 }], confirmed: true },
  };
  const property = { style: 'georgian', appearance, detail_enabled: true, default_prep: 'light', layout, coats: 2,
                     window_colour: 1, door_colour: 2, paint_products: {} };
  const openings = [];
  Object.keys(layout).forEach(side => {
    layout[side].floors.forEach((f, floor) => {
      const slots = W.floorSlots(f.windows, f.doors, 0);
      let wn = 0, dn = 0;
      slots.forEach(kind => {
        const position = kind === 'door' ? ++dn : ++wn;
        openings.push(Object.assign({
          id: side[0] + floor + kind[0] + position, side, floor, level: 'standard', kind, position,
          nickname: null, parent_opening_id: null, panes_set: false, rows_bottom: null,
          prep_level: null, prep_stage: 'quote', quote_prep_level: null, prep_variation_id: null, prep_steps: [],
          access: null, excluded: false, include_variation_id: null,
        }, W.openingDefaults(appearance, kind, floor, 'standard')));
      });
    });
  });
  const byId = {};
  openings.forEach(o => { byId[o.id] = o; });
  // Front door: heavy prep on the quote.
  byId.f0d1.prep_level = 'heavy';
  // Back W2 ground: prep raised to standard on site, on the approved variation.
  Object.assign(byId.b0w2, { prep_level: 'standard', prep_stage: 'variation', quote_prep_level: 'light', prep_variation_id: 'var-approved' });
  const t = '2026-09-10T09:00:00.000Z';
  let n = 0;
  const mark = (opening_id, element_id, action_key, extra) => Object.assign({
    id: 'm' + (++n), opening_id, element_id, action_key, stage: 'quote', variation_id: null,
    created_at: t, done_at: t, size_tier: null, agreed_size_tier: null, upgraded_at: null, repair_count: null,
  }, extra || {});
  const marks = [
    // Quoted work, all done.
    mark('f1w2', 'cill', 'resin', { size_tier: 'medium', agreed_size_tier: 'medium' }),
    mark('f1w2', 'top-1', 'reputty'), mark('f1w2', 'top-2', 'reputty'), mark('f1w2', 'top-3', 'reputty'),
    mark('f0w1', 'bottom_rail', 'filler'),
    // Quoted Medium, found Large once cut out.
    mark('b1w3', 'cill', 'resin', { size_tier: 'large', agreed_size_tier: 'medium', upgraded_at: t }),
    // Approved site variation: replace two panes on the back door's neighbour.
    mark('b0w1', 'bottom-2', 'replace_glass', { stage: 'variation', variation_id: 'var-approved' }),
    mark('b0w1', 'bottom-3', 'replace_glass', { stage: 'variation', variation_id: 'var-approved' }),
    mark('l0d1', 'threshold', 'resin', { stage: 'variation', variation_id: 'var-approved', size_tier: 'small', agreed_size_tier: 'small' }),
    // Pending and declined variation work: never in the report.
    mark('r1w1', 'cill', 'splice', { stage: 'variation', variation_id: 'var-pending' }),
    mark('r1w2', 'cill', 'splice', { stage: 'variation', variation_id: 'var-declined' }),
    // Quoted but not ticked off yet.
    mark('f1w3', 'head', 'filler', { done_at: null }),
  ];
  const variations = [
    { id: 'var-approved', status: 'approved', approvedAt: '2026-09-12T10:00:00.000Z' },
    { id: 'var-pending', status: 'pending', approvedAt: null },
    { id: 'var-declined', status: 'declined', approvedAt: null },
  ];
  return { data: { property, openings, marks }, variations };
}

module.exports = { build };
