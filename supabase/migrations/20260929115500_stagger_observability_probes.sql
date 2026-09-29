-- Stagger heavy observability RPC probes to avoid simultaneous minute-boundary load.
-- Live trading, watcher and market crons remain unchanged.
select cron.alter_job(9,schedule=>'4-59/5 * * * *');
select cron.alter_job(10,schedule=>'2-59/5 * * * *');
