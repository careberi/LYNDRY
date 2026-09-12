'use strict';

const sitePopup = require('../core/site-popup');
const { site } = require('./site');
const { escapeHtml, icon } = require('./layout');

// ---------------------------------------------------------------------------
// The offer popup, as markup.
//
// The decision about WHETHER to show one, and what it may say, is in
// src/core/site-popup.js. This file only draws it. Same split as everywhere
// else here: core decides, web renders.
//
// THE FORM IS THE HOME PAGE'S FORM, down to the honeypot and the wording of the
// consent box. It posts to POST /start and lands on /start/sent, so there is no
// second path into customers, no second consent record and no second throttle
// to keep in step. The one field the hero does not have is `from`, which says
// which box somebody typed into: the route turns that into a consent source of
// WEB_POPUP and refuses to take the word of anything else.
//
// IT IS A PLAIN FORM. A script opens the dialog, and from that moment on
// nothing here needs scripting: no fetch, no validation of our own, no spinner.
// A phone that loses signal between opening it and pressing the button gets the
// browser's own error page rather than a dialog that swallowed the submission.
// ---------------------------------------------------------------------------

// The dialog, or an empty string when there is nothing to show. Async because
// working out the offer reads the settings row and the live promotion.
async function htmlFor(req) {
  const offer = await sitePopup.forRequest(req);
  return offer ? markup(offer) : '';
}

function markup(offer) {
  const terms = (offer.terms || []).map((t) => `<li>${escapeHtml(t)}</li>`).join('');

  return `
<div class="ly-pop" id="ly-pop" role="dialog" aria-modal="true" aria-labelledby="ly-pop-title">
  <div class="ly-pop-sheet" tabindex="-1">

    <button type="button" class="ly-pop-close" id="ly-pop-close" aria-label="Close this offer">
      &times;
    </button>

    <p class="eyebrow eyebrow-brand" style="margin:0 0 10px;">New customers</p>

    <!-- The promotion's own blurb, which is the sentence Neil typed on the
         promotions page and the same one the AI is allowed to repeat. Nothing
         here writes an offer of its own. -->
    <h2 class="ly-pop-title" id="ly-pop-title">${escapeHtml(offer.headline)}</h2>

    <p class="ly-pop-lede">
      Pop your mobile number in and we'll text you straight back. The discount
      lands on your account by itself, so there's no code to remember and
      nothing to type when you book.
    </p>

    <form action="/start" method="post">
      <!-- The honeypot, same as the hero. A person never sees this; something
           filling every field in the form does. Handled in POST /start. -->
      <div aria-hidden="true" style="position:absolute;left:-9999px;">
        <label for="popWebsite">Website</label>
        <input id="popWebsite" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>

      <!-- Which box this was. Checked against a list in the route: a hidden
           field is the visitor's to edit, so it may choose between two known
           doors and may never name a consent source of its own. -->
      <input type="hidden" name="from" value="popup">

      <div class="ly-pop-row">
        <div class="ly-pop-field">
          <label for="popPhone" class="sr-only">Your mobile number</label>
          <input id="popPhone" name="phone" type="tel" autocomplete="tel" required
                 class="input input-lg" placeholder="Your mobile number">
        </div>
        <div style="flex:0 0 auto;">
          <button type="submit" class="btn btn-ink btn-lg btn-full">
            Text me ${icon('arrow-right', '20')}
          </button>
        </div>
      </div>

      <!-- The consent box, in the one set of words this site uses. Rendered
           from site.smsConsent rather than typed here: a carrier comparing two
           forms expects to read the same sentence, and they drifted once
           already. It starts unticked and must stay that way. -->
      <label class="check" style="margin-top:16px;">
        <input type="checkbox" name="sms_consent" value="yes" required>
        <span class="check-box">${icon('check', '16')}</span>
        <span class="check-text">
          ${escapeHtml(site.smsConsent)}
          See our <a href="/privacy">Privacy Policy</a> and
          <a href="/sms-terms">SMS Terms</a>.
        </span>
      </label>

      <p class="helper helper-brand" style="margin-top:14px;">
        One text back &middot; no spam &middot; reply STOP any time
      </p>
    </form>

    ${terms ? `<ul class="ly-pop-terms">${terms}</ul>` : ''}
  </div>
</div>

<script>
  (function () {
    var pop = document.getElementById('ly-pop');
    if (!pop) return;

    var sheet = pop.querySelector('.ly-pop-sheet');
    var shutter = document.getElementById('ly-pop-close');
    var wasFocused = null;
    var open = false;

    // Same cookie the server sets on a submission, so closing it and using it
    // are one answer to one question: this browser has had its turn.
    var remember = function () {
      var secure = window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie =
        '${sitePopup.COOKIE}=1; Max-Age=${sitePopup.COOKIE_DAYS * 24 * 60 * 60}; Path=/; SameSite=Lax' + secure;
    };

    var show = function () {
      if (open) return;
      open = true;
      wasFocused = document.activeElement;
      pop.classList.add('is-open');
      document.body.classList.add('ly-pop-locked');
      if (sheet) sheet.focus();
    };

    var hide = function () {
      if (!open) return;
      open = false;
      pop.classList.remove('is-open');
      document.body.classList.remove('ly-pop-locked');
      remember();
      // Back where they were. Somebody who was half way down the page and
      // pressed Escape should not find the focus ring at the top of it.
      if (wasFocused && wasFocused.focus) wasFocused.focus();
    };

    if (shutter) shutter.addEventListener('click', hide);

    // The scrim, but not the card: a click that started inside the dialog and
    // drifted out while selecting text is not somebody asking to close it.
    pop.addEventListener('mousedown', function (e) {
      if (e.target === pop) hide();
    });

    document.addEventListener('keydown', function (e) {
      if (!open) return;

      if (e.key === 'Escape') {
        hide();
        return;
      }

      // Keep Tab inside while it is open. A dialog you can tab out of leaves
      // somebody on a keyboard typing into a page they cannot see.
      if (e.key !== 'Tab') return;

      var focusable = sheet.querySelectorAll(
        'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    window.setTimeout(show, ${sitePopup.SHOW_AFTER_MS});
  })();
</script>`;
}

module.exports = { htmlFor, markup };
