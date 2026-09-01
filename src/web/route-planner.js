'use strict';

const { config } = require('../config');

// ---------------------------------------------------------------------------
// Route and margin planner: what one van-load of stops actually earns.
//
// A model, not a report. Like the run-economics page it reads nothing from the
// database - every stop, every laundromat and every rate on it is an assumption
// Neil can drag around. The two pages answer different questions: economics
// asks "does the shape of a run work", this one asks "does THIS run work, with
// these stops in these places".
//
// Why a real map rather than the abstract grid the prototype used: the whole
// output of the page is a number of miles, and miles are a fact about roads.
// Drawn on a blank grid you cannot see that two stops are on opposite banks of
// the Passaic, or that a laundromat is the wrong side of Route 4. On real
// streets you can.
//
// Three outside services, none of which needs an account or a key:
//
//   Leaflet    the map library itself, pinned and checked with an integrity
//              hash so the file can never silently change under us
//   OpenStreetMap  the map tiles
//   OSRM       real driving distances between the stops
//
// OSRM is the load-bearing one and it is worth being straight about: it is a
// free public demo server with no guarantee behind it. When it answers, every
// mile on this page is a real driving mile. When it does not, the page falls
// back to straight-line distance times the road factor - the old estimate - and
// says on screen which of the two you are looking at. It never silently mixes
// them.
//
// This is the second page in /ops with client-side JavaScript, for the same
// reason as the first: it is a calculator, interactive is the point, and nobody
// is standing in a stairwell using it.
// ---------------------------------------------------------------------------

// Pinned, with the hashes computed from the files themselves. A CDN that
// changed the bytes under a pinned version would be refused by the browser
// rather than executed.
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_CSS_SRI = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_JS_SRI = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH';

function routePlannerHead() {
  return `  <link rel="stylesheet" href="${LEAFLET_CSS}" integrity="${LEAFLET_CSS_SRI}" crossorigin="anonymous">
  <script src="${LEAFLET_JS}" integrity="${LEAFLET_JS_SRI}" crossorigin="anonymous" defer></script>`;
}

// The seed run. Deliberately not named after real businesses: there is no
// signed partner and no agreed wholesale rate, so a page carrying plausible
// laundromat names would be read as a fact within a week. They are letters, and
// the note at the top says so.
const SEED = {
  base: { name: 'Base', lat: 40.9404, lng: -74.1182 },
  partners: [
    { id: 'p1', name: 'Laundromat A', lat: 40.933, lng: -74.121, perLb: 0.95, fee: 0 },
    { id: 'p2', name: 'Laundromat B', lat: 40.907, lng: -74.079, perLb: 0.82, fee: 0 },
    { id: 'p3', name: 'Laundromat C', lat: 40.9168, lng: -74.1718, perLb: 0.72, fee: 5 },
  ],
  orders: [
    { id: 'o1', name: 'Berdan Ave', lat: 40.949, lng: -74.13, lbs: 22, mode: 'both' },
    { id: 'o2', name: 'Maple Ave', lat: 40.928, lng: -74.105, lbs: 31, mode: 'both' },
    { id: 'o3', name: 'Glen Rock', lat: 40.956, lng: -74.112, lbs: 18, mode: 'both' },
    { id: 'o4', name: 'Plaza Rd N', lat: 40.935, lng: -74.142, lbs: 26, mode: 'both' },
    { id: 'o5', name: 'Elmwood Park', lat: 40.921, lng: -74.121, lbs: 40, mode: 'both' },
    { id: 'o6', name: 'Ridgewood', lat: 40.962, lng: -74.125, lbs: 24, mode: 'pickup' },
    { id: 'o7', name: 'Saddle River Rd', lat: 40.944, lng: -74.095, lbs: 29, mode: 'both' },
  ],
};

function routePlannerBody() {
  // The retail rate and the minimum are LYNDRY's, read from config, so the
  // model opens on what we actually charge. Everything else on the Rates tab is
  // an assumption with no home in the codebase, and lives here.
  const settings = {
    wage: 20,
    gas: 3.4,
    mpg: 22,
    wear: 0.18,
    speed: 24,
    circuity: 1.3,
    stopMin: 4,
    partnerMin: 10,
    retail: config.pricing.perPoundCents / 100,
    minCharge: config.pricing.minimumCents / 100,
    stripePct: 2.9,
    stripeFlat: 0.3,
  };

  const seed = JSON.stringify({ ...SEED, settings });

  return `
<style>
  /* Page-scoped. Grid ratios are classes, never inline grid-template-columns -
     an inline style beats the media query and the page then refuses to collapse
     on a phone. */
  .rp-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 460px); gap: 24px; align-items: start; }
  .rp-rates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
  @media (max-width: 1000px) { .rp-split { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 460px) { .rp-rates { grid-template-columns: minmax(0, 1fr); } }

  /* Headline figures. One strip of outlined cards, hard shadow, ink on paper. */
  .rp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 28px 0; }
  .rp-stat { background: var(--paper-050); border: 2px solid var(--ink-900); border-radius: 14px;
    box-shadow: var(--shadow-pop-sm); padding: 16px 18px; }
  .rp-stat .rp-k { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--ink-500); font-weight: 700; }
  .rp-stat .rp-v { font-family: var(--font-display); font-weight: 900; font-size: 30px; line-height: 1.1;
    margin-top: 6px; font-variant-numeric: tabular-nums; }
  /* A run that loses money says so in Stain, on a Stain shadow. A negative
     number you have to read to notice is a number that gets missed. */
  .rp-stat.rp-bad { background: var(--stain-500); box-shadow: 6px 6px 0 var(--ink-900); }
  .rp-stat.rp-bad .rp-k, .rp-stat.rp-bad .rp-v { color: var(--paper-050); }
  .rp-stat.rp-warn .rp-v { color: var(--ink-900); }
  .rp-stat.rp-warn { background: var(--sunbeam-500); }

  /* The run as a line of stops, in the order the van drives them. */
  .rp-ribbon { overflow-x: auto; background: var(--paper-050); border: 2px solid var(--ink-900);
    border-radius: 14px; box-shadow: var(--shadow-pop-sm); padding: 18px 20px; }
  .rp-ribbon-inner { display: flex; align-items: flex-start; min-width: min-content; }
  .rp-node { text-align: center; min-width: 84px; }
  .rp-node .rp-dot { width: 26px; height: 26px; margin: 0 auto 8px; border: 2px solid var(--ink-900);
    display: flex; align-items: center; justify-content: center; font-family: var(--font-mono);
    font-size: 12px; font-weight: 700; color: var(--ink-900); }
  .rp-node .rp-dot.stop { border-radius: 50%; background: var(--suds-500); }
  .rp-node .rp-dot.partner { border-radius: 5px; background: var(--sunbeam-500); }
  .rp-node .rp-dot.base { border-radius: 5px; background: var(--lilac-500); }
  .rp-node .rp-nm { font-size: 12px; font-weight: 700; white-space: nowrap; line-height: 1.3; }
  .rp-node .rp-sub { font-family: var(--font-mono); font-size: 10px; color: var(--ink-500); margin-top: 2px; white-space: nowrap; }
  .rp-link { width: 30px; height: 2px; background: var(--ink-900); margin-top: 12px; flex-shrink: 0; }

  /* Map. Ink outline like every other surface; the tiles are warmed with a
     filter so real streets sit on cream instead of looking pasted on. */
  #rp-map { height: 520px; border-radius: 12px; border: 2px solid var(--ink-900);
    background: var(--paper-100); z-index: 0; }
  #rp-map .leaflet-tile-pane { filter: sepia(0.24) saturate(0.78) contrast(1.04); }
  #rp-map .leaflet-container { background: var(--paper-100); font-family: var(--font-body); }
  @media (max-width: 700px) { #rp-map { height: 380px; } }

  .rp-mk { display: flex; align-items: center; justify-content: center; border: 2px solid var(--ink-900);
    font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--ink-900);
    box-shadow: var(--shadow-pop-xs); cursor: grab; }
  .rp-mk.stop { width: 28px; height: 28px; border-radius: 50%; background: var(--suds-500); }
  .rp-mk.stop.rp-dropoff { background: var(--paper-000); }
  .rp-mk.partner { width: 26px; height: 26px; border-radius: 5px; background: var(--sunbeam-500); }
  .rp-mk.partner.rp-unused { background: var(--paper-200); color: var(--ink-500); }
  .rp-mk.base { width: 26px; height: 26px; border-radius: 5px; background: var(--lilac-500); }

  .leaflet-tooltip.rp-tip { background: var(--paper-050); border: 2px solid var(--ink-900);
    border-radius: 7px; box-shadow: var(--shadow-pop-xs); font-family: var(--font-mono);
    font-size: 11px; font-weight: 700; color: var(--ink-900); padding: 3px 7px; }
  .leaflet-tooltip.rp-tip::before { display: none; }
  /* Leaflet's own furniture, brought into the system rather than left default. */
  .leaflet-control-zoom a { border: 2px solid var(--ink-900) !important; background: var(--paper-050) !important;
    color: var(--ink-900) !important; font-weight: 700; }
  .leaflet-control-attribution { background: var(--paper-050) !important; font-size: 10px !important;
    border-top: 2px solid var(--ink-900); border-left: 2px solid var(--ink-900); }
  .leaflet-control-attribution a { color: var(--ink-700) !important; }

  .rp-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
  .rp-search { display: flex; gap: 8px; flex: 1 1 260px; min-width: 0; margin: 0; }
  .rp-search input { flex: 1 1 auto; min-width: 0; height: 36px; background: var(--paper-000);
    border: 2px solid var(--ink-900); border-radius: 8px; padding: 0 10px;
    font-family: var(--font-body); font-size: 14px; color: var(--ink-900); outline: none; }
  .rp-search input:focus-visible { box-shadow: 0 0 0 4px var(--lilac-300); }

  /* Tabs on the rail. */
  .rp-tabs { display: flex; gap: 4px; border-bottom: 2px solid var(--ink-900); margin-bottom: 18px; }
  .rp-tabs button { background: none; border: 0; border-bottom: 3px solid transparent; margin-bottom: -2px;
    font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
    font-weight: 700; color: var(--ink-500); padding: 9px 10px; cursor: pointer; }
  .rp-tabs button[aria-selected="true"] { color: var(--ink-900); border-bottom-color: var(--suds-500); }
  .rp-tabs button:focus-visible { box-shadow: 0 0 0 4px var(--lilac-300); border-radius: 6px; }

  table.rp-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.rp-tbl th { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--ink-500); font-weight: 700; text-align: left;
    padding: 0 6px 8px 0; }
  table.rp-tbl th.r, table.rp-tbl td.r { text-align: right; }
  table.rp-tbl td { padding: 6px 6px 6px 0; vertical-align: middle; border-top: 1px solid var(--ink-100); }
  table.rp-tbl .num { font-family: var(--font-mono); font-weight: 700; font-variant-numeric: tabular-nums; }
  table.rp-tbl input, table.rp-tbl select { width: 100%; min-width: 0; height: 34px; background: var(--paper-000);
    border: 2px solid var(--ink-900); border-radius: 7px; padding: 0 7px; color: var(--ink-900);
    font-family: var(--font-body); font-size: 13px; outline: none; }
  table.rp-tbl input[type=number] { font-family: var(--font-mono); font-weight: 700; text-align: right; }
  table.rp-tbl input:focus-visible, table.rp-tbl select:focus-visible { box-shadow: 0 0 0 4px var(--lilac-300); }
  .rp-del { background: none; border: 0; color: var(--ink-400); font-size: 20px; line-height: 1;
    padding: 2px 4px; cursor: pointer; }
  .rp-del:hover { color: var(--stain-500); }

  .rp-good { color: var(--suds-700); }
  .rp-mid { color: var(--sunbeam-600); }
  .rp-loss { color: var(--stain-500); }

  .rp-cost-row { margin-bottom: 13px; }
  .rp-cost-row .rp-cost-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; gap: 12px; }
  .rp-cost-row .rp-track { height: 12px; border: 2px solid var(--ink-900); border-radius: 6px;
    background: var(--paper-000); margin-top: 5px; overflow: hidden; }
  .rp-cost-row .rp-fill { height: 100%; }

  dl.rp-facts { display: grid; grid-template-columns: 1fr auto; gap: 8px 16px; margin: 0; font-size: 13px; }
  dl.rp-facts dt { color: var(--ink-500); }
  dl.rp-facts dd { margin: 0; text-align: right; font-family: var(--font-mono); font-weight: 700;
    font-variant-numeric: tabular-nums; }

  .rp-field label { display: block; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--ink-500); font-weight: 700; margin-bottom: 5px; }
  .rp-field input { width: 100%; height: 36px; background: var(--paper-000); border: 2px solid var(--ink-900);
    border-radius: 8px; padding: 0 9px; font-family: var(--font-mono); font-weight: 700; font-size: 14px;
    color: var(--ink-900); text-align: right; outline: none; }
  .rp-field input:focus-visible { box-shadow: 0 0 0 4px var(--lilac-300); }
  .rp-field.rp-dim input { background: var(--paper-200); color: var(--ink-500); }

  .rp-note { font-size: 13px; color: var(--ink-500); line-height: 1.5; }
  .rp-badge { display: inline-flex; align-items: center; gap: 7px; border: 2px solid var(--ink-900);
    border-radius: 999px; padding: 4px 12px; font-family: var(--font-mono); font-size: 11px;
    font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: var(--paper-050); }
  .rp-badge .rp-led { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--ink-900); }
</style>

<div style="max-width:720px;">
  <p class="eyebrow" style="margin:0 0 8px;">Planning</p>
  <h1 style="margin:0 0 14px;font-size:44px;line-height:1.05;">Route and margin planner</h1>
  <p style="font-size:17px;line-height:1.6;color:var(--ink-700);margin:0;">
    One van, one load of stops. Drag the pins, change the weights, and watch what
    the run earns. Nothing on this page is a real order or a real laundromat -
    the stops are examples and the laundromats are letters, because no partner is
    signed and no wholesale rate is agreed. The numbers you type are the model.
  </p>
</div>

<div class="rp-stats" id="rp-stats"></div>

<div class="rp-ribbon" style="margin-bottom:24px;">
  <div class="rp-ribbon-inner" id="rp-ribbon"></div>
</div>

<div class="rp-split">
  <div class="card" style="padding:22px;">
    <div class="rp-toolbar">
      <button type="button" class="btn btn-outline btn-sm" id="rp-add-stop">Add a stop</button>
      <button type="button" class="btn btn-outline btn-sm" id="rp-add-partner">Add a laundromat</button>
      <form class="rp-search" id="rp-search">
        <input type="search" id="rp-q" placeholder="Find an address" aria-label="Find an address">
        <button type="submit" class="btn btn-sm">Find</button>
      </form>
    </div>

    <div id="rp-map"></div>

    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-top:14px;">
      <p class="rp-note" style="margin:0;" id="rp-hint">Drag any pin to move it.</p>
      <span class="rp-badge" id="rp-src"><span class="rp-led" style="background:var(--paper-300);"></span><span id="rp-src-t">Measuring</span></span>
    </div>
    <p class="rp-note" style="margin:10px 0 0;" id="rp-src-note"></p>
  </div>

  <div class="card" style="padding:22px;">
    <div class="rp-tabs" role="tablist">
      <button type="button" role="tab" data-tab="stops" aria-selected="true">Stops</button>
      <button type="button" role="tab" data-tab="partners" aria-selected="false">Laundromats</button>
      <button type="button" role="tab" data-tab="cost" aria-selected="false">Cost</button>
      <button type="button" role="tab" data-tab="rates" aria-selected="false">Rates</button>
    </div>
    <div id="rp-panel"></div>
  </div>
</div>

<noscript>
  <div class="card" style="padding:22px;margin-top:24px;">
    <p style="margin:0;">This page is a calculator and needs JavaScript. Every other ops
    screen works without it.</p>
  </div>
</noscript>

<script>
(function () {
  'use strict';

  var seed = ${seed};
  var BASE = seed.base;
  var PARTNERS = seed.partners.slice();
  var ORDERS = seed.orders.slice();
  var S = seed.settings;

  var el = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var money = function (n) {
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var money0 = function (n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(0); };

  // -- geography ----------------------------------------------------------
  // Straight-line miles. Only used when OSRM has not answered.
  var R_MI = 3958.8;
  var rad = function (d) { return (d * Math.PI) / 180; };
  function haversine(a, b) {
    var dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    var s = Math.pow(Math.sin(dLat / 2), 2) +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R_MI * Math.asin(Math.sqrt(s));
  }

  // The road distance matrix, when we have one. Every point on the map gets an
  // index; MATRIX.d[i][j] is the driving distance in miles between them.
  var MATRIX = { ok: false, key: '', d: null };

  function dist(a, b) {
    if (MATRIX.ok && a._i != null && b._i != null) {
      var v = MATRIX.d[a._i][b._i];
      if (v != null && isFinite(v)) return v;
    }
    return haversine(a, b) * S.circuity;
  }

  // -- the route ----------------------------------------------------------
  // Open path with a fixed start and end: nearest neighbour to get a sequence,
  // then 2-opt to untangle it. Not optimal, but for a dozen stops it lands on
  // the same answer a person would after staring at the map for a while.
  function solveOpenPath(start, end, nodes) {
    if (!nodes.length) return { order: [], miles: dist(start, end) };
    var rem = nodes.slice(), order = [], cur = start;
    while (rem.length) {
      var bi = 0, bd = Infinity;
      for (var i = 0; i < rem.length; i++) {
        var d = dist(cur, rem[i]);
        if (d < bd) { bd = d; bi = i; }
      }
      cur = rem[bi]; order.push(cur); rem.splice(bi, 1);
    }
    var total = function (o) {
      var t = 0, p = start;
      for (var k = 0; k < o.length; k++) { t += dist(p, o[k]); p = o[k]; }
      return t + dist(p, end);
    };
    var best = total(order), improved = true, guard = 0;
    while (improved && guard++ < 60) {
      improved = false;
      for (var x = 0; x < order.length - 1; x++) {
        for (var y = x + 1; y < order.length; y++) {
          var cand = order.slice(0, x)
            .concat(order.slice(x, y + 1).reverse())
            .concat(order.slice(y + 1));
          var t2 = total(cand);
          if (t2 < best - 1e-9) { best = t2; order = cand; improved = true; }
        }
      }
    }
    return { order: order, miles: best };
  }

  // -- the model ----------------------------------------------------------
  // Unchanged from Neil's own arithmetic. The run is three legs: swing past the
  // laundromats holding finished work, drive the customer loop, drop the dirty
  // on the way home.
  function planRun(orders, partners, base) {
    if (!partners.length || !orders.length) return null;
    var P = function (id) {
      for (var i = 0; i < partners.length; i++) if (partners[i].id === id) return partners[i];
      return null;
    };
    var perMile = S.gas / S.mpg + S.wear + S.wage / S.speed;

    function build(assign) {
      var dirty = orders.filter(function (o) { return o.mode !== 'delivery'; });
      var clean = orders.filter(function (o) { return o.mode !== 'pickup'; });
      var uniq = function (a) {
        var out = [];
        a.forEach(function (v) { if (v && out.indexOf(v) < 0) out.push(v); });
        return out;
      };
      var collectIds = uniq(clean.map(function (o) { return assign[o.id]; }));
      var dropIds = uniq(dirty.map(function (o) { return assign[o.id]; }));

      var cur = base, rem = collectIds.slice(), collectSeq = [], leg1 = 0;
      while (rem.length) {
        var bi = 0, bd = Infinity;
        for (var i = 0; i < rem.length; i++) {
          var d = dist(cur, P(rem[i]));
          if (d < bd) { bd = d; bi = i; }
        }
        leg1 += bd; cur = P(rem[bi]); collectSeq.push(rem[bi]); rem.splice(bi, 1);
      }
      var legStart = collectSeq.length ? P(collectSeq[collectSeq.length - 1]) : base;

      var anchors = dropIds.length ? dropIds : [null];
      var best = null;
      anchors.forEach(function (anchorId) {
        var endPt = anchorId ? P(anchorId) : base;
        var path = solveOpenPath(legStart, endPt, orders);
        var seq3 = [], m3 = 0, c3 = endPt;
        var r3 = dropIds.filter(function (id) { return id !== anchorId; });
        if (anchorId) seq3.push(anchorId);
        while (r3.length) {
          var bj = 0, bdd = Infinity;
          for (var j = 0; j < r3.length; j++) {
            var dd = dist(c3, P(r3[j]));
            if (dd < bdd) { bdd = dd; bj = j; }
          }
          m3 += bdd; c3 = P(r3[bj]); seq3.push(r3[bj]); r3.splice(bj, 1);
        }
        m3 += dist(c3, base);
        var miles = leg1 + path.miles + m3;
        if (!best || miles < best.miles) {
          best = { miles: miles, path: path.order, seq3: seq3, collectSeq: collectSeq };
        }
      });

      var partnerStops = best.collectSeq.length + best.seq3.length;
      var driveMin = (best.miles / S.speed) * 60;
      var svcMin = orders.length * S.stopMin + partnerStops * S.partnerMin;
      var timeMin = driveMin + svcMin;

      var labor = (timeMin / 60) * S.wage;
      var fuel = (best.miles / S.mpg) * S.gas;
      var wear = best.miles * S.wear;
      var wash = 0;
      dirty.forEach(function (o) {
        var p = P(assign[o.id]);
        wash += o.lbs * p.perLb + (p.fee || 0);
      });
      var revenue = dirty.reduce(function (t, o) {
        return t + Math.max(S.minCharge, o.lbs * S.retail);
      }, 0);
      var proc = revenue * (S.stripePct / 100) + dirty.length * S.stripeFlat;
      var cost = labor + fuel + wear + wash + proc;

      return {
        assign: assign, miles: best.miles, timeMin: timeMin, driveMin: driveMin, svcMin: svcMin,
        labor: labor, fuel: fuel, wear: wear, wash: wash, proc: proc, cost: cost,
        revenue: revenue, margin: revenue - cost, route: best,
        dirty: dirty, clean: clean, perMile: perMile,
      };
    }

    // Candidate plans: everything to one laundromat, or each bag to whichever
    // is cheapest once the drive to reach it is counted.
    var cands = [];
    partners.forEach(function (p) {
      var a = {};
      orders.forEach(function (o) { a[o.id] = p.id; });
      cands.push(a);
    });
    if (partners.length > 1) {
      var mixed = {};
      orders.forEach(function (o) {
        var bid = null, bv = Infinity;
        partners.forEach(function (p) {
          var v = o.lbs * p.perLb + (p.fee || 0) + dist(o, p) * perMile * 0.6;
          if (v < bv) { bv = v; bid = p.id; }
        });
        mixed[o.id] = bid;
      });
      cands.push(mixed);
    }

    var winner = null, byPartner = [];
    cands.forEach(function (a, i) {
      var r = build(a);
      if (i < partners.length) byPartner.push({ partner: partners[i], run: r });
      if (!winner || r.cost < winner.cost) winner = r;
    });
    winner.byPartner = byPartner;
    return winner;
  }

  // Index every point so the distance matrix can be looked up by position.
  function reindex() {
    var pts = [BASE].concat(PARTNERS, ORDERS);
    pts.forEach(function (p, i) { p._i = i; });
    return pts;
  }

  var RUN = null, CONTRIB = {};
  function recompute() {
    reindex();
    RUN = planRun(ORDERS, PARTNERS, BASE);
    CONTRIB = {};
    // Leave-one-out: what the run's margin changes by without each stop. The
    // honest cost of serving it, detour included.
    if (RUN && ORDERS.length > 1) {
      ORDERS.forEach(function (o) {
        var without = planRun(ORDERS.filter(function (x) { return x.id !== o.id; }), PARTNERS, BASE);
        CONTRIB[o.id] = RUN.margin - (without ? without.margin : 0);
      });
    }
  }

  // -- the map ------------------------------------------------------------
  var map = null, layerRoute = null, markers = {};

  function initMap() {
    if (!window.L) {
      el('rp-map').innerHTML =
        '<div style="padding:28px;font-size:15px;line-height:1.6;">The map library did not load. ' +
        'It comes from the internet the first time this page opens - check the connection and reload. ' +
        'Every number on the page still works.</div>';
      return;
    }
    map = L.map('rp-map', { zoomControl: true, scrollWheelZoom: true });
    // OPENSTREETMAP'S OWN TILES, NOT CARTO'S.
    //
    // CARTO used to serve these without a key. They now stamp API KEY REQUIRED
    // across every tile for unkeyed use, which is what put that watermark over
    // the whole map. OSM's own tiles are genuinely keyless and their usage
    // policy is comfortable at the volume of one person planning a round.
    //
    // No {s} subdomain: OSM asked people to stop using a.b.c prefixes, and a
    // single host is what they document now.
    //
    // No detectRetina either - it doubles the tile requests for a map that is
    // already legible, and being a light user is the whole basis on which we
    // are allowed to use these.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    layerRoute = L.layerGroup().addTo(map);

    map.on('click', function (e) {
      if (!addMode) return;
      place(addMode, e.latlng.lat, e.latlng.lng, null);
      setAddMode(null);
    });

    // Leaflet works out the zoom from the size of its container, and on first
    // paint that size is not settled yet - fitting immediately lands two zoom
    // levels too far out. Measure again on the next frame, then fit.
    // setTimeout rather than requestAnimationFrame: a frame callback does not
    // run at all in a tab that is not being painted, and the map would then
    // open at the wrong zoom the moment somebody switched back to it.
    setTimeout(function () {
      map.invalidateSize();
      fitAll();
    }, 0);
  }

  function fitAll() {
    if (!map) return;
    var pts = [BASE].concat(PARTNERS, ORDERS).map(function (p) { return [p.lat, p.lng]; });
    // Extra room on the right: the laundromat labels hang off that side of
    // their pin, and a pin fitted exactly to the edge puts its own name
    // outside the map.
    if (pts.length) {
      map.fitBounds(L.latLngBounds(pts), {
        paddingTopLeft: [36, 36],
        paddingBottomRight: [120, 40],
      });
    }
  }

  function markerIcon(cls, label) {
    return L.divIcon({
      className: '',
      html: '<div class="rp-mk ' + cls + '">' + label + '</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  function drawMap() {
    if (!map || !RUN) return;

    // Visit order, so the numbers on the pins are the order the van drives.
    var seqOf = {};
    RUN.route.path.forEach(function (o, i) { seqOf[o.id] = i + 1; });
    var used = {};
    Object.keys(RUN.assign).forEach(function (k) { used[RUN.assign[k]] = true; });

    var wanted = {};
    var place = function (key, point, cls, label, tip, permanent, onMove) {
      wanted[key] = true;
      var m = markers[key];
      if (!m) {
        m = L.marker([point.lat, point.lng], { draggable: true, icon: markerIcon(cls, label) });
        m.on('dragend', function () {
          var ll = m.getLatLng();
          onMove(ll.lat, ll.lng);
          changed(false);
        });
        m.addTo(map);
        markers[key] = m;
      } else {
        m.setLatLng([point.lat, point.lng]);
        m.setIcon(markerIcon(cls, label));
      }
      m.unbindTooltip();
      if (tip) {
        m.bindTooltip(tip, {
          className: 'rp-tip', direction: 'right', offset: [16, 0], permanent: !!permanent,
        });
      }
    };

    // Base and the laundromats carry their names on the map: there are a
    // handful of them and knowing which is which is the point. Customer stops
    // do not - a dozen permanent labels on a street map is a pile of white
    // boxes and no map. They carry their position in the run instead, which is
    // the thing you actually read off a route, and the name on hover.
    place('base', BASE, 'base', '', 'Base', true,
      function (lat, lng) { BASE.lat = lat; BASE.lng = lng; });
    PARTNERS.forEach(function (p) {
      place('p:' + p.id, p, 'partner' + (used[p.id] ? '' : ' rp-unused'), '',
        p.name + '  $' + Number(p.perLb).toFixed(2), true,
        function (lat, lng) { p.lat = lat; p.lng = lng; });
    });
    ORDERS.forEach(function (o) {
      place('o:' + o.id, o, 'stop' + (o.mode === 'delivery' ? ' rp-dropoff' : ''),
        String(seqOf[o.id] || ''), o.name + '  ' + o.lbs + ' lb', false,
        function (lat, lng) { o.lat = lat; o.lng = lng; });
    });

    Object.keys(markers).forEach(function (k) {
      if (!wanted[k]) { map.removeLayer(markers[k]); delete markers[k]; }
    });

    drawLine(ROAD_GEOM);
  }

  // The line itself. Ink underneath, Suds on top - an outlined line, the same
  // way everything else on the site is an outlined shape.
  function drawLine(geom) {
    if (!map || !layerRoute) return;

    // CLEAR FIRST, AND CLEAR EVEN WHEN THERE IS NOTHING TO DRAW.
    //
    // This returned early when RUN was null, which left the PREVIOUS run's line
    // painted on the map. Delete the last stop and the panel correctly said
    // "add at least one" while the map still showed a route through stops that
    // no longer existed - the two halves of the page disagreeing about what was
    // on it, which is exactly the confusion Neil reported.
    layerRoute.clearLayers();
    if (!RUN) return;
    var pts = geom && geom.length ? geom : orderedPoints().map(function (p) { return [p.lat, p.lng]; });
    if (pts.length < 2) return;
    L.polyline(pts, { color: '#101210', weight: 7, opacity: 1, lineJoin: 'round' }).addTo(layerRoute);
    L.polyline(pts, { color: '#0EA47A', weight: 3, opacity: 1, lineJoin: 'round' }).addTo(layerRoute);
  }

  // The run in order: base, laundromats holding finished work, the customer
  // loop, the laundromats taking today's bags, base again.
  function orderedPoints() {
    if (!RUN) return [];
    var P = function (id) {
      for (var i = 0; i < PARTNERS.length; i++) if (PARTNERS[i].id === id) return PARTNERS[i];
      return null;
    };
    var out = [BASE];
    RUN.route.collectSeq.forEach(function (id) { out.push(P(id)); });
    RUN.route.path.forEach(function (o) { out.push(o); });
    RUN.route.seq3.forEach(function (id) { out.push(P(id)); });
    out.push(BASE);
    return out.filter(Boolean);
  }

  // -- real roads ---------------------------------------------------------
  // OSRM, in two steps. The table gives every distance between every point so
  // the planner can choose a sequence on real driving miles; the route then
  // draws the chosen sequence along the actual streets.
  //
  // It is a free public demo server with no promise attached. Everything below
  // is written so that a failure is a downgrade, not a broken page.
  var OSRM = 'https://router.project-osrm.org';
  var ROAD_GEOM = null;
  var roadTimer = null;

  function coordsOf(pts) {
    return pts.map(function (p) { return p.lng.toFixed(5) + ',' + p.lat.toFixed(5); }).join(';');
  }

  function ask(url) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, 8000);
    return fetch(url, { signal: ctl.signal })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) { clearTimeout(t); return j; })
      .catch(function (e) { clearTimeout(t); throw e; });
  }

  function setSource(state, text, note) {
    var led = el('rp-src').firstElementChild;
    led.style.background = state === 'road' ? 'var(--suds-500)'
      : state === 'straight' ? 'var(--sunbeam-500)' : 'var(--paper-300)';
    el('rp-src-t').textContent = text;
    el('rp-src-note').textContent = note;
  }

  function refreshRoads() {
    var pts = reindex();
    var key = coordsOf(pts);
    if (key === MATRIX.key && ROAD_GEOM) return;

    setSource('pending', 'Measuring', 'Asking for real driving distances.');
    ask(OSRM + '/table/v1/driving/' + key + '?annotations=distance')
      .then(function (j) {
        if (!j || !j.distances) throw new Error('no matrix');
        MATRIX = {
          ok: true,
          key: key,
          // Metres in, miles out.
          d: j.distances.map(function (row) {
            return row.map(function (m) { return m == null ? null : m / 1609.344; });
          }),
        };
        recompute();
        render();
        return ask(OSRM + '/route/v1/driving/' + coordsOf(orderedPoints()) +
          '?overview=full&geometries=geojson');
      })
      .then(function (j) {
        if (!j || !j.routes || !j.routes.length) throw new Error('no route');
        ROAD_GEOM = j.routes[0].geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
        drawLine(ROAD_GEOM);
        setSource('road', 'Real roads',
          'Distances are actual driving miles from OSRM, a free public routing service. ' +
          'Road factor is ignored while this is on.');
      })
      .catch(function () {
        MATRIX = { ok: false, key: '', d: null };
        ROAD_GEOM = null;
        recompute();
        render();
        setSource('straight', 'Straight line',
          'The routing service did not answer, so distances are straight-line times the ' +
          'road factor on the Rates tab. Treat the miles as an estimate.');
      });
  }

  function scheduleRoads() {
    clearTimeout(roadTimer);
    roadTimer = setTimeout(refreshRoads, 700);
  }

  // -- rendering ----------------------------------------------------------
  function statCard(k, v, tone) {
    return '<div class="rp-stat' + (tone ? ' ' + tone : '') + '">' +
      '<div class="rp-k">' + esc(k) + '</div>' +
      '<div class="rp-v">' + esc(v) + '</div></div>';
  }

  function renderStats() {
    if (!RUN) { el('rp-stats').innerHTML = ''; return; }
    var tone = RUN.margin <= 0 ? 'rp-bad'
      : RUN.margin / Math.max(RUN.revenue, 1) < 0.2 ? 'rp-warn' : '';
    el('rp-stats').innerHTML =
      statCard('Revenue this run', money(RUN.revenue), '') +
      statCard('Total cost', money(RUN.cost), '') +
      statCard('Margin', money(RUN.margin), tone) +
      statCard('Margin per driver-hour', money(RUN.margin / (RUN.timeMin / 60)), tone) +
      statCard('Run length', RUN.miles.toFixed(1) + ' mi, ' + Math.round(RUN.timeMin) + ' min', '') +
      statCard('Cost of a mile', money(RUN.perMile), '');
  }

  function renderRibbon() {
    if (!RUN) { el('rp-ribbon').innerHTML = ''; return; }
    var P = function (id) {
      for (var i = 0; i < PARTNERS.length; i++) if (PARTNERS[i].id === id) return PARTNERS[i];
      return null;
    };
    var nodes = [{ cls: 'base', label: '', name: 'Base', sub: '' }];
    RUN.route.collectSeq.forEach(function (id) {
      nodes.push({ cls: 'partner', label: '', name: P(id).name, sub: 'collect clean' });
    });
    RUN.route.path.forEach(function (o, i) {
      nodes.push({ cls: 'stop', label: String(i + 1), name: o.name, sub: o.lbs + ' lb' });
    });
    RUN.route.seq3.forEach(function (id) {
      nodes.push({ cls: 'partner', label: '', name: P(id).name, sub: 'drop dirty' });
    });
    nodes.push({ cls: 'base', label: '', name: 'Base', sub: '' });

    el('rp-ribbon').innerHTML = nodes.map(function (n, i) {
      return (i ? '<div class="rp-link"></div>' : '') +
        '<div class="rp-node">' +
        '<div class="rp-dot ' + n.cls + '">' + esc(n.label) + '</div>' +
        '<div class="rp-nm">' + esc(n.name) + '</div>' +
        '<div class="rp-sub">' + esc(n.sub) + '</div></div>';
    }).join('');
  }

  var tab = 'stops';

  function renderPanel() {
    var h = '';
    if (!RUN) {
      // SAY WHICH ONE IS MISSING. "Add at least one stop and one laundromat"
      // was printed even when there were three laundromats on the map, which
      // reads as the page not knowing what is on it.
      var need = [];
      if (!ORDERS.length) need.push('a stop');
      if (!PARTNERS.length) need.push('a laundromat');

      el('rp-panel').innerHTML =
        '<p class="rp-note">Add ' + (need.length ? need.join(' and ') : 'a stop') +
        ' to see what the run earns.</p>';
      return;
    }

    if (tab === 'stops') {
      h += '<p class="rp-note" style="margin:0 0 16px;"><b style="color:var(--ink-900);">Worth it</b> ' +
        'is how much the run\\'s margin changes if you drop that stop - what serving it really ' +
        'costs, detour included. At or below zero, the stop is losing money at today\\'s minimum.</p>';
      // No Bill column: it is weight times the rate, floored at the minimum,
      // and both of those are already on the row. The column that earns its
      // width is the one you cannot work out in your head.
      h += '<table class="rp-tbl"><thead><tr><th>Stop</th><th style="width:58px;">Lb</th>' +
        '<th style="width:92px;">Type</th><th class="r">Worth it</th>' +
        '<th style="width:24px;"></th></tr></thead><tbody>';
      ORDERS.forEach(function (o) {
        h += '<tr>' +
          '<td><input value="' + esc(o.name) + '" data-set="order-name" data-id="' + o.id + '"></td>' +
          '<td><input type="number" min="0" value="' + o.lbs + '" data-set="order-lbs" data-id="' + o.id + '"></td>' +
          '<td><select data-set="order-mode" data-id="' + o.id + '">' +
          '<option value="both"' + (o.mode === 'both' ? ' selected' : '') + '>Both</option>' +
          '<option value="pickup"' + (o.mode === 'pickup' ? ' selected' : '') + '>Pickup</option>' +
          '<option value="delivery"' + (o.mode === 'delivery' ? ' selected' : '') + '>Drop-off</option>' +
          '</select></td>' +
          '<td class="num r" id="worth-' + o.id + '"></td>' +
          '<td><button type="button" class="rp-del" data-del-order="' + o.id + '" ' +
          'aria-label="Remove ' + esc(o.name) + '">&times;</button></td></tr>';
      });
      h += '</tbody></table>';
    }

    if (tab === 'partners') {
      h += '<p class="rp-note" style="margin:0 0 16px;">Every laundromat priced against ' +
        '<i>this exact load</i> - the wash rate plus what the drive to reach it costs. ' +
        'The cheapest per pound is often not the cheapest laundromat.</p>';
      // The comparison is derived, so it lives in its own box and is redrawn on
      // every keystroke by renderLive. The editable list below it is left alone,
      // which is what stops the cursor jumping out of a field mid-word.
      h += '<div id="rp-cmp" style="margin-bottom:22px;"></div>';

      h += '<table class="rp-tbl"><thead><tr><th>Laundromat</th><th style="width:80px;">$/lb</th>' +
        '<th style="width:74px;">Fee</th><th style="width:24px;"></th></tr></thead><tbody>';
      PARTNERS.forEach(function (p) {
        h += '<tr>' +
          '<td><input value="' + esc(p.name) + '" data-set="partner-name" data-id="' + p.id + '"></td>' +
          '<td><input type="number" step="0.01" min="0" value="' + p.perLb + '" data-set="partner-perlb" data-id="' + p.id + '"></td>' +
          '<td><input type="number" step="0.5" min="0" value="' + p.fee + '" data-set="partner-fee" data-id="' + p.id + '"></td>' +
          '<td><button type="button" class="rp-del" data-del-partner="' + p.id + '"' +
          (PARTNERS.length < 2 ? ' disabled' : '') + ' aria-label="Remove ' + esc(p.name) +
          '">&times;</button></td></tr>';
      });
      h += '</tbody></table>';
    }

    // Nothing on the cost tab is editable, so all of it is derived and all of
    // it is filled by renderLive.
    if (tab === 'cost') h += '<div id="rp-cost"></div>';

    if (tab === 'rates') {
      var f = function (k, label, step, dim) {
        return '<div class="rp-field' + (dim ? ' rp-dim' : '') + '"><label for="rate-' + k + '">' +
          esc(label) + '</label><input id="rate-' + k + '" type="number" step="' + step +
          '" value="' + S[k] + '" data-rate="' + k + '"></div>';
      };
      h += '<div class="rp-rates">' +
        f('wage', 'Driver $/hr', '0.5') +
        f('gas', 'Gas $/gal', '0.05') +
        f('mpg', 'Van MPG', '1') +
        f('wear', 'Wear $/mi', '0.01') +
        f('speed', 'Avg speed mph', '1') +
        f('circuity', 'Road factor', '0.05') +
        f('stopMin', 'Min at a door', '1') +
        f('partnerMin', 'Min at a counter', '1') +
        f('retail', 'Retail $/lb', '0.05') +
        f('minCharge', 'Minimum charge $', '1') +
        f('stripePct', 'Card %', '0.1') +
        f('stripeFlat', 'Card flat $', '0.05') +
        '</div>';
      h += '<p class="rp-note" style="margin:18px 0 0;">Retail and the minimum open on what ' +
        'LYNDRY actually charges. Changing them here changes nothing anywhere else - this ' +
        'page is a model. Road factor greys out whenever real driving distances are in ' +
        'use, because nothing then reads it.</p>';
    }

    el('rp-panel').innerHTML = h;
    renderLive();
  }

  // Everything that is worked out rather than typed. Safe to run on every
  // keystroke because it only writes to boxes that hold no input.
  function renderLive() {
    if (!RUN) return;

    // Road factor only means something when we are guessing at distances.
    var cf = el('rate-circuity');
    if (cf) cf.parentNode.classList.toggle('rp-dim', MATRIX.ok);

    if (tab === 'stops') {
      ORDERS.forEach(function (o) {
        var w = el('worth-' + o.id);
        if (w) {
          var c = CONTRIB[o.id];
          w.textContent = c == null ? '-' : money(c);
          w.className = 'num r ' + (c == null ? '' : c <= 0 ? 'rp-loss' : c < 6 ? 'rp-mid' : 'rp-good');
        }
      });
    }

    var cmp = el('rp-cmp');
    if (cmp) {
      var t = '<table class="rp-tbl"><thead><tr><th>If it all went here</th>' +
        '<th class="r">Miles</th><th class="r">Wash</th><th class="r">Total cost</th>' +
        '</tr></thead><tbody>';
      RUN.byPartner.slice().sort(function (a, b) { return a.run.cost - b.run.cost; })
        .forEach(function (row, i) {
          t += '<tr>' +
            '<td' + (i === 0 ? ' style="font-weight:700;"' : '') + '>' + esc(row.partner.name) +
            ' <span class="num" style="color:var(--ink-500);font-weight:400;">$' +
            Number(row.partner.perLb).toFixed(2) + '/lb</span></td>' +
            '<td class="num r">' + row.run.miles.toFixed(1) + '</td>' +
            '<td class="num r">' + money0(row.run.wash) + '</td>' +
            '<td class="num r"' + (i === 0 ? ' style="color:var(--suds-700);"' : '') + '>' +
            money(row.run.cost) + '</td></tr>';
        });
      cmp.innerHTML = t + '</tbody></table>';
    }

    var cost = el('rp-cost');
    if (cost) {
      var c2 = '';
      [
        ['Driver wage', RUN.labor, 'var(--suds-500)'],
        ['Wholesale wash', RUN.wash, 'var(--sunbeam-500)'],
        ['Gas', RUN.fuel, 'var(--lilac-500)'],
        ['Vehicle wear', RUN.wear, 'var(--suds-300)'],
        ['Card processing', RUN.proc, 'var(--paper-300)'],
      ].forEach(function (r) {
        var pct = (r[1] / RUN.cost) * 100;
        c2 += '<div class="rp-cost-row"><div class="rp-cost-top"><span>' + esc(r[0]) + '</span>' +
          '<span style="font-family:var(--font-mono);font-weight:700;">' + money(r[1]) +
          ' <span style="color:var(--ink-500);font-weight:400;">' + pct.toFixed(0) + '%</span></span></div>' +
          '<div class="rp-track"><div class="rp-fill" style="width:' + pct.toFixed(1) +
          '%;background:' + r[2] + ';"></div></div></div>';
      });
      c2 += '<hr style="border:0;border-top:2px solid var(--ink-900);margin:20px 0 16px;">' +
        '<dl class="rp-facts">' +
        '<dt>Driving</dt><dd>' + Math.round(RUN.driveMin) + ' min</dd>' +
        '<dt>At doors and counters</dt><dd>' + Math.round(RUN.svcMin) + ' min</dd>' +
        '<dt>Cost per stop</dt><dd>' + money(RUN.cost / ORDERS.length) + '</dd>' +
        '<dt>Revenue per mile</dt><dd>' + money(RUN.revenue / Math.max(RUN.miles, 0.1)) + '</dd>' +
        '<dt>Break-even weight</dt><dd>' + (RUN.cost / Math.max(S.retail, 0.01)).toFixed(0) + ' lb</dd>' +
        '</dl>';
      cost.innerHTML = c2;
    }
  }

  function render() {
    renderStats();
    renderRibbon();
    renderLive();
    drawMap();
  }

  // structural = the list of stops or laundromats changed, so the rail has to
  // be rebuilt. Otherwise only the numbers move and the inputs are left alone.
  function changed(structural) {
    recompute();
    if (structural) renderPanel();
    render();
    scheduleRoads();
  }

  // Put a stop or a laundromat at a point. ONE definition, shared by both
  // ways of adding: clicking the map, and typing an address. They used to be
  // separate pieces of code, which is how the address box ended up only
  // moving the map instead of placing anything.
  function place(kind, lat, lng, label) {
    if (kind === 'order') {
      ORDERS.push({
        id: 'o' + Date.now(), name: label || 'New stop',
        lat: lat, lng: lng, lbs: 25, mode: 'both',
      });
    } else {
      PARTNERS.push({
        id: 'p' + Date.now(), name: label || 'New laundromat',
        lat: lat, lng: lng, perLb: 0.9, fee: 0,
      });
    }
    changed(true);
  }

  // The first line of a Nominatim result, so a placed pin is named after the
  // street rather than "New stop". display_name is the entire postal address
  // and far too long for a rail that has to stay readable.
  function shortLabel(display) {
    var first = String(display || '').split(',')[0].trim();
    return first.slice(0, 28) || null;
  }

  // -- input --------------------------------------------------------------
  var addMode = null;
  function setAddMode(m) {
    addMode = m;
    el('rp-add-stop').classList.toggle('btn-outline', m !== 'order');
    el('rp-add-partner').classList.toggle('btn-outline', m !== 'partner');
    el('rp-hint').textContent = m
      ? 'Click the map to place it, or type an address and press Find.'
      : 'Drag any pin to move it.';
    if (map) map.getContainer().style.cursor = m ? 'crosshair' : '';
  }

  el('rp-add-stop').addEventListener('click', function () {
    setAddMode(addMode === 'order' ? null : 'order');
  });
  el('rp-add-partner').addEventListener('click', function () {
    setAddMode(addMode === 'partner' ? null : 'partner');
  });

  document.querySelectorAll('.rp-tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.getAttribute('data-tab');
      document.querySelectorAll('.rp-tabs button').forEach(function (x) {
        x.setAttribute('aria-selected', x === b ? 'true' : 'false');
      });
      renderPanel();
    });
  });

  var find = function (list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  el('rp-panel').addEventListener('input', function (e) {
    var t = e.target;
    var rate = t.getAttribute('data-rate');
    if (rate) {
      S[rate] = Number(t.value) || 0;
      recompute();
      render();
      return;
    }
    var set = t.getAttribute('data-set');
    if (!set) return;
    var id = t.getAttribute('data-id');
    var o = find(ORDERS, id), p = find(PARTNERS, id);
    if (set === 'order-name' && o) o.name = t.value;
    if (set === 'order-lbs' && o) o.lbs = Math.max(0, Number(t.value) || 0);
    if (set === 'order-mode' && o) o.mode = t.value;
    if (set === 'partner-name' && p) p.name = t.value;
    if (set === 'partner-perlb' && p) p.perLb = Math.max(0, Number(t.value) || 0);
    if (set === 'partner-fee' && p) p.fee = Math.max(0, Number(t.value) || 0);
    recompute();
    render();
  });

  el('rp-panel').addEventListener('change', function (e) {
    if (e.target.getAttribute('data-set') === 'order-mode') { recompute(); render(); }
  });

  el('rp-panel').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    var oid = b.getAttribute('data-del-order');
    var pid = b.getAttribute('data-del-partner');
    if (oid) {
      ORDERS = ORDERS.filter(function (x) { return x.id !== oid; });
      changed(true);
    } else if (pid && PARTNERS.length > 1) {
      PARTNERS = PARTNERS.filter(function (x) { return x.id !== pid; });
      changed(true);
    }
  });

  // Address lookup, on submit only. Nominatim asks that nobody fires a request
  // per keystroke, and a search box that waits for Enter is well inside that.
  el('rp-search').addEventListener('submit', function (e) {
    // AN ADDRESS PLACES A PIN. This used to only pan the map and then tell
    // you to click "Add a stop" and click the map yourself - four steps and
    // a precise click for a place you had already typed exactly.
    //
    // Which of the two it places is whichever button is armed. With neither
    // armed it only moves the map, which is still useful for looking around.
    e.preventDefault();
    var q = el('rp-q').value.trim();
    if (!q || !map) return;

    var kind = addMode;
    el('rp-hint').textContent = 'Looking for that address...';

    ask('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' +
      encodeURIComponent(q))
      .then(function (j) {
        if (!j || !j.length) {
          el('rp-hint').textContent = 'No address matched that. Try adding the town.';
          return;
        }

        var lat = Number(j[0].lat);
        var lng = Number(j[0].lon);
        map.setView([lat, lng], 15);

        if (!kind) {
          el('rp-hint').textContent =
            'Found it. Pick Add a stop or Add a laundromat, then search again to put one here.';
          return;
        }

        place(kind, lat, lng, shortLabel(j[0].display_name));
        setAddMode(null);
        el('rp-q').value = '';
        el('rp-hint').textContent =
          (kind === 'order' ? 'Stop' : 'Laundromat') + ' added. Drag the pin to nudge it.';
      })
      .catch(function () { el('rp-hint').textContent = 'The address lookup did not answer.'; });
  });

  // -- go -----------------------------------------------------------------
  function start() {
    recompute();
    initMap();
    renderPanel();
    render();
    scheduleRoads();
  }

  if (window.L) start();
  else window.addEventListener('load', start);
})();
</script>`;
}

module.exports = { routePlannerBody, routePlannerHead };
