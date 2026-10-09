# Supabase transfer reduction

The organization's notice reports **Egress Exceeded** for the previous billing
cycle, with grace ending 2 November 2026. Deleting database rows does not reset
transfer usage or withdraw that notice. These changes reduce future transfer;
the billing dashboard remains the authority for actual organization usage.

## Changes

- CEDEAR workers read only cursor, retry, confirmation and freshness inputs.
  PostgreSQL merges unchanged full analysis back into the stored snapshot;
  new asset results replace old asset results entirely, including failures.
- Prealert workers read only potential NEAR/IN_ZONE candidates and matching
  crypto structure. All original eligibility checks still execute in the worker.
- Statistics read only symbols, names and prices, without downloading analysis.
- The command center requests `view=monitor`: prices, source clocks, displayed
  indicators, trends, OB levels, targets and stops. The default runtime response
  remains complete for legacy views and diagnostics. No trade rules changed.
- Identical in-flight backend reads are shared. Successful read-only results
  expire after 20 seconds; failures are never cached. The cache has at most
  32 entries per process. Public responses request a 30-second Vercel CDN cache
  without stale-while-revalidate. Browser runtime responses remain `no-store`.
  Errors and canary responses are not cached. Manual command-center refresh
  bypasses both caches. Original source timestamps remain intact.
- Browser polling uses stable URLs, stops while the tab is hidden, and resumes
  when visible. Engine and alert schedules remain unchanged.

## Validation

The migration and regression SQL ran against the real schema in one transaction,
then rolled back. They verified full-state preservation, replacement semantics,
prealert candidate identity, names/prices, displayed fields, indicators, trends
and OB/target points. No real trade or notification was requested by validation.

Sample JSON sizes on 9 October 2026 (not billing measurements or guarantees):

| Read | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Regulated worker state | 1,625,628 bytes | 53,111 bytes | 96.7% |
| Prealert inputs | 1,916,313 bytes | 74,868 bytes | 96.1% |
| Regulated monitor state | 1,625,628 bytes | 360,365 bytes | 77.8% |
| Price inputs | roughly 1.87 MB across three states | 33,718 bytes | roughly 98% |

Seven automated suites cover cache expiry, concurrent reads, outage behavior,
manual bypass and the existing strategy/authentication invariants. Browser tests
verify compact URLs, shared cache keys, hidden-tab silence, visibility recovery,
market navigation, mobile layout and outages.

## Deployment and verification

Apply `20261009193000_compact_egress_reads.sql` before deploying the changed Edge
workers or Vercel API. The service-only worker RPCs reject public execution;
public read projections use existing table RLS through SECURITY INVOKER.
The existing 24-hour audit retention migration is independent of egress.

Verify subsequent regulated and watcher heartbeats, HTTP 200 on all three compact
runtime routes, and production smoke checks. Reload open browser tabs to obtain
the new frontend. Local cache instances and CDN regions do not share a global
quota counter: traffic grows with users, regions, calls and candidate counts.
The changes cannot guarantee unlimited free usage or removal of Supabase's
previous-cycle warning. Do not clear error history, rotate projects to evade
quotas, or disable confirmation processing to make a usage report look green.
