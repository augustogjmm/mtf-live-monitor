-- v3.7.1 strict 1H MTF pullback confirmation + clean forward epoch.
-- Crypto only: D/4H/1H same trend, 1H structure, 2/3 momentum, closed 1H OB rejection,
-- structural OB+ATR stop, minimum 1.8R target and +1R break-even protection.
-- CEDEAR / ADR remain on OB-LADDER-v3.6.

insert into public.mtf_strategy_registry(version,activated_at,frozen,rules)
values (
  'OB-LADDER-v3.7.1', now(), true,
  jsonb_build_object(
    'engine','MTF_PULLBACK_CONFIRM_V3_7_1',
    'scope','crypto',
    'operational_timeframe','1H',
    'context_timeframes',jsonb_build_array('1H','4H','1D'),
    'trend_filter','1H + 4H + Daily must all match direction',
    'structure_filter','1H market structure must match direction',
    'momentum','at least 2 of 3: RSI14 >/< 50; MACD signal + histogram improving; volume >= 20-bar average',
    'pullback','closed 1H candle overlaps an Order Block that was active BEFORE the confirmation candle, crosses center and rejects with >=20% directional wick',
    'causality','entry OB and target ladder are frozen from the detector state immediately before the confirmation candle; the candle cannot create or delete the zone used for its own signal',
    'entry','close of confirmed 1H rejection candle',
    'stop','far edge of selected Order Block + 0.30 ATR14',
    'minimum_rr',1.8,
    'target','nearest opposite active Order Block satisfying RR >= 1.8',
    'protection','after a closed 1m bar reaches +1R, active stop moves to break-even for following bars',
    'same_bar_uncertainty','if 1R and initial stop occur in same 1m bar, result is AMBIGUOUS',
    'post_entry_monitoring','the first 1m bar beginning at the 1H confirmation close is included in TP/SL/BE monitoring',
    'positioning','one open crypto setup per asset',
    'regulated_strategy','OB-LADDER-v3.6 unchanged',
    'forward_only',true
  )
)
on conflict(version) do update
set activated_at=excluded.activated_at,frozen=excluded.frozen,rules=excluded.rules;

-- Preserve old evidence but remove pre-v3.7 crypto rows from the active runtime cohort.
update public.mtf_signals
set source='RESET_ARCHIVE',
    context=coalesce(context,'{}'::jsonb) || jsonb_build_object(
      'reset_excluded',true,
      'reset_reason','strategy_v3.7.1_causal_activation',
      'reset_at',now()
    ),
    updated_at=now()
where market='crypto'
  and strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7')
  and source in ('FORWARD','MIGRATED_STRICT');

update public.mtf_alert_events
set status='SKIPPED',
    last_error='Skipped by v3.7.1 causal clean activation reset',
    updated_at=now()
where market='crypto'
  and strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7')
  and status in ('PENDING','SENDING');

update public.mtf_stats_epochs set active=false where active=true;
insert into public.mtf_stats_epochs(started_at,label,notes,active)
values (
  now(),
  'OB-LADDER-v3.7.1 clean start',
  'Crypto v3.7.1 strict 1H MTF pullback confirmation. CEDEAR/ADR remain v3.6. Forward-only measurement from this timestamp.',
  true
);

update public.mtf_alert_config
set activated_at=now(),
    last_watcher_at=now(),
    strategy_version='OB-LADDER-v3.7.1',
    entry_direction='BOTH',
    alert_tp1=true,
    alert_tp2=false,
    alert_tp3=false,
    alert_sl=true,
    updated_at=now()
where id=1;

update public.mtf_state
set meta=jsonb_build_object(
      'keys','[]'::jsonb,
      'crypto_near',0,
      'regulated_zone',0,
      'initialized',false,
      'generated_at',now()
    ),
    last_processed_at=now(),
    last_run_at=now(),
    updated_at=now()
where market='prealert_live';

-- Do not let the previous minute cursor create a synthetic entry immediately after activation.
update public.mtf_state
set meta=jsonb_build_object(
      'strategy_version','OB-LADDER-v3.7.1',
      'engine','MTF_PULLBACK_CONFIRM_V3_7_1',
      'generated_at',now(),
      'baseline',true,
      'snapshot','[]'::jsonb
    ),
    last_processed_at=now(),
    last_run_at=now(),
    updated_at=now()
where market='crypto_live';

create or replace function public.mtf_stats_snapshot()
returns jsonb
language sql
security definer
set search_path to 'public','pg_temp'
as $function$
with epoch as (
  select coalesce(
    (select started_at from public.mtf_stats_epochs where active=true order by started_at desc limit 1),
    now()
  ) started_at
),
base_legs as (
  select
    s.*,
    coalesce(nullif(s.context->>'setup_id',''),'legacy:'||s.id::text) setup_id
  from public.mtf_signals s, epoch e
  where s.source='FORWARD'
    and s.signal_time>=e.started_at
    and (
      (
        s.market='crypto'
        and s.strategy_version='OB-LADDER-v3.7.1'
        and coalesce(s.context->>'trigger_basis','')='closed_1h_rejection_from_active_ob'
      )
      or (
        s.market in ('cedear','merval')
        and s.strategy_version='OB-LADDER-v3.6'
      )
    )
),
setups_raw as (
  select
    setup_id,
    min(id) id,
    min(market) market,
    min(symbol) symbol,
    min(underlying) underlying,
    min(direction) direction,
    min(signal_time) signal_time,
    min(created_at) created_at,
    avg(entry) entry,
    (array_agg(stop order by signal_time,id))[1] stop,
    (array_agg(tp1 order by signal_time,id))[1] tp1,
    (array_agg(tp2 order by signal_time,id))[1] tp2,
    (array_agg(tp3 order by signal_time,id))[1] tp3,
    case
      when bool_or(status='AMBIGUOUS') then 'AMBIGUOUS'
      when bool_or(status='SL' and coalesce(context->>'exit_reason','')='BREAK_EVEN') then 'BE'
      when bool_or(status='SL') then 'SL'
      when bool_or(status='TP1') or bool_or(hit1) then 'TP1'
      else 'OPEN'
    end status,
    bool_or(hit1) hit1,
    bool_or(hit2) hit2,
    bool_or(hit3) hit3,
    min(hit1_at) hit1_at,
    min(hit2_at) hit2_at,
    min(hit3_at) hit3_at,
    max(closed_at) closed_at,
    max(best_r) best_r,
    min(worst_r) worst_r,
    count(*) leg_count,
    jsonb_agg(
      jsonb_build_object(
        'id',id,'rank',context->>'entry_rank','entry',entry,'status',status,
        'best_r',best_r,'worst_r',worst_r
      )
      order by coalesce((context->>'entry_rank')::int,999),signal_time
    ) legs,
    (array_agg(context order by signal_time,id))[1] context,
    min(strategy_version) strategy_version
  from base_legs
  group by setup_id
),
setups as (
  select * from setups_raw
),
sent_entry_ids as (
  select distinct unnest(a.signal_ids)::bigint signal_id
  from public.mtf_alert_events a, epoch e
  where a.strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.1')
    and a.event_type='ENTRY'
    and a.status='SENT'
    and a.detected_at>=e.started_at
),
ops as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'setup_id',setup_id,'market',market,'symbol',symbol,'underlying',underlying,'direction',direction,
    'signal_time',signal_time,'created_at',created_at,'entry',entry,'stop',stop,'tp1',tp1,'tp2',tp2,'tp3',tp3,
    'status',status,'raw_status',status,'best_r',best_r,'worst_r',worst_r,'hit1',hit1,'hit2',hit2,'hit3',hit3,
    'hit1_at',hit1_at,'hit2_at',hit2_at,'hit3_at',hit3_at,'closed_at',closed_at,
    'strategy_version',strategy_version,'source','FORWARD','context',context,
    'leg_count',leg_count,'legs',legs,'cohort_member',true,'legacy_strategy',false
  ) order by signal_time desc,setup_id),'[]'::jsonb) operations
  from setups
),
summary as (
  select jsonb_build_object(
    'total',count(*),
    'open',count(*) filter(where status='OPEN'),
    'closed',count(*) filter(where status in ('TP1','SL','BE','AMBIGUOUS')),
    'tp1_reached',count(*) filter(where status='TP1'),
    'sl',count(*) filter(where status='SL'),
    'be',count(*) filter(where status='BE'),
    'ambiguous',count(*) filter(where status='AMBIGUOUS'),
    'crypto',count(*) filter(where market='crypto'),
    'cedear',count(*) filter(where market='cedear'),
    'adr',count(*) filter(where market='merval'),
    'entries',coalesce(sum(leg_count),0),
    'v37_crypto',count(*) filter(where market='crypto' and strategy_version='OB-LADDER-v3.7.1'),
    'v36_regulated',count(*) filter(where market in ('cedear','merval') and strategy_version='OB-LADDER-v3.6')
  ) j
  from setups
),
metrics as (
  select jsonb_build_object(
    'success_rate',case when count(*) filter(where status in ('TP1','SL'))>0
      then count(*) filter(where status='TP1')::numeric/count(*) filter(where status in ('TP1','SL')) else null end,
    'failure_rate',case when count(*) filter(where status in ('TP1','SL'))>0
      then count(*) filter(where status='SL')::numeric/count(*) filter(where status in ('TP1','SL')) else null end,
    'be_rate',case when count(*)>0 then count(*) filter(where status='BE')::numeric/count(*) else null end,
    'avg_mfe_r',avg(best_r),'avg_mae_r',avg(worst_r),
    'avg_tp1_seconds',avg(extract(epoch from (hit1_at-signal_time))) filter(where hit1_at is not null)
  ) j
  from setups
),
alerts as (
  select jsonb_build_object(
    'entry',count(*) filter(where event_type='ENTRY'),
    'tp1',count(*) filter(where event_type='TP1'),
    'sl',count(*) filter(where event_type='SL'),
    'ambiguous',count(*) filter(where event_type='AMBIGUOUS'),
    'system',count(*) filter(where event_type='SYSTEM')
  ) j
  from public.mtf_alert_events a, epoch e
  where a.strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.1')
    and a.status='SENT'
    and a.detected_at>=e.started_at
),
reconciliation as (
  select jsonb_build_object(
    'current_open_entries',(select count(*) from base_legs b join setups s using(setup_id) where s.status='OPEN'),
    'current_open_setups',(select count(*) from setups where status='OPEN'),
    'valid_entries',(select count(*) from base_legs),
    'valid_setups',(select count(*) from setups),
    'valid_entries_with_telegram',(select count(*) from base_legs b where b.id in (select signal_id from sent_entry_ids)),
    'valid_entries_without_telegram',(select count(*) from base_legs b where b.id not in (select signal_id from sent_entry_ids)),
    'status',case
      when (select count(*) from base_legs b where b.id not in (select signal_id from sent_entry_ids))=0
      then 'OK' else 'MISMATCH' end
  ) j
)
select jsonb_build_object(
 'generated_at',now(),
 'collection_started_at',(select started_at from epoch),
 'collection_label','v3.7.1 crypto + v3.6 regulados · clean forward statistics',
 'definition','Crypto: v3.7.1 strict 1H confirmed pullback. Regulated: v3.6 unchanged. TP1=success; structural SL=failure; BE and ambiguous are neutral/excluded from hit/fail denominator.',
 'operations',ops.operations,
 'summary',summary.j,
 'metrics',metrics.j,
 'alerts',alerts.j,
 'reconciliation',reconciliation.j
)
from ops,summary,metrics,alerts,reconciliation;
$function$;

grant execute on function public.mtf_stats_snapshot() to anon, authenticated, service_role;

-- Audit uses the version emitted by each live engine instead of a hard-coded strategy.
create or replace function public.mtf_capture_live_decision_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  item jsonb;
  v_cycle text;
  v_market text;
  v_symbol text;
  v_underlying text;
  v_direction text;
  v_state text;
  v_decision text;
  v_reason text;
  v_signal_time timestamptz;
  v_ms numeric;
  v_context jsonb;
  v_strategy text;
begin
  if new.market not in ('crypto_live','regulated_live') then return new; end if;
  if jsonb_typeof(new.meta->'snapshot') <> 'array' then return new; end if;
  v_strategy := coalesce(nullif(new.meta->>'strategy_version',''), case when new.market='crypto_live' then 'OB-LADDER-v3.7.1' else 'OB-LADDER-v3.6' end);
  v_cycle := new.market || ':' || to_char(coalesce(new.last_run_at,new.updated_at,now()) at time zone 'UTC','YYYYMMDD"T"HH24MISS.MS');

  for item in select value from jsonb_array_elements(new.meta->'snapshot')
  loop
    v_market := case when new.market='crypto_live' then 'crypto' else coalesce(nullif(item->>'market',''),'regulated') end;
    v_symbol := coalesce(nullif(item->>'symbol',''),'UNKNOWN');
    v_underlying := nullif(item->>'underlying','');
    v_state := upper(coalesce(nullif(item->>'state',''),'NO_ENTRY'));
    v_direction := coalesce(
      nullif(item->>'direction',''),
      nullif(item#>>'{proximity,nearest,direction}',''),
      case when v_market in ('cedear','merval') and coalesce((item->>'entry_allowed')::boolean,false) then 'LONG' end
    );

    v_ms := null;
    begin v_ms := nullif(item->>'last_bar_close','')::numeric; exception when others then v_ms := null; end;
    if coalesce(v_ms,0) <= 0 then
      begin v_ms := nullif(item->>'t','')::numeric; exception when others then v_ms := null; end;
    end if;
    v_signal_time := case when coalesce(v_ms,0)>0 then to_timestamp(v_ms/1000.0)
                          else coalesce(new.last_run_at,new.updated_at,now()) end;

    v_decision := case
      when coalesce(nullif(item->>'created','')::int,0) > 0 or v_state in ('ENTRY','OPEN') then 'ENTRY'
      when coalesce((item->>'ok')::boolean,true)=false or v_state in ('ERROR','NO_ANALYSIS') then 'ERROR'
      when v_state in ('BLOCKED','BLOCKED_OPEN') then 'BLOCKED_OPEN'
      when coalesce((item->>'entry_allowed')::boolean,true)=false and v_state in ('ZONE','IN_ZONE','NEAR','CLOSE') then 'BLOCKED_OPEN'
      else 'NO_ENTRY'
    end;

    v_reason := coalesce(nullif(item->>'reason',''), 'state='||v_state);
    v_context := jsonb_strip_nulls(jsonb_build_object(
      'source_state',new.market,
      'state',v_state,
      'price',item->'price',
      'setup_id',item->'setup_id',
      'open_count',item->'open_count',
      'actionable',item->'actionable',
      'entry_allowed',item->'entry_allowed',
      'eligibility',item->'eligibility',
      'nearest',item#>'{proximity,nearest}',
      'trend',item#>'{context,trend}',
      'macro_trend',coalesce(item#>'{macro_context,trend}',item#>'{macroContext,trend}'),
      'engine',new.meta->'engine'
    ));

    insert into public.mtf_decision_audit(
      strategy_version,cycle_id,market,symbol,underlying,direction,
      signal_time,evaluated_at,decision,reason,context
    ) values (
      v_strategy,v_cycle,v_market,v_symbol,v_underlying,v_direction,
      v_signal_time,coalesce(new.last_run_at,new.updated_at,now()),v_decision,v_reason,v_context
    )
    on conflict do nothing;
  end loop;
  return new;
end;
$function$;

create or replace function public.mtf_audit_status()
returns jsonb
language sql
security definer
set search_path to 'public','pg_temp'
as $function$
with epoch as (
  select coalesce((select started_at from public.mtf_stats_epochs where active=true order by started_at desc limit 1),now()) started_at
),
base as (
  select d.* from public.mtf_decision_audit d, epoch e
  where d.strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.1')
    and d.evaluated_at>=e.started_at
), last_cycles as (
  select distinct on (market) market,cycle_id,
    max(evaluated_at) over(partition by market,cycle_id) cycle_at,
    count(*) over(partition by market,cycle_id) rows_in_cycle
  from base order by market,cycle_at desc
), recent as (
  select jsonb_agg(jsonb_build_object(
    'id',id,'cycle_id',cycle_id,'market',market,'symbol',symbol,'underlying',underlying,
    'direction',direction,'signal_time',signal_time,'evaluated_at',evaluated_at,
    'decision',decision,'reason',reason,'context',context,'strategy_version',strategy_version
  ) order by evaluated_at desc,id desc) items
  from (select * from base order by evaluated_at desc,id desc limit 30) q
), counts as (
  select count(*) total,
    count(*) filter(where evaluated_at>=now()-interval '24 hours') decisions_24h,
    count(distinct cycle_id) filter(where evaluated_at>=now()-interval '24 hours') cycles_24h,
    count(*) filter(where evaluated_at>=now()-interval '24 hours' and decision='ENTRY') entry_24h,
    count(*) filter(where evaluated_at>=now()-interval '24 hours' and decision='NO_ENTRY') no_entry_24h,
    count(*) filter(where evaluated_at>=now()-interval '24 hours' and decision='BLOCKED_OPEN') blocked_24h,
    count(*) filter(where evaluated_at>=now()-interval '24 hours' and decision='ERROR') errors_24h,
    max(evaluated_at) last_audit_at
  from base
), by_market as (
  select coalesce(jsonb_object_agg(market,j),'{}'::jsonb) j
  from (select market,jsonb_build_object(
    'total',count(*),'decisions_24h',count(*) filter(where evaluated_at>=now()-interval '24 hours'),
    'last_audit_at',max(evaluated_at),'last_signal_time',max(signal_time)
  ) j from base group by market) q
), cycles as (
  select coalesce(jsonb_object_agg(market,jsonb_build_object('cycle_id',cycle_id,'cycle_at',cycle_at,'rows',rows_in_cycle)),'{}'::jsonb) j
  from last_cycles
)
select jsonb_build_object(
  'strategy_version','OB-LADDER-v3.7.1 + v3.6 regulated',
  'started_at',(select started_at from epoch),
  'last_audit_at',counts.last_audit_at,'total',counts.total,'decisions_24h',counts.decisions_24h,'cycles_24h',counts.cycles_24h,
  'decision_counts_24h',jsonb_build_object('ENTRY',counts.entry_24h,'NO_ENTRY',counts.no_entry_24h,'BLOCKED_OPEN',counts.blocked_24h,'ERROR',counts.errors_24h),
  'by_market',by_market.j,'last_cycles',cycles.j,'recent',coalesce(recent.items,'[]'::jsonb)
) from counts,by_market,cycles,recent,epoch;
$function$;

grant execute on function public.mtf_audit_status() to anon, authenticated, service_role;

-- Keep the existing detailed system-status function, but teach it the new crypto version.
do $$
declare v_sql text;
begin
  select pg_get_functiondef(p.oid) into v_sql
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and n.nspname='public' and p.proname='mtf_system_status'
  limit 1;

  if v_sql is not null then
    v_sql := replace(v_sql,'OB-LADDER-v3.7','OB-LADDER-v3.7.1');
    v_sql := replace(v_sql,'MTF_PULLBACK_CONFIRM_V3_7','MTF_PULLBACK_CONFIRM_V3_7_1');
    v_sql := replace(v_sql,'3.7.0','3.7.1');
    execute v_sql;
  end if;
end $$;
