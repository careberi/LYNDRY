# public/well-known

One file lives here, and it deliberately has no extension:

    apple-developer-merchantid-domain-association

## What it is

Apple's proof that Stripe is allowed to take Apple Pay on this domain. Every
site that offers Apple Pay serves one. It is a public claim rather than a
secret — Apple fetches it from every such site — so it belongs in the repo like
any other static asset.

Decoded, it is hex-encoded JSON with four keys: `pspId`, `version`, `createdOn`
and `signature`. **Nothing in it names a domain**, which is the thing worth
knowing: it is tied to Stripe's Apple merchant identity, not to lyndry.com, so
the one file works for every domain registered under our Stripe account.

## Why it is needed at all

A wallet button only appears on a domain Apple has verified. Until the card
field moved onto our own page, the only verified domain on the account was
`checkout.stripe.com`, and the hosted card page was on it — so Apple Pay came
free and nobody had to think about this. lyndry.com is a different domain as
far as Apple is concerned.

## Where it came from

Stripe publishes it at the same path on its own verified domain:

    https://checkout.stripe.com/.well-known/apple-developer-merchantid-domain-association

That is the same bytes the dashboard offers as a download, which is why there
was no download link to find. To refresh it:

```bash
curl -s -o public/well-known/apple-developer-merchantid-domain-association \
  https://checkout.stripe.com/.well-known/apple-developer-merchantid-domain-association
```

**If Apple Pay ever stops appearing, refresh this file first.** Stripe can
rotate it, and a stale copy fails silently — the button simply does not draw,
with nothing in any log to say why.

## How it is served

By an explicit route in `src/routes/web.js`, not a static mount: only
`public/css` and `public/og` are mounted, and exposing a whole directory to
reach one file is a worse trade than a route serving exactly that file.

With no file present the route returns a plain 404, which is the honest answer
and is what Stripe's verification reports — a much clearer failure than an
empty 200 that Apple would silently reject.

## The other half

Serving the file is not enough on its own. The domain also has to be added
under **Settings → Payments → Payment method domains** in the Stripe dashboard,
and **test and live mode are separate** — doing one does not do the other.
