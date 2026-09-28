-- ADR v1 observability integration without changing trading rules.
do $body$
declare d text;
begin
  select pg_get_functiondef('public.mtf_system_status()'::regprocedure) into d;
  d:=replace(d, 'where j.jobid in (1,2,3,7,8)', 'where j.jobid in (1,2,3,7,8,11)');
  d:=replace(d, 'where jobid in (1,2,3,7,8)', 'where jobid in (1,2,3,7,8,11)');
  d:=replace(d,
    $$'OB-LADDER-v3.5','OB-LADDER-v3.6','OB-LADDER-v3.7.3'$$,
    $$'OB-LADDER-v3.5','OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3'$$
  );
  d:=replace(d,
    $$from public.mtf_state where market in ('crypto_structure','crypto_live','regulated_live','prealert_live')$$,
    $$from public.mtf_state where market in ('crypto_structure','crypto_live','regulated_live','adr_live','prealert_live')$$
  );
  d:=replace(d,
    $$where s.market in ('crypto_structure','crypto_live','regulated_live','prealert_live','market_guard')$$,
    $$where s.market in ('crypto_structure','crypto_live','regulated_live','adr_live','prealert_live','market_guard')$$
  );
  d:=replace(d,
    $$when 'prealert_live' then jsonb_build_object($$,
    $$when 'adr_live' then jsonb_build_object(
          'strategy_version',s.meta->>'strategy_version','engine',s.meta->>'engine',
          'baseline',s.meta->'baseline',
          'snapshot_count',case when jsonb_typeof(s.meta->'snapshot')='array' then jsonb_array_length(s.meta->'snapshot') else 0 end,
          'ready_count',case when jsonb_typeof(s.meta->'snapshot')='array' then
            (select count(*) from jsonb_array_elements(s.meta->'snapshot') x where coalesce((x->>'ready')::boolean,false)) else 0 end,
          'cursor',s.meta->'cursor','chunk_size',s.meta->'chunk_size','funnel',s.meta->'funnel'
        )
        when 'prealert_live' then jsonb_build_object($$
  );
  execute d;

  select pg_get_functiondef('public.mtf_audit_status()'::regprocedure) into d;
  d:=replace(d,
    $$d.strategy_version in ('OB-LADDER-v3.6','OB-LADDER-v3.7.3')$$,
    $$d.strategy_version in ('OB-LADDER-v3.6','ADR-OB-v1.0','OB-LADDER-v3.7.3')$$
  );
  d:=replace(d,
    $$'strategy_version','OB-LADDER-v3.7.3 + v3.6 regulated'$$,
    $$'strategy_version','OB-LADDER-v3.7.3 + v3.6 CEDEAR + ADR-OB-v1.0'$$
  );
  execute d;
end
$body$;

grant execute on function public.mtf_system_status() to anon,authenticated,service_role;
grant execute on function public.mtf_audit_status() to anon,authenticated,service_role;
