-- ---------------------------------------------------------------------------
-- 0079 — a card saved on our own page, not on a page of Stripe's
-- ---------------------------------------------------------------------------
--
-- Neil: "Don't make add a card its own page. That's why it feels like a
-- surprise bill. On US checkout, address and card live in one flow."
--
-- The hosted version sends somebody to checkout.stripe.com and we store the
-- session id it hands back. Drawing the card field inside our own page instead
-- uses a SETUP INTENT, which is Stripe's other way of saying the same thing:
-- store a card, take no money. It has its own id, so the row needs its own
-- column for it.
--
-- WHY NOT REUSE stripe_session_id. A checkout session id starts "cs_" and a
-- setup intent "seti_", and putting the second in a column named for the first
-- is exactly the quiet drift this repo keeps a migration file to avoid: the
-- next person reading the column name would be wrong about what is in it, and
-- any query joining on it would be wrong without saying so.
--
-- BOTH STAY NULLABLE. A link is one or the other, never both, and every older
-- row is a session.
-- ---------------------------------------------------------------------------

alter table payment_links
  add column if not exists stripe_setup_intent_id text;

-- The webhook arrives knowing only Stripe's id, so this is the lookup that has
-- to be fast. Partial, because most rows will never have one.
create index if not exists payment_links_setup_intent_idx
  on payment_links (stripe_setup_intent_id)
  where stripe_setup_intent_id is not null;
