-- Record what the carrier said about each message we sent.
--
-- Our SMS provider accepting a message only means it was queued. What happened
-- after that — delivered, or rejected by the receiving carrier and why —
-- arrives later as a separate webhook, which we were ignoring.
--
-- Without this, "the customer says they never got it" is unanswerable. With
-- it, the carrier's own verdict and error code are sitting on the message.

alter table messages
  add column if not exists delivery_status text,
  add column if not exists delivery_error text,
  add column if not exists delivered_at timestamptz;

comment on column messages.delivery_status is
  'What the carrier reported: queued, sending, delivered, delivery_failed, sending_failed.';
comment on column messages.delivery_error is
  'The carrier''s reason when a message failed. This is where blocked or filtered traffic shows up.';

-- Finding failures is the whole point, so make that query cheap.
create index if not exists messages_delivery_status_idx
  on messages (delivery_status, created_at desc)
  where delivery_status is not null;
