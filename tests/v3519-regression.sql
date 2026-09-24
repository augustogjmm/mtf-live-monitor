-- v3.5.19 final closeout regression checks (read-only)
-- Expected result: every row returns passed = true.
-- Telegram reconciliation intentionally allows a 2 minute delivery grace window.

with active_epoch as (
  select started_at
  from public.mtf_stats_epochs
  where active=true
  order by started_at desc
  limit 1
),
checks as (
  select 'signal_geometry'::text check_name, not exists (
    select 1 from public.mtf_signals
    where strategy_version='OB-LADDER-v3.5'
      and (
        (direction='LONG' and not(stop<entry and tp1>entry and tp2>=tp1 and tp3>=tp2))
        or
        (direction='SHORT' and not(stop>entry and tp1<entry and tp2<=tp1 and tp3<=tp2))
      )
  ) passed

  union all
  select 'signal_excursions', not exists (
    select 1 from public.mtf_signals
    where strategy_version='OB-LADDER-v3.5' and (best_r<0 or worst_r>0)
  )

  union all
  select 'setup_rank_context', not exists (
    select 1 from public.mtf_signals
    where strategy_version='OB-LADDER-v3.5'
      and (
        not(context ? 'setup_id')
        or not(context ? 'entry_rank')
        or nullif(context->>'setup_id','') is null
        or (context->>'entry_rank')::int not between 1 and 3
      )
  )

  union all
  select 'duplicate_setup_rank', not exists (
    select 1
    from public.mtf_signals
    where strategy_version='OB-LADDER-v3.5'
    group by market,symbol,context->>'setup_id',context->>'entry_rank'
    having count(*)>1
  )

  union all
  select 'max_three_open_legs', not exists (
    select 1
    from public.mtf_signals
    where strategy_version='OB-LADDER-v3.5'
      and source in ('FORWARD','MIGRATED_STRICT')
      and status in ('OPEN','TP1','TP2')
    group by market,symbol,context->>'setup_id'
    having count(*)>3
  )

  union all
  select 'crypto_closed_1m_entry_only', not exists (
    select 1
    from public.mtf_signals
    where strategy_version='OB-LADDER-v3.5'
      and market='crypto'
      and source='FORWARD'
      and context->'trigger_bar'->>'t' is not null
      and created_at < to_timestamp(((context->'trigger_bar'->>'t')::bigint + 60000)/1000.0)
  )

  union all
  select 'crypto_live_cursor_not_future', not exists (
    select 1
    from public.mtf_state s,
         lateral jsonb_array_elements(coalesce(s.meta->'snapshot','[]'::jsonb)) j
    where s.market='crypto_live'
      and j->>'last_bar_close' is not null
      and (j->>'last_bar_close')::numeric > extract(epoch from now())*1000
  )

  union all
  select 'telegram_reconciled_after_grace', not exists (
    select 1
    from public.mtf_signals s
    cross join active_epoch e
    where s.strategy_version='OB-LADDER-v3.5'
      and s.source='FORWARD'
      and s.created_at>=e.started_at
      and s.created_at < now()-interval '2 minutes'
      and not exists (
        select 1
        from public.mtf_alert_events a
        where a.strategy_version='OB-LADDER-v3.5'
          and a.event_type='ENTRY'
          and a.status='SENT'
          and s.id=any(a.signal_ids)
      )
  )

  union all
  select 'single_active_stats_epoch',
    (select count(*)=1 from public.mtf_stats_epochs where active=true)

  union all
  select 'cron_jobs_active',
    (select count(*)=5 and bool_and(active)
     from cron.job where jobid in (1,2,3,7,8))

  union all
  select 'cron_vault_backed', not exists (
    select 1 from cron.job
    where jobid in (1,2,3,7,8)
      and position('vault.decrypted_secrets' in command)=0
  )

  union all
  select 'watcher_timeout_60s', exists (
    select 1 from cron.job
    where jobid=3
      and position('timeout_milliseconds := 60000' in command)>0
  )

  union all
  select 'secret_validator_private', not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema='public'
      and routine_name='mtf_validate_cron_secret'
      and grantee in ('PUBLIC','anon','authenticated')
  )

  union all
  select 'strategy_contract_frozen',
    coalesce((select frozen from public.mtf_strategy_registry
              where version='OB-LADDER-v3.5'),false)
)
select * from checks order by check_name;
