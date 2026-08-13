'use strict';

const bags = require('../core/bags');

// ---------------------------------------------------------------------------
// Scanning a bag label with the phone's camera.
//
// THE CAMERA IS AN ACCELERATOR, NOT THE MECHANISM. Every scan field below is a
// plain text input inside a plain form that posts to the server. The camera
// fills that input and submits it. If the browser has no barcode support, if
// the driver refuses the camera permission, if the lens will not focus in a
// dark basement - the field is still there and the six characters are printed
// under the QR in 19pt type precisely so they can be read out and typed.
//
// That is what keeps the no-JavaScript rule on the driver's screens honest.
// The page still either worked or did not; the camera only saves typing.
//
// BarcodeDetector is used where it exists, which is Chrome on Android - the
// phone a driver actually has. Nothing is polyfilled and no scanning library
// is loaded: a megabyte of JavaScript to avoid typing six characters is a bad
// trade on a phone in a stairwell.
// ---------------------------------------------------------------------------

// A scan field: the input, the camera button, and the viewfinder.
//
// `name` is the form field; `action` is where the form posts. `autofocus`
// belongs on whichever field is the actual task on that screen.
function scanField({ action, name = 'code', label, hint, buttonLabel = 'Add', autofocus = false, hidden = '' }) {
  return `
  <form method="post" action="${action}" class="scan-form" style="margin:0;">
    ${hidden}
    <label class="eyebrow" for="scan-${name}" style="display:block;margin-bottom:8px;">${label}</label>

    <div style="display:flex;gap:10px;align-items:flex-start;">
      <input class="input input-lg scan-input" type="text" id="scan-${name}" name="${name}" required
             autocomplete="off" autocapitalize="characters" spellcheck="false"
             maxlength="12" placeholder="Code under the QR" ${autofocus ? 'autofocus' : ''}
             style="flex:1;min-width:0;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;">
      <button type="submit" class="btn btn-ink btn-lg">${buttonLabel}</button>
    </div>

    <!-- Hidden until the script confirms this browser can actually scan. A
         camera button that does nothing is worse than no camera button, and on
         an iPhone that is exactly what it would be - Safari has no
         BarcodeDetector.

         Inline display:none rather than the HTML hidden attribute. That
         attribute is only a display:none from the browser's own stylesheet,
         and .btn sets display itself, which beats it - so the button rendered
         anyway and did nothing when tapped. -->
    <button type="button" class="btn btn-outline btn-lg btn-full scan-open"
            style="margin-top:12px;display:none;">Scan with the camera</button>

    <div class="scan-stage" style="margin-top:12px;display:none;">
      <video class="scan-video" playsinline muted
             style="width:100%;border:2px solid var(--ink-900);border-radius:12px;background:var(--ink-900);"></video>
      <button type="button" class="btn btn-outline btn-full scan-close" style="margin-top:10px;">Stop the camera</button>
    </div>

    <p class="scan-note field-hint" style="margin-top:10px;">${hint}</p>
  </form>`;
}

// One script for every scan field on the page.
function scannerScript() {
  return `
<script>
(function () {
  'use strict';

  // No barcode support means no camera button. Everything still works by hand.
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices) return;

  var detector;
  try {
    detector = new BarcodeDetector({ formats: ['qr_code'] });
  } catch (e) {
    return;
  }

  // The QR holds a whole URL - https://lyndry.com/o/K3F9QP?t=... - so the code
  // has to be pulled back out of it. Falls back to treating the text as a bare
  // code, in case a sticker is ever printed with just the characters.
  function codeFrom(text) {
    var value = String(text || '').trim();
    var match = value.match(/\\/o\\/([0-9A-Za-z]+)/);
    return match ? match[1] : value;
  }

  document.querySelectorAll('.scan-form').forEach(function (form) {
    var open = form.querySelector('.scan-open');
    var close = form.querySelector('.scan-close');
    var stage = form.querySelector('.scan-stage');
    var video = form.querySelector('.scan-video');
    var input = form.querySelector('.scan-input');
    var note = form.querySelector('.scan-note');
    if (!open || !video || !input) return;

    var stream = null;
    var timer = null;

    function stop() {
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
      stage.style.display = 'none';
      open.style.display = '';
    }

    function tick() {
      if (!stream) return;
      detector
        .detect(video)
        .then(function (found) {
          if (found && found.length) {
            input.value = codeFrom(found[0].rawValue);
            // A short buzz, so a driver holding the phone at arm's length in a
            // noisy van knows it read something without looking.
            if (navigator.vibrate) navigator.vibrate(40);
            stop();
            form.submit();
            return;
          }
          timer = setTimeout(tick, 220);
        })
        .catch(function () {
          timer = setTimeout(tick, 400);
        });
    }

    open.addEventListener('click', function () {
      // environment = the back camera. Without it phones open the selfie one.
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
        .then(function (s) {
          stream = s;
          video.srcObject = s;
          stage.style.display = '';
          open.style.display = 'none';
          return video.play();
        })
        .then(function () { tick(); })
        .catch(function () {
          // Permission refused, or no camera. Say so once and get out of the
          // way - the field above still works.
          note.textContent = 'No camera available, so type the code instead.';
          open.style.display = 'none';
        });
    });

    if (close) close.addEventListener('click', stop);

    // Never leave the camera running behind a page the driver has left.
    window.addEventListener('pagehide', stop);
  });

  // The camera exists, so offer it. Anything that got this far has both
  // BarcodeDetector and getUserMedia.
  document.querySelectorAll('.scan-open').forEach(function (b) { b.style.display = ''; });
})();
</script>`;
}

// Six characters, in the alphabet the labels actually use.
function describeCodeFormat() {
  return `${bags.CODE_LENGTH} characters. O reads as zero and I or L as one, so a misread still finds the right bag.`;
}

module.exports = { scanField, scannerScript, describeCodeFormat };
