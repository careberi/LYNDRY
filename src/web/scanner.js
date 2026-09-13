'use strict';

const bags = require('../core/bags');
const { CSS_BASE } = require('./assets');

// The crumb a driver's scan screen leaves so a code scanned with the phone's
// own camera knows where to come back to. Fifteen minutes: long enough for a
// driver to find the tag on a bag, short enough that it is not still lying
// around next time he opens a sticker on a different job.
const CRUMB = 'ly_scan';
const CRUMB_MINUTES = 15;

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

// ---------------------------------------------------------------------------
// SCANNING WITH THE PHONE'S OWN CAMERA, WHICH IS THE ONE THAT ALWAYS WORKS.
//
// Neil, 12 September: the in-page scanner "doesn't read the code", and his fix
// is the one the laundromat has always used - point the phone's real camera at
// the QR, let it open the URL, and take the code out of that.
//
// It is the right answer whatever is wrong with the in-page decoder, and that
// is the point of it. The camera app is the best QR reader on any phone: it has
// the autofocus, the exposure, the torch and years of tuning that a canvas and
// 250 KB of JavaScript cannot match. Our decoder stays as the one-tap path when
// it works; this is the one that cannot not work.
//
// HOW IT HANGS TOGETHER, IN THREE MOVES:
//
//   1. Any driver screen with a scan box on it drops a crumb - ly_scan, the
//      path he is standing on.
//   2. He scans with the camera app, which opens https://lyndry.com/o/<code>.
//      That page is the laundromat's, and for anybody else it still is.
//   3. Seeing the crumb, it sends him straight back to the screen he came from
//      with ?code=<code> on the end, and the box is filled in when he lands.
//
// IT FILLS THE BOX; IT DOES NOT PRESS THE BUTTON. Neil's words were "determine
// what code should be entered into the entry box", and he is right to stop
// there: the tap he still makes is the driver saying this is the bag in his
// hand, which is the whole reason the step exists.
//
// AND IT NEVER ACTS ON A GET. A scan that bound a tag by being opened would
// bind it again on a refresh or a back button, which is exactly what ?done= and
// ?problem= exist to prevent everywhere else in ops.
//
// THE CRUMB IS NOT A CREDENTIAL AND IS NOT TREATED AS ONE. It holds a path and
// nothing else, it only ever sends somebody to a page that will ask them to
// sign in on its own, and it is refused unless it starts with /ops/ - without
// that check this route would be an open redirector on our own domain, which is
// a ready-made phishing link. It deliberately does NOT depend on the ops
// session cookie being sent: that one is SameSite=Strict, and whether a browser
// hands a Strict cookie to a link opened from the camera app is not something
// to bet a driver's afternoon on.
// ---------------------------------------------------------------------------

// Where a scanned code should be handed back to, or null if nowhere safe.
function scanReturn(crumb, code) {
  const path = String(crumb || '').trim();
  const clean = String(code || '').trim();

  if (!path || !clean) return null;

  // A path on this site, under /ops, and nothing clever. No scheme, no host, no
  // protocol-relative "//evil.example" - each of which would turn this into a
  // redirect somebody could aim anywhere.
  if (!path.startsWith('/ops/')) return null;
  if (path.startsWith('//')) return null;
  if (path.includes('://')) return null;
  if (path.includes('\\')) return null;

  // The code is ours to trust only as far as its shape: it came out of a URL
  // somebody pointed a camera at.
  if (!/^[0-9A-Za-z-]{1,16}$/.test(clean)) return null;

  const [bare, query = ''] = path.split('?');

  // Any code already on the crumb is last scan's, so it goes rather than
  // stacking up.
  const kept = query
    .split('&')
    .filter((pair) => pair && !pair.startsWith('code='))
    .join('&');

  return `${bare}?${kept ? `${kept}&` : ''}code=${encodeURIComponent(clean)}`;
}

// A scan field: the input, the camera button, and the viewfinder.
//
// `name` is the form field; `action` is where the form posts. `autofocus`
// belongs on whichever field is the actual task on that screen.
// cameraOnly: the code cannot be typed, it has to be scanned.
//
// Neil's call on the bag coming back out of a laundromat: typing the number is
// not proof he is holding that bag, and the sticker is right there. CLAUDE.md's
// rule is that the camera is an accelerator and never the mechanism, and this is
// the one deliberate exception to it.
//
// THE BOX IS NOT DELETED, IT IS HIDDEN - and the script reveals it if the camera
// cannot start: permission refused, no camera, a browser that cannot decode. A
// driver at a counter with a dead camera has to have a way through, and that is
// the whole reason the rule exists. He cannot type INSTEAD of scanning; he can
// type when there is nothing to scan with.
function scanField({
  action,
  name = 'code',
  label,
  hint,
  buttonLabel = 'Add',
  autofocus = false,
  hidden = '',
  cameraOnly = false,
}) {
  return `
  <form method="post" action="${action}" class="scan-form${
    cameraOnly ? ' scan-camera-only' : ''
  }" style="margin:0;">
    ${hidden}
    <label class="eyebrow" for="scan-${name}" style="display:block;margin-bottom:8px;${
      cameraOnly ? 'display:none;' : ''
    }">${label}</label>

    <div class="scan-typed" style="display:${cameraOnly ? 'none' : 'flex'};gap:10px;align-items:flex-start;">
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
            style="margin-top:${cameraOnly ? '0' : '12'}px;display:none;">Scan with the camera</button>

    <!-- ALWAYS OFFERED, and not hidden behind anything. The camera app on the
         driver's phone is a better QR reader than ours will ever be, and it is
         the path that works when ours does not. Scanning there opens
         /o/<code>, which sends him back here with the code in the box. -->
    <p class="field-hint" style="margin-top:8px;">
      Or point your phone's camera at the QR and open the link.
    </p>

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

  // --- THE PHONE'S OWN CAMERA, WHICH IS THE ONE THAT ALWAYS WORKS ---------
  //
  // This runs before the early return below on purpose. A phone with no
  // getUserMedia at all still wants this path, and it is the path that does not
  // depend on us decoding anything.
  var forms = document.querySelectorAll('.scan-form');

  if (forms.length) {
    // Leave a crumb so a code scanned in the camera app knows where to come
    // back to. A path and nothing else; /o/<code> refuses anything not under
    // /ops, and the page it lands on asks for a sign-in on its own.
    try {
      document.cookie =
        'ly_scan=' + encodeURIComponent(location.pathname + location.search) +
        '; Max-Age=900; Path=/; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) {
      // A browser refusing cookies costs the shortcut and nothing else.
    }

    // And if we have just come back from one, put it in the box. FILLED, NOT
    // SENT: the tap that follows is the driver saying this is the bag in his
    // hand, which is the whole reason the step exists.
    var came = null;
    try {
      came = new URLSearchParams(location.search).get('code');
    } catch (e) {
      came = null;
    }

    if (came) {
      forms.forEach(function (form) {
        var box = form.querySelector('.scan-input');
        if (!box || box.value) return;
        box.value = came.toUpperCase();

        // A camera-only form hides its box so a code cannot be typed INSTEAD of
        // scanned. This code came off a real scan, so the box is shown: he is
        // confirming a bag, not typing his way past the rule.
        var typed = form.querySelector('.scan-typed');
        var label = form.querySelector('label.eyebrow');
        if (typed) typed.style.display = 'flex';
        if (label) label.style.display = '';
      });
    }
  }

  // No camera API means no in-page camera button. Everything above still works,
  // and so does typing.
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

  // NO CAMERA API IN THIS BROWSER AT ALL. Nothing below will run, so a
  // camera-only form would show a driver an empty card. Give the box back
  // before anything else happens.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.querySelectorAll('.scan-form.scan-camera-only').forEach(function (form) {
      var typed = form.querySelector('.scan-typed');
      var label = form.querySelector('label.eyebrow');
      if (typed) typed.style.display = 'flex';
      if (label) label.style.display = '';
    });
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

    // THE WAY THROUGH WHEN THERE IS NOTHING TO SCAN WITH. A camera-only form
    // hides the box so a code cannot simply be typed instead of scanned - but a
    // refused permission or a dead camera must not strand a driver at a counter,
    // so the box comes back the moment scanning turns out to be impossible.
    function letHimType() {
      if (!form.classList.contains('scan-camera-only')) return;
      var typed = form.querySelector('.scan-typed');
      var label = form.querySelector('label.eyebrow');
      if (typed) typed.style.display = 'flex';
      if (label) label.style.display = '';
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
          letHimType();
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
          letHimType();
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

module.exports = { scanField, scannerScript, describeCodeFormat, scanReturn, CRUMB };
