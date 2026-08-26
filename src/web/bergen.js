'use strict';

// ---------------------------------------------------------------------------
// /bergen — the bits of the advert page that are not markup.
//
// The Meta pixel and the form script live here rather than in the page file
// because the page file is a template with {{TOKEN}} holes in it, and neither
// of these wants to be near a token: the pixel is third-party code that has to
// go in verbatim, and the script is full of braces a token substitution would
// have to be careful around.
// ---------------------------------------------------------------------------

const { config } = require('../config');

// Meta's standard base snippet, with two departures from the copy-paste
// version they hand you, both deliberate:
//
//   NO PageView ON LOAD. Neil asked for `Lead` on a successful submit and
//   nothing else. Meta's default snippet fires PageView the moment it loads;
//   left in, every bounce would be an event and the campaign's numbers would
//   be about traffic rather than signups. `fbq('init')` is still called, since
//   without it the later Lead event has nowhere to go.
//
//   NOTHING AT ALL WHEN THE ID IS BLANK. An empty id still loads Meta's script
//   and still reports to them, from every visitor, while recording nothing
//   useful for us. Off is off.
function pixel() {
  if (!config.metaPixelId) return '';

  return `
  <script>
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window,document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '${config.metaPixelId}');
  </script>
  <noscript><img height="1" width="1" style="display:none"
    src="https://www.facebook.com/tr?id=${config.metaPixelId}&ev=PageView&noscript=1"></noscript>`;
}

// The form.
//
// It is a real <form> that posts to a real endpoint, so it still works with
// none of this running. The script upgrades it: it validates before the round
// trip, swaps the confirmation in without a page load, and fires the pixel
// event - which is the part that cannot survive a navigation.
const script = `
<script>
(function () {
  var form = document.getElementById('join');
  if (!form) return;

  var btn = document.getElementById('join-btn');
  var done = document.getElementById('done');
  var original = btn.innerHTML;

  function show(id, message) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function clearAll() {
    ['err-phone', 'err-consent', 'err-form'].forEach(function (id) { show(id, ''); });
    document.getElementById('phone').classList.remove('input-error');
  }

  // E.164, the same rule the server uses: ten digits, or eleven starting with
  // a 1. Doing it here as well means the number that reaches the server is
  // already the shape the unique index expects, so somebody typing their own
  // number two different ways cannot become two rows.
  function toE164(raw) {
    var digits = String(raw || '').replace(/\\D/g, '');
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
    return null;
  }

  // UTM values off the URL. Read once, at load, because the query string is
  // still there then - a later history change or a click could lose it.
  var utm = (function () {
    var out = {};
    try {
      var q = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
        var v = q.get(k);
        if (v) out[k] = v.slice(0, 120);
      });
    } catch (e) { /* an old browser without URLSearchParams still submits fine */ }
    return out;
  })();

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearAll();

    var consent = form.querySelector('input[name="sms_consent"]').checked;
    var phone = toE164(document.getElementById('phone').value);
    var bad = false;

    if (!phone) {
      show('err-phone', 'That does not look like a US mobile number.');
      document.getElementById('phone').classList.add('input-error');
      bad = true;
    }
    if (!consent) {
      show('err-consent', 'Please tick the box so we are allowed to text you.');
      bad = true;
    }

    if (bad) return;

    btn.disabled = true;
    btn.textContent = 'Saving...';

    var payload = {
      phone: phone,
      sms_consent: 'yes',
      website: form.querySelector('input[name="website"]').value,
      utm_source: utm.utm_source || null,
      utm_medium: utm.utm_medium || null,
      utm_campaign: utm.utm_campaign || null,
      utm_content: utm.utm_content || null
    };

    fetch('/bergen/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
      .then(function (r) {
        if (!r.ok || !r.body || !r.body.ok) {
          throw new Error((r.body && r.body.error) || 'That did not save.');
        }

        // Replace the form in place. The confirmation takes the space the form
        // had, so nothing jumps under a thumb that is still on the screen.
        form.hidden = true;
        done.hidden = false;
        done.scrollIntoView({ block: 'nearest' });

        // ON SUCCESS ONLY. A Lead fired on page load would count everybody who
        // bounced, and the campaign would be optimised toward traffic instead
        // of signups.
        if (typeof fbq === 'function') {
          fbq('track', 'Lead', { content_name: 'bergen_waitlist' });
        }
      })
      .catch(function (err) {
        // NEVER A SILENT FAILURE. Somebody who typed three fields and saw
        // nothing happen assumes it worked, and we lose them twice: once here
        // and again when no text ever arrives.
        btn.disabled = false;
        btn.innerHTML = original;
        show('err-form', err.message || 'That did not save. Try again in a moment.');
      });
  });
})();
</script>`;

module.exports = { pixel, script };
