# public/well-known

One file goes in here and it has no extension:

    apple-developer-merchantid-domain-association

## What it is

Apple's proof that we own lyndry.com. Every site that offers Apple Pay serves
one. It is a public claim, not a secret — Apple fetches it from every such site
— so it belongs in the repo like any other static asset.

## Why it is needed at all

A wallet button only appears on a domain Stripe has verified. Until the card
field moved onto our own page, the only verified domain on the account was
`checkout.stripe.com`, and the hosted card page was on it — so Apple Pay came
free and nobody had to think about this. lyndry.com is a different domain as
far as Apple is concerned.

## Getting it

1. https://dashboard.stripe.com/settings/payment_method_domains
2. Add domain, `lyndry.com`
3. Stripe offers the file to download. Save it into this folder, keeping the
   name exactly as it is with no `.txt` on the end
4. Commit and deploy
5. Back in Stripe, press verify

It is served by the route in `src/routes/web.js` at
`/.well-known/apple-developer-merchantid-domain-association`. Until the file is
here that path returns 404, which is the honest answer and is what Stripe's
verification will report.

**Test and live mode are registered separately.** Doing it in one does not do
the other.
