Current development scope (28 September): see HANDOFF.md for the verified three-stage laundromat portal, delivery-photo proxy, 30-second status/ETA refresh, linked-order sync, and explicit real in-house return requests. The earlier sections below record initial adapter work. Third-party live dispatch and production activation remain disabled; spending approval is retired. Return creation/assignment has mocked contract and transaction coverage; no live return was requested during verification.

# Shipday integration — development only

## Implemented

The isolated CommonJS client at src/providers/couriers/shipday.js follows the official Shipday API reference supplied by Neil on 27 September 2026.

- Availability quotes do not create orders.
- Order creation and on-demand assignment are separate operations.
- Assignment obtains a new estimate and checks the supplied courier budget.
- Tracking reads on-demand details. Cancellation requires explicit confirmation.
- Writes are disabled unless the caller explicitly permits them.
- Requests have a timeout, never automatically retry mutations, and flag ambiguous mutation results for reconciliation.
- Unknown costs remain unknown; unsafe tracking URLs are discarded.
- Nine contract tests use mocked documented response shapes; no live delivery has been created.

## Not yet connected / not verified

This client is not registered as the application's active courier. The existing provider selector still chooses Uber, Uber test mode, or the existing fake provider. There is no claim that Shipday is operational in the POS yet.

Before enabling it, implement a durable creation/assignment ledger and recovery, provider-aware refresh/cancel for historical deliveries, POS controls, authenticated status reconciliation, and the connection between saved pricing quotes, booking, customer spending approval and actual-weight billing. Preserve the existing card/hold guards.

Availability fee is a courier estimate, not a verified all-in Shipday charge. The API separately exposes totalBillableAmount, shipdayCharge, processingFee, regulatoryFee and minBillableFee. Confirm the account's fee contract before using an estimate as the customer-facing total. Quotes with nonzero regulatoryFee or minBillableFee currently require review. Do not silently treat undisclosed platform charges as zero.

The five-minute availability freshness timestamp is LYNDRY's local policy, not a Shipday expiry guarantee. The API does not document expiry in this response.

The caller must persist the returned Shipday order ID before assignment. On a timeout, reconcile by the stable external order number; do not blindly create another order. Account-side automatic dispatch must be confirmed disabled before relying on order creation as an unassigned stage.

No API credentials, live dispatch, webhook authenticity, proof-of-delivery PIN retrieval, or production fee totals have been verified by these mocked tests.

## References

- https://docs.shipday.com/reference/shipday-api
- https://docs.shipday.com/reference/availability-1
- https://docs.shipday.com/reference/insert-delivery-order
- https://docs.shipday.com/reference/estimate
- https://docs.shipday.com/reference/assign
- https://docs.shipday.com/reference/details
- https://docs.shipday.com/reference/cancel
