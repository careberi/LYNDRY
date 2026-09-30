# Development Google address setup

Status as of 2026-09-30: active on localhost:3002 in development. Project lyndry-development has billing and the three required APIs enabled. Separate API-restricted keys are in ignored .env; the browser key also restricts referrers to http://localhost:3002/*. Live Google suggestions, keyboard selection, town/ZIP parsing, server validation and fabricated-address rejection passed. Production remains forced off. Monthly billing alerts at $5/$9/$10 exclude promotional credits; this is not a spending cap. Cloud Address Validation quotas displayed as non-adjustable. The server key has no IP restriction pending stable development egress.

1. Create a Google Cloud project and link a billing account. Neil must enter payment details and accept terms.
2. Enable Maps JavaScript API, Places API (New), and Address Validation API.
3. Create a browser key restricted to Maps JavaScript API and Places API (New), with website restrictions for http://localhost:3002/* and the exact hosted development URL if needed. Never use the server key here.
4. Create a separate server key restricted to Address Validation API. Add an IP restriction when the development server has a stable egress IP. Set quotas and billing alerts before activation.
5. Save keys directly into the local untracked .env: GOOGLE_MAPS_BROWSER_KEY and GOOGLE_ADDRESS_SERVER_KEY. Set GOOGLE_ADDRESS_ENABLED=true and restart development. Never put key values in chat, Obsidian, or Git.
6. Test actual address suggestions, keyboard selection, town and ZIP filling, edited fields, invalid text, API failures and direct /quote requests. An approximate or corrected address must not silently receive a price.

Google attribution is explicitly approved by Neil. The official widget supplies it. Address validation does not establish service coverage; existing coverage checks still apply. The feature is forced off for the production database. This implementation covers the public pricing quote, not authenticated booking address entry.

References:
https://developers.google.com/maps/documentation/javascript/place-autocomplete-new
https://developers.google.com/maps/documentation/address-validation/requests-validate-address

The Google-enabled UI has one search box and an optional apartment/unit field. Parsed street, town, ZIP and state are hidden; edits invalidate selection. Google subpremise fills the unit when supplied; otherwise users enter it themselves. Units are included in server validation and the quote request.
