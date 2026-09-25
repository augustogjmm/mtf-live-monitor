-- TP2/TP3 remain chart/reference levels in v3.6, not operational alert events.
update public.mtf_alert_config
set alert_tp2=false,
    alert_tp3=false,
    updated_at=now()
where id=1;
