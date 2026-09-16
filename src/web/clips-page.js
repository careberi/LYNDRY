'use strict';

const { escapeHtml } = require('./layout');

// ---------------------------------------------------------------------------
// CLIPS IN THE VAN, AT THE START OF A SHIFT.
//
// READ-ONLY, AND THAT IS THE DESIGN RATHER THAN AN OMISSION. There is no form
// on this page, nothing to submit and no order that can be changed from it:
// Neil ruled out a tap on every stop, so this is a thing you look at once and
// walk away from. A control here would be that tap arriving by the back door.
//
// THE MIDDLE LIST IS THE JOB. "Should be in the van" is every number nothing is
// holding, so it is the list to count against what is physically in front of
// you. The page cannot know what is actually missing - only somebody looking in
// the van can - so it says what to look for rather than pretending to an answer.
//
// NO INLINE TYPE. The page is rendered with terminal: true, and .ops-terminal
// already sets h1, h2 and .ops-table with !important precisely because fifty
// inline heading styles across ops were beating the stylesheet. Writing another
// one here would be the thing that rule exists to stop; the only inline styles
// left are layout the stylesheet has no opinion about.
// ---------------------------------------------------------------------------

// Why the system cannot say where a clip is. Three different things went wrong
// and the driver's next move is the same for all three: look for it.
const WHY = {
  never_returned: 'Came off a bag and was never put back',
  order_finished: 'Order finished with it still on',
  outside_pool: 'Not a number this van owns',
};

const MUTED = 'color:var(--c-muted);margin:4px 0 0;';

const CHIP =
  'min-width:30px;padding:6px 4px;text-align:center;border:1px solid var(--c-line);' +
  'background:var(--c-row);font-variant-numeric:tabular-nums;';

function grid(clips) {
  return `<div style="display:flex;flex-wrap:wrap;gap:5px;margin:10px 0 0;">
    ${clips.map((c) => `<span style="${CHIP}">${escapeHtml(String(c.clip))}</span>`).join('')}
  </div>`;
}

function rows(clips, { reason }) {
  return `<div class="ops-table-wrap" style="margin-top:8px;"><table class="ops-table">
    <thead><tr>
      <th>Clip</th><th>Bag</th><th>Order</th><th>${reason ? 'What happened' : 'Where it is'}</th>
    </tr></thead>
    <tbody>
      ${clips
        .map((c) => {
          const last = reason
            ? WHY[c.why] || 'Held with no bag left to release it'
            : String(c.orderStatus || '').replace(/_/g, ' ').toLowerCase();
          return `<tr>
            <td><strong>${escapeHtml(String(c.clip))}</strong></td>
            <td style="white-space:nowrap;">${c.code ? escapeHtml(c.code) : '&mdash;'}</td>
            <td>${
              c.orderNumber
                ? `<a href="/ops/orders/${escapeHtml(String(c.orderNumber))}">#${escapeHtml(
                    String(c.orderNumber)
                  )}</a>`
                : '&mdash;'
            }</td>
            <td>${last ? escapeHtml(last) : '&mdash;'}</td>
          </tr>`;
        })
        .join('')}
    </tbody>
  </table></div>`;
}

function clipsPage(stock) {
  const onBags = stock.clips.filter((c) => c.state === 'on_a_bag');
  const free = stock.clips.filter((c) => c.state === 'in_the_van');
  const lost = stock.clips.filter((c) => c.state === 'unaccounted');
  const n = (x) => escapeHtml(String(x));
  const one = (list) => list.length === 1;

  return `
  <div style="max-width:720px;">
    <h1>Clips in the van</h1>
    <p style="color:var(--c-muted);margin:0;">
      Clips 1 to ${n(stock.total)}, as the system understands them. Nothing on this page
      changes an order - count the middle list, then go.
    </p>

    ${
      lost.length
        ? `<div class="ops-note ops-note--bad" role="alert" style="margin-top:18px;">
             <span class="ops-note__label">Unaccounted for</span>
             <span class="ops-note__title">${n(lost.length)} clip${
               one(lost) ? '' : 's'
             } the system cannot place</span>
             <p class="ops-note__body">
               ${one(lost) ? 'This number is' : 'These numbers are'} still held against a
               bag, so nothing will hand ${one(lost) ? 'it' : 'them'} back on
               ${one(lost) ? 'its' : 'their'} own. If you find ${one(lost) ? 'it' : 'them'}
               in the van, say so at the office - until then
               ${one(lost) ? 'that number is' : 'those numbers are'} out of the pool.
             </p>
           </div>
           ${rows(lost, { reason: true })}`
        : ''
    }

    <h2 style="margin-top:28px;">Should be in the van &middot; ${n(free.length)}</h2>
    <p style="${MUTED}">
      ${
        free.length
          ? `Nothing is holding ${one(free) ? 'this one' : 'these'}. Count them against
             what is actually in front of you - anything on this list that is not in the
             van is the gap, and only you can see that.`
          : 'Every number is out. Nothing should be loose in the van.'
      }
    </p>
    ${free.length ? grid(free) : ''}

    <h2 style="margin-top:28px;">On a bag &middot; ${n(onBags.length)}</h2>
    <p style="${MUTED}">
      ${
        onBags.length
          ? `Out on a live order, which is where ${one(onBags) ? 'it belongs' : 'they belong'}.
             Not missing.`
          : 'Nothing is out on an order.'
      }
    </p>
    ${onBags.length ? rows(onBags, { reason: false }) : ''}
  </div>`;
}

module.exports = { clipsPage };
