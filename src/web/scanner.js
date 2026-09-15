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

// A scan field: the input, the camera button, and the note.
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
// THE BOX IS NOT DELETED, IT IS HIDDEN - and the script reveals it if there is
// no way to scan at all: a browser with no file capture, no camera. A driver at
// a counter with a dead camera has to have a way through, and that is the whole
// reason the rule exists. He cannot type INSTEAD of scanning; he can type when
// there is nothing to scan with.
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

    <!-- THE CAMERA IS THE PRIMARY CONTROL NOW, so it is the filled button and
         it comes first. Neil, 14 September: the photo is the main path.

         A file input with capture="environment" is the whole mechanism. It
         opens the phone's own camera - the real one, with the autofocus, the
         exposure and the torch - takes one still, and hands back an image.
         There is no permission prompt of ours to refuse and no live stream to
         keep alive, which is most of what used to go wrong.

         It is hidden and driven by the button so the label is ours and the
         control matches every other button on the screen. A bare file input
         says "Choose File" and looks like an upload. -->
    <input type="file" class="scan-shot" accept="image/*" capture="environment"
           style="display:none;" tabindex="-1" aria-hidden="true">

    <button type="button" class="btn btn-ink btn-lg btn-full scan-open"
            style="display:none;">Scan with camera</button>

    <label class="eyebrow" for="scan-${name}" style="display:block;margin:14px 0 8px;${
      cameraOnly ? 'display:none;' : ''
    }">${label}</label>

    <div class="scan-typed" style="display:${cameraOnly ? 'none' : 'flex'};gap:10px;align-items:flex-start;">
      <input class="input input-lg scan-input" type="text" id="scan-${name}" name="${name}" required
             autocomplete="off" autocapitalize="characters" spellcheck="false"
             maxlength="12" placeholder="Code under the QR" ${autofocus ? 'autofocus' : ''}
             style="flex:1;min-width:0;font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;">
      <button type="submit" class="btn btn-ink btn-lg">${buttonLabel}</button>
    </div>

    <!-- ALWAYS OFFERED, and not hidden behind anything. The camera app on the
         driver's phone is a better QR reader than ours will ever be, and it is
         the path that works when ours does not. Scanning there opens
         /o/<code>, which sends him back here with the code in the box. -->
    <p class="field-hint" style="margin-top:8px;">
      Or point your phone's camera at the QR and open the link.
    </p>

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
  // This runs first on purpose. A phone that cannot do anything else still
  // wants this path, and it is the path that does not depend on us decoding
  // anything at all.
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

  var native = null;
  try {
    if ('BarcodeDetector' in window) native = new BarcodeDetector({ formats: ['qr_code'] });
  } catch (e) {
    native = null;
  }

  // jsQR, fetched once and shared by every scan field on the page. Only ever
  // requested on a browser with no BarcodeDetector - which is every iPhone -
  // and only when a photo has actually been taken.
  //
  // IT DECODES A STILL NOW, NOT A VIDEO FRAME, and that is the whole point of
  // this change. The old loop fed it 640px frames off a live preview thirty
  // times a run, each one whatever the lens happened to be focused on. One
  // photo from the phone's own camera app is sharp, exposed, and as big as we
  // want it.
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

  // A photo, as something both decoders can read.
  function imageFrom(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return viaElement(file); });
    }
    return viaElement(file);
  }

  function viaElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }

  // jsQR over one still, at a given scale and crop.
  //
  // TWO PASSES, AND THE SECOND IS THE ONE THAT SAVES A BAD PHOTO. A driver
  // photographs a bag at arm's length and the tag is a small square in the
  // middle of a big picture; downscaling the whole frame to something jsQR can
  // chew through can leave the QR too few pixels to resolve. So the first pass
  // is the whole image, and the second is the middle of it at full detail.
  function readWith(jsQR, image, crop) {
    var w = image.width;
    var h = image.height;
    if (!w || !h) return null;

    var sx = 0, sy = 0, sw = w, sh = h;
    if (crop) {
      sw = Math.round(w / 2); sh = Math.round(h / 2);
      sx = Math.round((w - sw) / 2); sy = Math.round((h - sh) / 2);
    }

    // 1400px on the long side. Big enough for a tag that fills a fifth of the
    // frame, small enough that an older phone is not locked up for a second.
    var scale = Math.min(1, 1400 / Math.max(sw, sh));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));

    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var found = jsQR(pixels.data, pixels.width, pixels.height, {
      inversionAttempts: 'attemptBoth',
    });

    return found ? [found.data] : null;
  }

  // EVERY CODE IN THE PHOTO, NOT THE FIRST ONE. Two tags in one frame is a
  // thing that has to be refused rather than guessed at, so the count matters
  // and the decoder has to be asked for all of them.
  function decode(file) {
    return imageFrom(file).then(function (image) {
      if (native) {
        return native.detect(image).then(function (found) {
          return (found || []).map(function (f) { return f.rawValue; });
        });
      }

      return loadJsqr().then(function (jsQR) {
        // jsQR finds one code per pass. The crop pass is a second look at the
        // middle, not a second code - a duplicate is collapsed below.
        return readWith(jsQR, image, false) || readWith(jsQR, image, true) || [];
      });
    });
  }

  // The QR holds a whole URL - https://lyndry.com/o/K3F9QP?t=... - so the code
  // has to be pulled back out of it. Falls back to treating the text as a bare
  // code, in case a sticker is ever printed with just the characters.
  // WHAT THE CAMERA READ, TURNED BACK INTO WHAT IS PRINTED ON THE STICKER.
  //
  // Two shapes arrive here. A QR holds a URL - /o/<code>?t=<sig>&s=<number> -
  // and the sticker number is in the QUERY STRING, not the path. The human
  // line beside it reads L4XK92-2, hyphen and all.
  //
  // This used to return the bare code from a URL and throw the sticker number
  // away, and its character class had no hyphen in it, so the typed form
  // survived only by falling through untouched. Both now produce the SAME
  // thing: code-number, which is what the server parses.
  //
  // It does not validate. bags.parseCode() on the server is the one place that
  // decides whether a code is ours, and a second opinion written in a browser
  // would be a second copy of that rule.
  function codeFrom(text) {
    var value = String(text || '').trim();
    var match = value.match(/\\/o\\/([0-9A-Za-z-]+)/);
    if (!match) return value;

    var code = match[1];
    // The sticker number off the query string, put back on the end so the
    // box shows what the sticker itself says.
    var seq = value.match(/[?&]s=(\\d{1,2})/);
    return seq && code.indexOf('-') === -1 ? code + '-' + seq[1] : code;
  }

  // IS THIS EVEN ONE OF OURS?
  //
  // A narrower question than "is this code valid", and the difference is the
  // whole reason this is allowed to live in a browser. Validity is the server's
  // - bags.parseCode() decides it and a second copy here would be a second
  // rule. This only asks whether the thing in the photo belongs to LYNDRY at
  // all, because a driver photographing a wall of stickers in a laundromat can
  // easily catch somebody else's QR, and pasting a competitor's web address
  // into the box is not a decision to defer to the server.
  //
  // So: a URL of ours yields its code, any OTHER URL is refused outright, and
  // a bare token is passed through for the server to judge.
  function lyndryCode(text) {
    var value = String(text || '').trim();
    if (!value) return null;

    if (value.indexOf('/o/') !== -1) return codeFrom(value);
    if (value.indexOf('://') !== -1) return null;

    return value;
  }

  document.querySelectorAll('.scan-form').forEach(function (form) {
    var open = form.querySelector('.scan-open');
    var shot = form.querySelector('.scan-shot');
    var input = form.querySelector('.scan-input');
    var note = form.querySelector('.scan-note');

    function say(words) {
      if (!note) return;
      note.textContent = words;
      note.style.display = '';
    }

    // THE WAY THROUGH WHEN THERE IS NOTHING TO SCAN WITH. A camera-only form
    // hides the box so a code cannot simply be typed instead of scanned - but a
    // browser that cannot take a photo at all must not strand a driver at a
    // counter, so the box comes back then and only then.
    //
    // NOT ON A FAILED READ. A blurry photo is a reason to take another one, not
    // a reason to let somebody type their way past a step that exists to prove
    // the bag is in their hand. Neil's rule stands: typing must not become
    // available here merely because the photo scanner exists.
    function letHimType() {
      if (!form.classList.contains('scan-camera-only')) return;
      var typed = form.querySelector('.scan-typed');
      var label = form.querySelector('label.eyebrow');
      if (typed) typed.style.display = 'flex';
      if (label) label.style.display = '';
    }

    // A camera-only form shows its box once a real scan has filled it, so the
    // driver can see what he is about to confirm. That is not typing his way
    // past the rule - the code came off a photo.
    function reveal() {
      var typed = form.querySelector('.scan-typed');
      var label = form.querySelector('label.eyebrow');
      if (typed) typed.style.display = 'flex';
      if (label) label.style.display = '';
    }

    if (!open || !shot || !input) return;

    // NO FILE CAPTURE AT ALL. Nothing below can run, so a camera-only form
    // would be an empty card. Give the box back before anything else happens.
    var canCapture = 'capture' in document.createElement('input');
    if (!canCapture && !native) {
      letHimType();
      return;
    }

    open.style.display = '';

    open.addEventListener('click', function () {
      // Straight through to the phone's camera. The click is inside a real user
      // gesture, which is what iOS requires.
      say('');
      note.style.display = 'none';
      shot.click();
    });

    shot.addEventListener('change', function () {
      var file = shot.files && shot.files[0];

      // CANCELLED. He backed out of the camera, so the form is exactly as he
      // left it and nothing is said. Neil's rule: return unchanged, nothing
      // confirmed.
      if (!file) return;

      open.disabled = true;
      say('Reading the photo...');

      decode(file)
        .then(function (raw) {
          // Every LYNDRY code in the photo, the same one twice collapsed.
          var codes = [];
          (raw || []).forEach(function (text) {
            var code = lyndryCode(text);
            if (!code) return;
            code = code.toUpperCase();
            if (codes.indexOf(code) === -1) codes.push(code);
          });

          if (codes.length > 1) {
            // NEVER GUESS BETWEEN TWO TAGS. Which bag he is holding is the
            // entire question the step is asking.
            say('More than one tag in that photo. Take another with just the one bag in frame.');
            return;
          }

          if (!codes.length) {
            // ONE MESSAGE FOR TWO CAUSES, BECAUSE THE DECODER CANNOT TELL THEM
            // APART. jsQR - the decoder every iPhone gets, because Safari has
            // no BarcodeDetector - finds one QR per pass, and two tags in one
            // frame confuses it into finding neither. Tested: a photo with two
            // tags in it comes back empty rather than coming back twice.
            //
            // So it refuses, which is right, but it cannot honestly say WHY.
            // Claiming "no code" when there were two would send a driver
            // closer to a bag he has already filled the frame with. The
            // wording covers both, and the fix for both is the same photo.
            //
            // BarcodeDetector DOES return every code it sees, so an Android
            // driver gets the precise message above. The behaviour is identical
            // on both - nothing filled, nothing confirmed, take another photo -
            // which is what Neil's rule about the two platforms asks for.
            say('Could not read a tag. Take another with just the one bag in frame, closer and in better light - or open the QR with your phone camera.');
            return;
          }

          // FILLED, NOT SENT. The tap that follows is the driver saying this is
          // the bag in his hand, and it is the whole reason the step exists.
          // Nothing here submits the form, and nothing here binds a bag.
          input.value = codes[0];
          reveal();
          say('Read ' + codes[0] + '. Check it against the tag, then confirm.');

          // A short buzz, so a driver holding the phone at arm's length in a
          // noisy van knows it read something without looking.
          if (navigator.vibrate) navigator.vibrate(40);
        })
        .catch(function () {
          say('That photo could not be read. Try again, or open the QR with your phone camera.');
        })
        .then(function () {
          open.disabled = false;
          // Clear it so photographing the SAME bag twice still fires a change
          // event. Without this the second tap looks like nothing happened.
          try { shot.value = ''; } catch (e) {}
        });
    });
  });
})();
</script>`;
}

// Six characters, in the alphabet the labels actually use.
function describeCodeFormat() {
  return `${bags.CODE_LENGTH} characters. O reads as zero and I or L as one, so a misread still finds the right bag.`;
}

module.exports = { scanField, scannerScript, describeCodeFormat, scanReturn, CRUMB };
