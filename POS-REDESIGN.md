# POS redesign — development handoff

Neil requested a modern wash-and-fold POS design on 27 September 2026, using the supplied CleanCloud screenshots for visual inspiration. This supersedes the old warehouse-terminal appearance for operations pages only.

## Scope implemented

- All staff operations pages inherit the POS layout and shared public/css/ops.css: left navigation, page context, light workspace, cards, consistent controls, tables, links and typography. Mobile navigation collapses; driver task screens retain their focused layout and large controls.
- Navigation retains existing permission and courier-model filters. No retail, dry-cleaning, inventory or payroll features are introduced.
- Existing forms, validation, payment, SMS, reminder, routing and cancellation behavior remain unchanged.
- pos.lyndry.com serves the existing guarded /ops routes at root paths. For example /ops/customers becomes /customers; /ops/orders/9006 becomes /orders/9006; the dispatch dashboard is /.
- HTML navigation and form targets, redirects, login cookies and app manifest are adapted on the POS host. Internal API aliases continue to work; POST requests are never redirected or replayed. Customer photo/payment/portal links stay on APP_BASE_URL.
- Local preview: localhost:3000/ops uses the current dev session. pos.localhost:3000 uses the new address layout and requires its own normal sign-in.

## Production activation remains pending

No DNS, hosting, production environment, main branch, commits or pushes were changed.

When Neil is ready to release after review and click testing:
1. Deploy the reviewed dev changes through the normal main release process.
2. Add pos.lyndry.com as a custom domain on the same Railway service; configure the DNS record Railway supplies and wait for valid HTTPS.
3. Test a normal staff sign-in, deep links, sign-out, role restrictions and PWA installation on the new host. Existing lyndry.com sessions do not transfer across hosts.
4. Set POS_REDIRECT_LEGACY=true on that service after HTTPS works. Successful browser HTML requests under lyndry.com/ops redirect to pos.lyndry.com; JSON endpoints and POST actions retain compatibility. Unauthenticated deep links may pass through the old login redirect before reaching the POS login.
5. Roll back the browser redirect by disabling that setting if necessary. Keep both routes while existing bookmarks/integrations migrate.

Do not change APP_BASE_URL to the POS domain: public customer/payment/SMS links must remain on lyndry.com. Grok review and Neil's real-flow click test are still required before release.
