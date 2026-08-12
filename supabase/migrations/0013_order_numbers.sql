-- Give every order a number a human can say out loud.
--
-- Orders have always had a UUID primary key, which is right for a database and
-- useless for a person: nobody reads "a70a7e4f-faca-41f5-9dfb-6f3a893a330a"
-- down the phone, writes it on a bag tag, or types it into a search box.
--
-- So: a plain incrementing number, starting at 1001 rather than 1. Partly so
-- the very first order is not obviously the very first order, and partly
-- because a four-digit number is a recognisable shape - #1042 reads as an
-- order number in a way that #7 does not.
--
-- The UUID stays as the primary key and every foreign key still points at it.
-- This column is only ever for showing to people.
--
-- Sequential does leak roughly how many orders we have done. At this size that
-- does not matter, and being able to say "order 1042" to a driver does.

create sequence if not exists order_number_seq start with 1001;

alter table orders
  add column if not exists order_number bigint;

-- Existing orders get numbers in the order they were actually created, so the
-- sequence reflects history rather than whatever order the update happened to
-- process rows in.
update orders o
   set order_number = nextval('order_number_seq')
  from (select id, row_number() over (order by created_at) as rn
          from orders
         where order_number is null) ranked
 where o.id = ranked.id
   and o.order_number is null;

alter table orders
  alter column order_number set default nextval('order_number_seq');

-- Both constraints only after the backfill, or the statements above would fail
-- on the rows that predate the column.
alter table orders
  alter column order_number set not null;

-- A unique index rather than a constraint so `if not exists` works and re-running
-- this migration is harmless.
create unique index if not exists orders_order_number_idx on orders (order_number);

-- The sequence is owned by the column, so dropping the column would drop it too
-- rather than leaving an orphan behind.
alter sequence order_number_seq owned by orders.order_number;

comment on column orders.order_number is
  'The number shown to people. The UUID id is still the key everything joins on; '
  'this exists so an order can be named out loud, on a bag tag or in a text.';
