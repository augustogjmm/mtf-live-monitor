-- Runtime stability certification checks
-- Run after deploying mtf-daily-backfill. All checks must return pass=true.

with checks as (
  select 'regulated_live_fresh' name,
         coalesce((select last_run_at >= now()-interval '3 minutes' from public.mtf_state where market='regulated_live'),false) pass
  union all
  select 'regulated_live_snapshot_185',
         coalesce((select jsonb_array_length(meta->'snapshot')=185 from public.mtf_state where market='regulated_live'),false)
  union all
  select 'regulated_live_chunk_bounded',
         coalesce((select (meta->>'chunk_size')::int between 1 and 2 from public.mtf_state where market='regulated_live'),false)
  union all
  select 'crypto_live_fresh',
         coalesce((select last_run_at >= now()-interval '3 minutes' from public.mtf_state where market='crypto_live'),false)
  union all
  select 'crypto_top20',
         coalesce((select jsonb_array_length(meta->'snapshot')=20 from public.mtf_state where market='crypto_live'),false)
  union all
  select 'adr_live_fresh',
         coalesce((select last_run_at >= now()-interval '10 minutes' from public.mtf_state where market='adr_live'),false)
  union all
  select 'telegram_queue_clear',
         not exists(select 1 from public.mtf_alert_events where status in ('PENDING','SENDING'))
  union all
  select 'no_recent_runtime_5xx',
         not exists(select 1 from public.mtf_runtime_errors where created_at>now()-interval '3 minutes' and status_code>=500)
)
select name,pass from checks order by name;
