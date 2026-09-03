'use strict';

const bags = require('../core/bags');
const { CSS_BASE } = require('./assets');

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
// TWO DECODERS, AND WHICH ONE YOU GET DEPENDS ON YOUR PHONE.
//
// Chrome on Android has BarcodeDetector built in: no download, and the decoding
// happens in the browser's own C++. That is used wherever it exists.
//
// SAFARI HAS NEVER HAD IT, so on an iPhone the camera button used to hide
// itself and the driver was left typing six characters. That is a fine fallback
// and a poor primary, and it is what Neil was looking at when he asked why this
// was not a scan. So where BarcodeDetector is missing, jsQR is fetched instead
// and fed frames off a canvas.
//
// IT IS FETCHED ONLY WHEN THE CAMERA IS ACTUALLY OPENED, and only on the phones
// that need it. An Android driver never downloads a byte of it, and neither
// does anybody who never taps the button. The old note here said a megabyte of
// JavaScript to save typing six characters was a bad trade - which was right
// about a megabyte on every page load, and wrong about 250 KB, cached for a
// year, on the one tap that needs it.
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
         camera button that does nothing is worse than no camera button. It now
         shows on an iPhone too, because jsQR covers what Safari lacks.

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

    <!-- The note is always in the markup even when there is nothing to say,
         because the script writes camera failures into it. Hidden rather than
         absent, so querySelector still finds it; say() below unhides it. -->
    <p class="scan-note field-hint" style="margin-top:10px;${hint ? '' : 'display:none;'}">${
      hint || ''
    }</p>
  </form>`;
}

// One script for every scan field on the page.
function scannerScript() {
  return `
<script>
(function () {
  'use strict';

  // No camera at all means no camera button. Everything still works by hand.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

  var native = null;
  try {
    if ('BarcodeDetector' in window) native = new BarcodeDetector({ formats: ['qr_code'] });
  } catch (e) {
    native = null;
  }

  // jsQR, fetched once and shared by every scan field on the page. Only ever
  // requested on a browser with no BarcodeDetector, and only when somebody
  // actually opens the camera.
  var jsqrLoading = null;

  function loadJsqr() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (jsqrLoading) return jsqrLoading;

    jsqrLoading = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = ${JSON.stringify(`${CSS_BASE}/vendor/jsqr.js`)};
      el.onload = function () { resolve(window.jsQR); };
      el.onerror = function () { reject(new Error('jsqr')); };
      document.head.appendChild(el);
    });

    return jsqrLoading;
  }

  // ONE ANSWER TO "WHAT IS IN FRONT OF THE CAMERA", whichever decoder is doing
  // the work. Native gets the video element straight; jsQR needs pixels, so a
  // frame is drawn to a canvas first.
  //
  // The canvas is capped at 640px on its long side. A modern phone camera hands
  // back 1080p or better, and decoding four times the pixels is four times the
  // work for no more accuracy at the distance somebody holds a bag tag.
  function decode(video, canvas) {
    if (native) {
      return native.detect(video).then(function (found) {
        return found && found.length ? found[0].rawValue : null;
      });
    }

    return loadJsqr().then(function (jsQR) {
      var w = video.videoWidth;
      var h = video.videoHeight;
      if (!w || !h) return null;

      var scale = Math.min(1, 640 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);

      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var found = jsQR(pixels.data, pixels.width, pixels.height, {
        inversionAttempts: 'dontInvert',
      });

      return found ? found.data : null;
    });
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
    function say(words) {
      if (!note) return;
      note.textContent = words;
      note.style.display = '';
    }
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

    var canvas = document.createElement('canvas');

    function tick() {
      if (!stream) return;
      decode(video, canvas)
        .then(function (raw) {
          if (raw) {
            input.value = codeFrom(raw);
            // A short buzz, so a driver holding the phone at arm's length in a
            // noisy van knows it read something without looking.
            if (navigator.vibrate) navigator.vibrate(40);
            stop();
            form.submit();
            return;
          }
          // Slower without the native decoder: jsQR is doing real work on the
          // main thread, and hammering it makes the video stutter, which makes
          // it HARDER to hold the tag steady in frame.
          timer = setTimeout(tick, native ? 220 : 320);
        })
        .catch(function () {
          say('The scanner could not start, so type the code instead.');
          stop();
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
          say('No camera available, so type the code instead.');
          open.style.display = 'none';
        });
    });

    if (close) close.addEventListener('click', stop);

    // Never leave the camera running behind a page the driver has left.
    window.addEventListener('pagehide', stop);
  });

  // A camera and a decoder, one way or the other. Offer the button.
  document.querySelectorAll('.scan-open').forEach(function (b) { b.style.display = ''; });
})();
</script>`;
}

// Six characters, in the alphabet the labels actually use.
function describeCodeFormat() {
  return `${bags.CODE_LENGTH} characters. O reads as zero and I or L as one, so a misread still finds the right bag.`;
}

module.exports = { scanField, scannerScript, describeCodeFormat };
