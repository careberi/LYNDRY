'use strict';

// Keep a single set of guarded ops routes. Only the public address changes;
// the original /ops paths remain the internal contract for auth and the API.
function publicPath(url) {
  return typeof url === 'string' && /^\/ops(?=[/?#]|$)/.test(url)
    ? (url.replace(/^\/ops(?=[/?#]|$)/, '') || '/').replace(/^([?#])/, '/$1') : url;
}
function htmlUrls(html, publicOrigin = 'https://lyndry.com') {
  // One pass keeps /ops/partners (staff) distinct from /partners (public).
  // Hidden next values and message text are untouched. Script/API aliases
  // under /ops remain supported on the POS host.
  return html.replace(/(\b(?:href|action|src|data-url)=)(["'])(\/(?!\/)[^"']*)\2/g,
    (_, attr, quote, url) => {
      if (/^\/ops(?=[/?#]|$)/.test(url)) url = publicPath(url);
      else if (attr === 'href=' && /^\/(?:p|o|pay|shop|account|for-laundromats|partners)(?=[/?#]|$)/.test(url)) {
        url = publicOrigin.replace(/\/$/, '') + url;
      }
      return attr + quote + url + quote;
    });
}

function posHost({ host = 'pos.lyndry.com', publicHost = 'lyndry.com', publicOrigin = 'https://lyndry.com', redirectLegacy = false } = {}) {
  return function (req, res, next) {
    const incomingHost = String(req.headers.host || '').split(':')[0].toLowerCase();
    const onPos = incomingHost === host || incomingHost === 'pos.localhost';
    if (!onPos) {
      if (redirectLegacy && incomingHost === publicHost && /^(GET|HEAD)$/.test(req.method) && /^\/ops(?:[/?]|$)/.test(req.url)) {
        const send = res.send;
        let redirected = false;
        res.send = function (body) {
          if (!redirected && typeof body === 'string' && /^<!doctype html>/i.test(body.trimStart()) && res.statusCode < 400) {
            redirected = true;
            return res.redirect(302, 'https://' + host + publicPath(req.originalUrl));
          }
          return send.call(this, body);
        };
      }
      return next();
    }

    const browserUrl = req.originalUrl;
    const legacyPath = /^\/ops(?:[/?]|$)/.test(req.url);
    let canonicalRedirect = false;
    res.locals.posHost = true;
    const cookie = res.cookie;
    res.cookie = function (name, value, options = {}) {
      return cookie.call(this, name, value, options.path === '/ops' ? { ...options, path: '/' } : options);
    };
    const location = res.location;
    res.location = function (url) { return location.call(this, publicPath(url)); };
    const send = res.send;
    res.send = function (body) {
      if (typeof body === 'string' && /^<!doctype html>/i.test(body.trimStart())) {
        if (legacyPath && !canonicalRedirect && /^(GET|HEAD)$/.test(req.method) && res.statusCode < 400) {
          canonicalRedirect = true;
          return res.redirect(302, publicPath(browserUrl));
        }
        body = htmlUrls(body, publicOrigin);
      }
      if (req.path === '/ops/app.webmanifest' && typeof body === 'string') {
        const manifest = JSON.parse(body);
        body = JSON.stringify({ ...manifest, start_url: publicPath(manifest.start_url), scope: '/' });
      }
      return send.call(this, body);
    };
    const json = res.json;
    res.json = function (body) {
      if (req.path === '/ops/app.webmanifest' && body && typeof body === 'object') {
        body = { ...body, start_url: publicPath(body.start_url), scope: '/' };
      }
      return json.call(this, body);
    };

    // Static files and health keep their shared origin paths. No public
    // customer routes are mounted at the POS root: /customers is staff-only.
    if (!/^\/(?:ops(?:[/?]|$)|css(?:\/|$)|images(?:\/|$)|fonts(?:\/|$)|favicon[-.]|apple-touch-icon|app-icon-|health(?:[/?]|$))/.test(req.url)) {
      req.url = '/ops' + (req.url === '/' ? '' : req.url);
    }
    // Auth stores only internal /ops return paths, including query strings.
    req.originalUrl = req.url;
    next();
  };
}
module.exports = { posHost, publicPath, htmlUrls };
