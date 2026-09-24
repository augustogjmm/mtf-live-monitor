-- v3.5.20 reconciliation / append-only hardening
-- Applied to project swhfftkhqmbtmbnoskoj on 2026-09-24.
-- Purpose: preserve operational history across resets, restore the user-requested stats cut,
-- prevent duplicate setup recreation and expose invalidated/recovered evidence.

create table if not exists public.mtf_repair_audit (
  id bigint generated always as identity primary key,
  repaired_at timestamptz not null default now(),
  repair_code text not null,
  snapshot jsonb not null
);
alter table public.mtf_repair_audit enable row level security;
revoke all on public.mtf_repair_audit from anon, authenticated;
grant select,insert on public.mtf_repair_audit to service_role;

-- The legitimate statistics reset is epoch 8 (2026-09-24 15:13 Argentina).
update public.mtf_stats_epochs set active=false where active=true;
update public.mtf_stats_epochs set active=true where id=8;
create unique index if not exists mtf_stats_epochs_one_active
  on public.mtf_stats_epochs ((active)) where active=true;

-- Canonical pre-reset tracking recovered from Telegram evidence.
update public.mtf_signals
set signal_time='2026-09-24 17:19:01+00',
    context=(context-'stats_epoch_excluded') || jsonb_build_object(
      'stats_epoch_excluded',true,'tracking_origin','RECOVERED_PRE_RESET_TELEGRAM',
      'original_confirmed_at','2026-09-24T17:20:01Z',
      'original_signal_time','2026-09-24T17:19:01Z','recovered_from','telegram_export_20260924'
    ),
    updated_at=now()
where id=75;

update public.mtf_signals
set signal_time='2026-09-24 16:34:05+00',
    context=(context-'stats_epoch_excluded') || jsonb_build_object(
      'stats_epoch_excluded',true,'tracking_origin','RECOVERED_PRE_RESET_TELEGRAM',
      'original_confirmed_at','2026-09-24T16:37:01Z',
      'original_signal_time','2026-09-24T16:34:05Z','recovered_from','telegram_export_20260924'
    ),
    updated_at=now()
where id=77;

-- Post-reset recreations are audit rows only.
update public.mtf_signals
set source='ARCHIVE_DUPLICATE',
    context=context || jsonb_build_object(
      'audit_duplicate',true,
      'duplicate_of_signal_id',case when id=79 then 75 else 77 end,
      'duplicate_reason','post_reset_recreation_of_existing_open_setup'
    ),
    updated_at=now()
where id in (79,80);

-- Stable dedupe is independent from strategy_version.
create unique index if not exists mtf_signals_forward_setup_rank_stable_uq
  on public.mtf_signals (market,symbol,((context->>'setup_id')),((context->>'entry_rank')))
  where source='FORWARD' and context ? 'setup_id' and context ? 'entry_rank';

-- Permanent Telegram idempotency ledger.
revoke all on public.mtf_alert_delivery_ledger from anon, authenticated;
revoke delete,update,truncate on public.mtf_alert_delivery_ledger from service_role;
grant select,insert on public.mtf_alert_delivery_ledger to service_role;

create table if not exists public.mtf_recovered_events (
  id bigint generated always as identity primary key,
  event_time timestamptz not null,
  event_type text not null,
  market text,
  symbol text not null,
  direction text,
  entry numeric,
  level numeric,
  payload jsonb not null default '{}'::jsonb,
  source text not null,
  recovered_at timestamptz not null default now(),
  unique(source,event_time,event_type,symbol)
);
alter table public.mtf_recovered_events enable row level security;
revoke all on public.mtf_recovered_events from anon, authenticated;
grant select,insert on public.mtf_recovered_events to service_role;

insert into public.mtf_recovered_events(event_time,event_type,market,symbol,direction,entry,level,payload,source)
values
 ('2026-09-24 03:16:00+00','SL','crypto','LTC','SHORT',65.53,66.74397035,
  '{"move_pct":-1.85,"note":"Invalidación del nivel de entrada.","scope":"PRE_STAT_RESET"}','USER_TELEGRAM_EXPORT_20260924'),
 ('2026-09-24 06:33:00+00','TP1','crypto','GRAM','LONG',1.39225,1.43275,
  '{"move_pct":2.91,"stop":1.28227982,"tp2":1.46825,"scope":"PRE_STAT_RESET"}','USER_TELEGRAM_EXPORT_20260924'),
 ('2026-09-24 09:35:00+00','TP1','crypto','ETH','SHORT',2704.5925,2617.07,
  '{"move_pct":3.24,"stop":2882.84573992,"tp2":2562.4225,"scope":"PRE_STAT_RESET"}','USER_TELEGRAM_EXPORT_20260924'),
 ('2026-09-24 16:37:01+00','ENTRY','merval','PAMP','LONG',79.22250175,null,
  '{"signal_time":"2026-09-24T16:34:05Z","scope":"PRE_STAT_RESET","canonical_signal_id":77}','USER_TELEGRAM_EXPORT_20260924'),
 ('2026-09-24 17:20:01+00','ENTRY','cedear','HD','LONG',292.62250519,null,
  '{"signal_time":"2026-09-24T17:19:01Z","scope":"PRE_STAT_RESET","canonical_signal_id":75}','USER_TELEGRAM_EXPORT_20260924')
on conflict(source,event_time,event_type,symbol) do nothing;

create or replace function public.mtf_block_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'DELETE_BLOCKED: % is append-only; invalidate/archive explicitly instead', TG_TABLE_NAME;
end $$;
revoke all on function public.mtf_block_delete() from public,anon,authenticated;
grant execute on function public.mtf_block_delete() to postgres;

drop trigger if exists mtf_no_delete_signals on public.mtf_signals;
create trigger mtf_no_delete_signals before delete on public.mtf_signals
for each statement execute function public.mtf_block_delete();
drop trigger if exists mtf_no_delete_alert_events on public.mtf_alert_events;
create trigger mtf_no_delete_alert_events before delete on public.mtf_alert_events
for each statement execute function public.mtf_block_delete();
drop trigger if exists mtf_no_delete_delivery_ledger on public.mtf_alert_delivery_ledger;
create trigger mtf_no_delete_delivery_ledger before delete on public.mtf_alert_delivery_ledger
for each statement execute function public.mtf_block_delete();
drop trigger if exists mtf_no_delete_stats_epochs on public.mtf_stats_epochs;
create trigger mtf_no_delete_stats_epochs before delete on public.mtf_stats_epochs
for each statement execute function public.mtf_block_delete();

-- mtf_stats_audit_overlay() is created in the companion applied migration
-- v3520_stats_audit_overlay and consumed by api/data.js.
