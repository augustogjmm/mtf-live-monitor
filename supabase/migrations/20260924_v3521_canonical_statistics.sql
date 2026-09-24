-- v3.5.21
-- Statistics use one canonical population only:
-- strategy_version = OB-LADDER-v3.5, source = FORWARD, valid trigger basis.
-- Cohort/epoch splits are intentionally not part of user-facing statistics.
-- Applied to Supabase on 2026-09-24.

-- See the live function definition in public.mtf_stats_snapshot().
-- The function groups legs by context.setup_id, counts OPEN/TP1/TP2 as active,
-- TP3/SL/AMBIGUOUS as closed, and reconciles every valid signal id to a SENT ENTRY alert.
