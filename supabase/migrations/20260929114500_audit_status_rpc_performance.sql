-- Optimize MTF audit RPC to avoid materializing full decision contexts across 100k+ rows.
create index if not exists mtf_decision_audit_market_eval_idx on public.mtf_decision_audit (market,evaluated_at desc);
CREATE OR REPLACE FUNCTION public.mtf_audit_status()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with epoch as (
 select coalesce((select started_at from public.mtf_stats_epochs where active=true order by started_at desc limit 1),now()) started_at
), base as materialized (
 select d.market,d.cycle_id,d.evaluated_at,d.signal_time,d.decision
 from public.mtf_decision_audit d cross join epoch e
 where d.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
   and d.evaluated_at>=e.started_at
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
 from (select market,jsonb_build_object('total',count(*),
 'decisions_24h',count(*) filter(where evaluated_at>=now()-interval '24 hours'),
 'last_audit_at',max(evaluated_at),'last_signal_time',max(signal_time)) j
 from base group by market) q
), last_per_market as (
 select distinct on (market) market,cycle_id,evaluated_at cycle_at
 from base order by market,evaluated_at desc
), cycles as (
 select coalesce(jsonb_object_agg(l.market,jsonb_build_object(
 'cycle_id',l.cycle_id,'cycle_at',l.cycle_at,'rows',(
 select count(*) from base b where b.market=l.market and b.cycle_id=l.cycle_id
 ))),'{}'::jsonb) j from last_per_market l
), recent as (
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',q.id,'cycle_id',q.cycle_id,'market',q.market,'symbol',q.symbol,'underlying',q.underlying,
 'direction',q.direction,'signal_time',q.signal_time,'evaluated_at',q.evaluated_at,
 'decision',q.decision,'reason',q.reason,'context',q.context,'strategy_version',q.strategy_version
 ) order by q.evaluated_at desc,q.id desc),'[]'::jsonb) items
 from (select d.id,d.cycle_id,d.market,d.symbol,d.underlying,d.direction,d.signal_time,
 d.evaluated_at,d.decision,d.reason,d.context,d.strategy_version
 from public.mtf_decision_audit d cross join epoch e
 where d.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')
 and d.evaluated_at>=e.started_at order by d.evaluated_at desc,d.id desc limit 30) q
)
select jsonb_build_object(
 'strategy_version','OB-LADDER-v3.7.3 + v3.6 CEDEAR + ADR-OB-v1.0',
 'started_at',(select started_at from epoch),'last_audit_at',counts.last_audit_at,
 'total',counts.total,'decisions_24h',counts.decisions_24h,'cycles_24h',counts.cycles_24h,
 'decision_counts_24h',jsonb_build_object('ENTRY',counts.entry_24h,'NO_ENTRY',counts.no_entry_24h,
 'BLOCKED_OPEN',counts.blocked_24h,'ERROR',counts.errors_24h),
 'by_market',by_market.j,'last_cycles',cycles.j,'recent',recent.items)
from counts,by_market,cycles,recent,epoch
$function$
;
