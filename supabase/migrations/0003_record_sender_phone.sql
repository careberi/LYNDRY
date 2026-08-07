-- Record which number a message came from or went to.
--
-- Until now a message was linked to a person only through customer_id, which
-- is empty for anyone who isn't a customer yet. So when a stranger texted
-- LYNDRY and got the signup link, their number was not recorded anywhere —
-- someone tried the service, didn't sign up, and there was no way to know
-- they had ever been in touch.
--
-- That is a real loss: those are the warmest leads the business will get.

alter table messages
  add column if not exists phone text;

comment on column messages.phone is
  'The customer''s number: who an inbound message came from, or who an outbound one went to. Recorded even when there is no customer row yet.';

-- Everything already in the table belongs to a known customer, so their number
-- can be filled in from the customers table rather than left empty.
update messages m
   set phone = c.phone
  from customers c
 where m.customer_id = c.id
   and m.phone is null;

create index if not exists messages_phone_created_idx on messages (phone, created_at desc);
