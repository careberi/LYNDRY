'use strict';

const { config } = require('../config');

// ---------------------------------------------------------------------------
// Run economics: what one route cycle actually earns.
//
// A model, not a report. Nothing here reads the database, and nothing it shows
// is a fact about a real order - it is a set of assumptions Neil can push
// around to see which ones the business actually turns on.
//
// Kept in its own file because it is the only page in /ops with client-side
// JavaScript. Every other ops screen is deliberately plain HTML so a driver on
// two bars of signal gets a page that either worked or did not. This one is a
// calculator: interactive is the entire point, and nobody is standing in a
// stairwell using it.
//
// The rate and the minimum come from config rather than being typed in, so the
// model opens on LYNDRY's real prices instead of somebody else's placeholders.
// ---------------------------------------------------------------------------

function runEconomicsBody() {
  const rate = (config.pricing.perPoundCents / 100).toFixed(2);
  const minimum = (config.pricing.minimumCents / 100).toFixed(0);

  return `
<style>
  /* Page-scoped. The grid lives here rather than inline because an inline
     grid-template-columns beats the media query and the page then refuses to
     collapse on a phone - the same trap the marketing pages hit. */
  .econ-grid { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 24px; align-items: start; }
  .econ-two  { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin: 20px 0; }
  @media (max-width: 900px) {
    .econ-grid, .econ-two { grid-template-columns: minmax(0, 1fr); }
  }

  .econ-field { margin-bottom: 18px; }
  .econ-field .econ-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 7px; }
  .econ-field label { font-size: 14px; color: var(--ink-700); line-height: 1.3; }
  .econ-field .econ-val { font-family: var(--font-mono); font-size: 14px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* Pure white, like every other input in the system: fields read as holes
     punched in the paper. */
  .econ-field input[type=number] {
    width: 70px; text-align: right; background: var(--paper-000);
    border: 2px solid var(--ink-900); border-radius: 8px;
    font-family: var(--font-mono); font-size: 14px; font-weight: 700; color: var(--ink-900);
    padding: 4px 6px; outline: none;
  }
  .econ-field input[type=number]:focus-visible { box-shadow: 0 0 0 4px var(--lilac-300); }
  .econ-field input[type=range] { width: 100%; accent-color: var(--suds-500); height: 4px; }
  .econ-field .econ-hint { font-size: 13px; color: var(--ink-500); margin-top: 5px; line-height: 1.4; }

  .econ-bar { display: flex; height: 44px; width: 100%; border: 2px solid var(--ink-900); border-radius: 10px; overflow: hidden; }
  .econ-bar div { display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--ink-900); }

  .econ-legend { display: flex; flex-wrap: wrap; gap: 10px 22px; margin-top: 16px; }
  .econ-legend .econ-item { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--ink-700); }
  .econ-legend .econ-sw { width: 12px; height: 12px; border: 2px solid var(--ink-900); border-radius: 3px; display: inline-block; }
  .econ-legend b { font-family: var(--font-mono); font-weight: 700; color: var(--ink-900); font-variant-numeric: tabular-nums; }

  table.econ-pnl { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: 14px; font-variant-numeric: tabular-nums; }
  table.econ-pnl td { padding: 7px 0; }
  table.econ-pnl td.l { font-family: var(--font-body); }
  table.econ-pnl td.i { padding-left: 14px; color: var(--ink-500); }
  table.econ-pnl td.r { text-align: right; }
  table.econ-pnl tr.tot td { border-top: 1px solid var(--ink-200); padding-top: 10px; }
  table.econ-pnl tr.net td { border-top: 2px solid var(--ink-900); padding-top: 11px; font-weight: 700; font-size: 17px; }

  table.econ-sens { border-collapse: collapse; width: 100%; font-family: var(--font-mono); font-size: 13px; font-variant-numeric: tabular-nums; min-width: 460px; }
  table.econ-sens th { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-500); font-weight: 700; padding: 8px 10px; }
  table.econ-sens th.lft { text-align: left; }
  table.econ-sens th.rgt { text-align: right; }
  table.econ-sens td { padding: 9px 10px; text-align: right; border-top: 1px solid var(--ink-100); font-weight: 700; }
  table.econ-sens td.lbl { text-align: left; color: var(--ink-500); font-weight: 400; }
  table.econ-sens td.cur { outline: 3px solid var(--ink-900); outline-offset: -3px; }
</style>

<div style="display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:8px;">
  <div>
    <p class="eyebrow" style="margin-bottom:6px;">A model, not a report</p>
    <h1 style="font-family:var(--font-display);font-weight:900;font-size:38px;letter-spacing:-0.03em;margin:0;">
      Run economics
    </h1>
    <p style="font-size:16px;color:var(--ink-500);margin:8px 0 0;max-width:52ch;">
      What one route cycle actually earns. Nothing here is a real order &mdash; push the
      numbers around and see which assumptions the business turns on.
    </p>
  </div>

  <div style="display:flex;border:2px solid var(--ink-900);border-radius:12px;overflow:hidden;" id="econ-modes">
    <button type="button" data-mode="separate" class="econ-mode"
            style="background:var(--paper-050);border:none;border-right:2px solid var(--ink-900);padding:12px 18px;cursor:pointer;text-align:left;font-family:var(--font-body);">
      <span style="font-size:15px;font-weight:700;display:block;">Two loops</span>
      <span style="font-size:12px;color:var(--ink-500);">pickup, then delivery</span>
    </button>
    <button type="button" data-mode="combined" class="econ-mode"
            style="background:var(--paper-050);border:none;padding:12px 18px;cursor:pointer;text-align:left;font-family:var(--font-body);">
      <span style="font-size:15px;font-weight:700;display:block;">One loop</span>
      <span style="font-size:12px;color:var(--ink-500);">swap at each door</span>
    </button>
  </div>
</div>

<div class="econ-grid" style="margin-top:28px;">
  <aside id="econ-inputs"></aside>

  <main>
    <div class="card card-xl" id="econ-headline" style="padding:28px;margin-bottom:20px;">
      <div style="display:flex;flex-wrap:wrap;gap:28px;">
        <div style="flex:1 1 190px;" id="econ-s-net">
          <p class="eyebrow" style="margin:0 0 8px;">You keep, per run</p>
          <div class="v" style="font-family:var(--font-display);font-weight:900;font-size:46px;line-height:1;letter-spacing:-0.03em;">&mdash;</div>
          <div class="s" style="font-size:14px;color:var(--ink-500);margin-top:6px;"></div>
        </div>
        ${['econ-s-hour|Per labour hour', 'econ-s-stop|Per stop', 'econ-s-lb|Per pound']
          .map((pair) => {
            const [id, label] = pair.split('|');
            return `
        <div style="flex:1 1 130px;" id="${id}">
          <p class="eyebrow" style="margin:0 0 8px;">${label}</p>
          <div class="v" style="font-family:var(--font-mono);font-weight:700;font-size:26px;line-height:1;font-variant-numeric:tabular-nums;">&mdash;</div>
          <div class="s" style="font-size:14px;color:var(--ink-500);margin-top:6px;"></div>
        </div>`;
          })
          .join('')}
      </div>
    </div>

    <div class="card card-xl" style="padding:26px;">
      <p class="eyebrow" style="margin-bottom:4px;">Where the revenue dollar goes</p>
      <p id="econ-rev-sub" style="font-size:16px;color:var(--ink-500);margin:0 0 18px;"></p>
      <div class="econ-bar" id="econ-bar"></div>
      <div class="econ-legend" id="econ-legend"></div>
    </div>

    <div class="econ-two">
      <div class="card card-xl" style="padding:26px;">
        <p class="eyebrow" style="margin-bottom:16px;">Run P&amp;L</p>
        <table class="econ-pnl"><tbody id="econ-pnl"></tbody></table>
      </div>

      <div class="card card-xl" style="padding:26px;">
        <p class="eyebrow" style="margin-bottom:16px;">Breakeven &amp; structure</p>
        <div style="display:flex;flex-wrap:wrap;gap:24px;margin-bottom:20px;">
          <div style="flex:1 1 120px;" id="econ-s-belb">
            <p class="eyebrow" style="margin:0 0 8px;">Breakeven pounds</p>
            <div class="v" style="font-family:var(--font-mono);font-weight:700;font-size:24px;font-variant-numeric:tabular-nums;">&mdash;</div>
            <div class="s" style="font-size:13px;color:var(--ink-500);margin-top:5px;"></div>
          </div>
          <div style="flex:1 1 120px;" id="econ-s-bestop">
            <p class="eyebrow" style="margin:0 0 8px;">Breakeven per order</p>
            <div class="v" style="font-family:var(--font-mono);font-weight:700;font-size:24px;font-variant-numeric:tabular-nums;">&mdash;</div>
            <div class="s" style="font-size:13px;color:var(--ink-500);margin-top:5px;"></div>
          </div>
        </div>
        <p id="econ-structure" style="font-size:15px;line-height:1.55;color:var(--ink-700);border-top:1px solid var(--ink-200);padding-top:16px;margin:0;"></p>
      </div>
    </div>

    <div class="card card-xl" style="padding:26px;">
      <p class="eyebrow" style="margin-bottom:4px;">Net per run</p>
      <p style="font-size:16px;color:var(--ink-500);margin:0 0 18px;">
        Density against stop count. Mileage grows with stops; your current scenario is outlined.
      </p>
      <div style="overflow-x:auto;"><table class="econ-sens" id="econ-sens"></table></div>
    </div>

    <p style="font-size:14px;line-height:1.6;color:var(--ink-500);margin-top:22px;">
      Net is after driver, vehicle, partner, card fees, supplies and whatever overhead you
      allocate here. It does not deduct an owner salary if you drive the run yourself &mdash;
      in that case read <strong>per labour hour</strong> as your own wage plus profit.
    </p>
  </main>
</div>

<script>
(function () {
  'use strict';

  var S = {
    mode: 'separate', stops: 10, pounds: 200, baseMiles: 12, milesPerStop: 0.8,
    mph: 20, minPerStop: 4, minAtPartner: 12,
    // Our real prices, from src/config.js, so the model opens on reality.
    rate: ${rate}, minCharge: ${minimum}, deliveryFee: 0, wholesale: 1.10,
    wage: 20, burden: 12, perMile: 0.32,
    supplies: 0.30, comms: 0.15, pctFee: 2.9, fixedFee: 0.30, overhead: 12
  };

  // Palette only. Text on every one of these is ink, because Suds, Sunbeam and
  // Lilac are all light enough that white type on them is a bug.
  var SEG = [
    { key: 'partner',    label: 'Partner wash',   color: 'var(--lilac-500)' },
    { key: 'driver',     label: 'Driver',         color: 'var(--suds-300)' },
    { key: 'vehicle',    label: 'Vehicle',        color: 'var(--sunbeam-300)' },
    { key: 'processing', label: 'Card fees',      color: 'var(--stain-100)' },
    { key: 'perOrder',   label: 'Supplies + SMS', color: 'var(--paper-300)' },
    { key: 'overhead',   label: 'Overhead',       color: 'var(--ink-100)' }
  ];
  var PROFIT = 'var(--suds-500)';

  function usd(n) {
    var s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '$') + s;
  }
  function usd0(n) {
    return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
  }

  function computeRun(i) {
    var stops = Math.max(1, i.stops);
    var lbsPerStop = i.pounds / stops;
    var milesPerLoop = i.baseMiles + i.milesPerStop * stops;
    var combined = i.mode === 'combined';
    var loops = combined ? 1 : 2;
    var miles = milesPerLoop * loops;

    var doorMin = combined ? stops * i.minPerStop * 1.5 : stops * i.minPerStop * 2;
    var partnerMin = combined ? i.minAtPartner * 1.5 : i.minAtPartner * 2;
    var driveMin = (miles / Math.max(1, i.mph)) * 60;
    var laborHours = (doorMin + partnerMin + driveMin) / 60;

    var orderRev = Math.max(lbsPerStop * i.rate, i.minCharge) + i.deliveryFee;
    var revenue = orderRev * stops;

    var costs = {
      partner: i.pounds * i.wholesale,
      driver: laborHours * i.wage * (1 + i.burden / 100),
      vehicle: miles * i.perMile,
      processing: revenue * (i.pctFee / 100) + stops * i.fixedFee,
      perOrder: stops * (i.supplies + i.comms),
      overhead: i.overhead
    };
    var totalCost = 0;
    for (var k in costs) totalCost += costs[k];
    var net = revenue - totalCost;

    var fixedish = costs.driver + costs.vehicle + costs.perOrder + costs.overhead + stops * i.fixedFee;
    var contribPerLb = i.rate * (1 - i.pctFee / 100) - i.wholesale;
    var bePounds = contribPerLb > 0 ? fixedish / contribPerLb : Infinity;

    return {
      stops: stops, lbsPerStop: lbsPerStop, miles: miles, milesPerLoop: milesPerLoop,
      loops: loops, laborHours: laborHours, revenue: revenue, orderRev: orderRev,
      costs: costs, totalCost: totalCost, net: net,
      margin: revenue > 0 ? net / revenue : 0,
      perStop: net / stops,
      perPound: i.pounds > 0 ? net / i.pounds : 0,
      perHour: laborHours > 0 ? net / laborHours : 0,
      bePounds: bePounds, bePerStop: bePounds / stops, contribPerLb: contribPerLb
    };
  }

  var GROUPS = [
    { title: 'Route', fields: [
      { k: 'stops', label: 'Stops on the run', min: 1, max: 30, step: 1 },
      { k: 'pounds', label: 'Total pounds collected', min: 20, max: 800, step: 10,
        hint: function (r) { return r.lbsPerStop.toFixed(1) + ' lb per order'; } },
      { k: 'baseMiles', label: 'Fixed loop miles', min: 0, max: 60, step: 1, suffix: ' mi',
        hint: function () { return 'Depot and laundromat legs, before any stops'; } },
      { k: 'milesPerStop', label: 'Added miles per stop', min: 0, max: 4, step: 0.1, suffix: ' mi',
        hint: function (r) { return 'Loop = ' + r.milesPerLoop.toFixed(1) + ' mi x ' + r.loops + ' = ' + r.miles.toFixed(1) + ' mi total'; } },
      { k: 'mph', label: 'Average speed', min: 8, max: 45, step: 1, suffix: ' mph' },
      { k: 'minPerStop', label: 'Minutes per door', min: 1, max: 15, step: 0.5, suffix: ' min' },
      { k: 'minAtPartner', label: 'Minutes at the laundromat', min: 0, max: 45, step: 1, suffix: ' min' }
    ] },
    { title: 'What you charge', fields: [
      { k: 'rate', label: 'Retail rate', min: 1.25, max: 4, step: 0.05, prefix: '$', suffix: '/lb' },
      { k: 'minCharge', label: 'Minimum per order', min: 0, max: 60, step: 1, prefix: '$',
        hint: function (r) { return (r.lbsPerStop * S.rate < S.minCharge)
          ? 'The minimum is what these orders pay' : 'Not binding at this weight'; } },
      { k: 'deliveryFee', label: 'Delivery fee per order', min: 0, max: 15, step: 0.5, prefix: '$' }
    ] },
    { title: 'What the partner charges', fields: [
      { k: 'wholesale', label: 'Wholesale wash rate', min: 0.6, max: 2, step: 0.05, prefix: '$', suffix: '/lb',
        hint: function () { return 'Markup ' + (S.rate / Math.max(0.01, S.wholesale)).toFixed(2) + 'x'; } }
    ] },
    { title: 'Driver and vehicle', fields: [
      { k: 'wage', label: 'Driver wage', min: 0, max: 40, step: 0.5, prefix: '$', suffix: '/hr' },
      { k: 'burden', label: 'Payroll burden', min: 0, max: 35, step: 1, suffix: '%',
        hint: function () { return 'Set to 0 for contractors'; } },
      { k: 'perMile', label: 'Vehicle cost', min: 0.1, max: 0.75, step: 0.01, prefix: '$', suffix: '/mi',
        hint: function () { return 'Fuel, maintenance, tires, depreciation'; } }
    ] },
    { title: 'Per order and overhead', fields: [
      { k: 'supplies', label: 'Bags, tags, wrap', min: 0, max: 2, step: 0.05, prefix: '$' },
      { k: 'comms', label: 'Texts and AI per order', min: 0, max: 1, step: 0.01, prefix: '$' },
      { k: 'pctFee', label: 'Card rate', min: 0, max: 5, step: 0.1, suffix: '%' },
      { k: 'fixedFee', label: 'Card fee per charge', min: 0, max: 1, step: 0.05, prefix: '$' },
      { k: 'overhead', label: 'Overhead per run', min: 0, max: 100, step: 1, prefix: '$',
        hint: function () { return 'Insurance, phone, software'; } }
    ] }
  ];

  var hintFns = {};

  function buildInputs() {
    var host = document.getElementById('econ-inputs');

    GROUPS.forEach(function (g) {
      var panel = document.createElement('div');
      panel.className = 'card card-xl';
      panel.style.cssText = 'padding:22px 24px 6px;margin-bottom:18px;';

      var h = document.createElement('p');
      h.className = 'eyebrow';
      h.style.marginBottom = '18px';
      h.textContent = g.title;
      panel.appendChild(h);

      g.fields.forEach(function (f) {
        var wrap = document.createElement('div');
        wrap.className = 'econ-field';

        var row = document.createElement('div');
        row.className = 'econ-row';

        var lab = document.createElement('label');
        lab.textContent = f.label;
        lab.setAttribute('for', 'n-' + f.k);

        var val = document.createElement('div');
        val.className = 'econ-val';
        if (f.prefix) val.appendChild(document.createTextNode(f.prefix));

        var num = document.createElement('input');
        num.type = 'number';
        num.id = 'n-' + f.k;
        num.min = f.min; num.max = f.max; num.step = f.step; num.value = S[f.k];
        val.appendChild(num);
        if (f.suffix) val.appendChild(document.createTextNode(f.suffix));

        row.appendChild(lab);
        row.appendChild(val);

        var rng = document.createElement('input');
        rng.type = 'range';
        rng.id = 'r-' + f.k;
        rng.min = f.min; rng.max = f.max; rng.step = f.step; rng.value = S[f.k];
        rng.setAttribute('aria-label', f.label);

        wrap.appendChild(row);
        wrap.appendChild(rng);

        if (f.hint) {
          var hint = document.createElement('div');
          hint.className = 'econ-hint';
          hint.id = 'h-' + f.k;
          wrap.appendChild(hint);
          hintFns[f.k] = f.hint;
        }

        function set(v) {
          if (isNaN(v)) v = 0;
          S[f.k] = v;
          num.value = v;
          rng.value = v;
          render();
        }
        num.addEventListener('input', function () { set(parseFloat(num.value)); });
        rng.addEventListener('input', function () { set(parseFloat(rng.value)); });

        panel.appendChild(wrap);
      });

      host.appendChild(panel);
    });
  }

  var DENSITIES = [8, 12, 16, 20, 25, 30];
  var STOPCOUNTS = [6, 8, 10, 12, 15, 20];

  function setStat(id, value, sub) {
    var el = document.getElementById(id);
    el.querySelector('.v').textContent = value;
    el.querySelector('.s').textContent = sub || '';
  }

  function render() {
    var r = computeRun(S);
    var alt = computeRun(Object.assign({}, S, { mode: S.mode === 'combined' ? 'separate' : 'combined' }));
    var pos = r.net >= 0;

    Array.prototype.forEach.call(document.querySelectorAll('#econ-modes button'), function (b) {
      var on = b.getAttribute('data-mode') === S.mode;
      b.style.background = on ? 'var(--suds-500)' : 'var(--paper-050)';
      b.querySelector('span:last-child').style.color = on ? 'var(--ink-900)' : 'var(--ink-500)';
    });

    for (var k in hintFns) {
      var hEl = document.getElementById('h-' + k);
      if (hEl) hEl.textContent = hintFns[k](r);
    }

    // The headline card turns Stain when the run loses money. A number that
    // has to be read to know it is negative is a number that gets missed.
    var head = document.getElementById('econ-headline');
    head.style.background = pos ? 'var(--suds-100)' : 'var(--stain-100)';
    head.style.boxShadow = '8px 8px 0 ' + (pos ? 'var(--suds-500)' : 'var(--stain-500)');
    document.getElementById('econ-s-net').querySelector('.v').style.color = 'var(--ink-900)';

    setStat('econ-s-net', usd(r.net), (r.margin * 100).toFixed(1) + '% of revenue');
    setStat('econ-s-hour', usd(r.perHour), r.laborHours.toFixed(2) + ' hr on the clock');
    setStat('econ-s-stop', usd(r.perStop), usd(r.orderRev) + ' revenue each');
    setStat('econ-s-lb', '$' + r.perPound.toFixed(3), r.miles.toFixed(0) + ' mi driven');

    document.getElementById('econ-rev-sub').textContent =
      usd(r.revenue) + ' collected from ' + r.stops + ' customers';

    var bar = document.getElementById('econ-bar');
    bar.innerHTML = '';
    SEG.forEach(function (s) {
      var pct = r.revenue > 0 ? (r.costs[s.key] / r.revenue) * 100 : 0;
      if (pct <= 0) return;
      var d = document.createElement('div');
      d.style.width = pct + '%';
      d.style.background = s.color;
      d.title = s.label + ': ' + usd(r.costs[s.key]);
      d.textContent = pct > 7 ? Math.round(pct) + '%' : '';
      bar.appendChild(d);
    });
    if (pos && r.margin > 0) {
      var p = document.createElement('div');
      p.style.width = (r.margin * 100) + '%';
      p.style.background = PROFIT;
      p.title = 'Yours: ' + usd(r.net);
      p.textContent = r.margin * 100 > 7 ? Math.round(r.margin * 100) + '%' : '';
      bar.appendChild(p);
    }

    var leg = document.getElementById('econ-legend');
    leg.innerHTML = '';
    SEG.concat([{ key: '__p', label: 'Yours', color: PROFIT }]).forEach(function (s) {
      var v = (s.key === '__p') ? r.net : r.costs[s.key];
      if (!v) return;
      var item = document.createElement('div');
      item.className = 'econ-item';
      var sw = document.createElement('span');
      sw.className = 'econ-sw';
      sw.style.background = s.color;
      var name = document.createElement('span');
      name.textContent = s.label;
      var amt = document.createElement('b');
      amt.textContent = usd(v);
      item.appendChild(sw); item.appendChild(name); item.appendChild(amt);
      leg.appendChild(item);
    });

    var body = document.getElementById('econ-pnl');
    body.innerHTML = '';
    function row(cls, label, amount, labClass, colour) {
      var tr = document.createElement('tr');
      if (cls) tr.className = cls;
      var td1 = document.createElement('td');
      td1.className = 'l ' + (labClass || '');
      td1.textContent = label;
      var td2 = document.createElement('td');
      td2.className = 'r';
      td2.textContent = amount;
      if (colour) td2.style.color = colour;
      tr.appendChild(td1); tr.appendChild(td2);
      body.appendChild(tr);
      return td2;
    }
    row('', 'Revenue', usd(r.revenue)).style.fontWeight = '700';
    SEG.forEach(function (s) {
      row('', s.label, '(' + usd(r.costs[s.key]) + ')', 'i', 'var(--ink-500)');
    });
    row('tot', 'Total cost', usd(r.totalCost));
    row('net', 'Net per run', usd(r.net), '', pos ? 'var(--suds-600)' : 'var(--stain-500)');

    setStat('econ-s-belb',
      isFinite(r.bePounds) ? r.bePounds.toFixed(0) + ' lb' : '\\u2014',
      'at ' + r.stops + ' stops');
    setStat('econ-s-bestop',
      isFinite(r.bePerStop) ? r.bePerStop.toFixed(1) + ' lb' : '\\u2014',
      'below this the run loses money');

    var diff = alt.net - r.net;
    document.getElementById('econ-structure').innerHTML =
      'Each pound past breakeven adds <strong>$' + r.contribPerLb.toFixed(2) + '</strong>. ' +
      'Switching to <strong>' + (S.mode === 'combined' ? 'two separate loops' : 'one combined loop') + '</strong> ' +
      'would make this run <strong style="color:' + (diff > 0 ? 'var(--suds-600)' : 'var(--stain-500)') + '">' +
      (diff > 0 ? '+' : '') + usd(diff) + '</strong> and change labour to ' + alt.laborHours.toFixed(2) + ' hr.';

    var t = document.getElementById('econ-sens');
    t.innerHTML = '';
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    var th0 = document.createElement('th');
    th0.className = 'lft';
    th0.textContent = 'lb / order';
    htr.appendChild(th0);
    STOPCOUNTS.forEach(function (s) {
      var th = document.createElement('th');
      th.className = 'rgt';
      th.textContent = s + ' stops';
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    t.appendChild(thead);

    var tbody = document.createElement('tbody');
    DENSITIES.forEach(function (d) {
      var tr = document.createElement('tr');
      var td0 = document.createElement('td');
      td0.className = 'lbl';
      td0.textContent = d;
      tr.appendChild(td0);
      STOPCOUNTS.forEach(function (s) {
        var cell = computeRun(Object.assign({}, S, { stops: s, pounds: d * s }));
        var td = document.createElement('td');
        var isCur = (s === S.stops) && Math.abs(d - r.lbsPerStop) < 0.5;
        var intensity = Math.min(1, Math.abs(cell.net) / 320);
        td.textContent = usd0(cell.net);
        td.style.color = 'var(--ink-900)';
        td.style.background = cell.net >= 0
          ? 'rgba(14,164,122,' + (0.08 + intensity * 0.42) + ')'
          : 'rgba(232,65,47,' + (0.08 + intensity * 0.38) + ')';
        if (isCur) td.className = 'cur';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
  }

  document.getElementById('econ-modes').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    S.mode = b.getAttribute('data-mode');
    render();
  });

  buildInputs();
  render();
})();
</script>`;
}

module.exports = { runEconomicsBody };
