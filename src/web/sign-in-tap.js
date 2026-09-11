'use strict';

// ---------------------------------------------------------------------------
// NOBODY IS SIGNED IN UNTIL THEY TAP "SIGN IN". BOTH SIGN-INS.
//
// Neil, 11 September: "I shouldn't be able to enter the code and for the
// website to automatically refresh and then let me get into the back end ...
// without me clicking the sign in button. That has to be a requirement."
//
// Nothing in our pages submits that form, so it was the browser or the phone
// sending it on once the code was in. The code box is marked
// autocomplete="one-time-code", which is what lets a phone offer the texted code
// above the keyboard, and a form whose only box has just been filled can be sent
// the same way pressing Go sends it. Whichever it was, the fix below does not
// depend on knowing.
//
// The box keeps autocomplete="one-time-code": filling the code in for you is
// useful. What changes is what counts as sending it:
//
//   ON THE PAGE    a click on the button itself - a finger or a mouse, or Enter
//                  or Space while the BUTTON has focus - marks the form as
//                  tapped. Enter in the code box, or the phone submitting the
//                  form, is neither, and the form stays put with a line saying
//                  "Tap Sign in to finish".
//   ON THE SERVER  a code that arrives without that mark is not checked at all -
//                  no attempt used up - and the page comes back with the code
//                  still in the box, waiting for the tap. A browser that
//                  submits the form without firing its submit event is stopped
//                  here rather than on the page.
//
// SIGNING IN NOW NEEDS JAVASCRIPT, and that is the price of the requirement:
// without a script there is no way to tell a tap from a browser submitting on
// its own. The page says so in a <noscript> rather than failing silently.
// ---------------------------------------------------------------------------

const FIELD = 'tapped';

function wasTapped(body) {
  return String((body || {})[FIELD] || '') === 'yes';
}

// The hidden mark, the line that appears when the form was sent without a tap,
// and the script that decides. Goes inside the <form>, after the button.
function tapGate() {
  return `
    <input type="hidden" name="${FIELD}" value="">
    <p data-tap-hint role="status"
       style="display:none;margin:14px 0 0;font-size:16px;line-height:1.5;font-weight:600;color:var(--ink-900);">
      Tap <strong>Sign in</strong> to finish.
    </p>
    <noscript>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.5;color:var(--ink-700);">
        Signing in needs JavaScript switched on in your browser.
      </p>
    </noscript>
    <script>
    (function () {
      var script = document.currentScript;
      var form = script && script.closest('form');
      if (!form) return;
      var button = form.querySelector('[data-sign-in]');
      var mark = form.querySelector('input[name="${FIELD}"]');
      var hint = form.querySelector('[data-tap-hint]');
      if (!button || !mark) return;

      button.addEventListener('click', function (e) {
        // detail counts real clicks and taps; it is 0 for the click a browser
        // fires when Enter is pressed in the code box. Enter or Space on the
        // button itself also reads 0, and is allowed because the button has
        // focus - that is somebody choosing to sign in with a keyboard.
        mark.value = e.detail > 0 || document.activeElement === button ? 'yes' : '';
      });

      form.addEventListener('submit', function (e) {
        if (mark.value === 'yes') return;
        e.preventDefault();
        if (hint) hint.style.display = 'block';
      });
    })();
    </script>`;
}

module.exports = { FIELD, wasTapped, tapGate };
