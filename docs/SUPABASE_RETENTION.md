# Supabase retention

On 2026-10-09, production inspection found a database of 81,579,155 bytes
(about 78 MiB), below the standard Free database allowance of 500 MB.
The exact quota warning has not been identified. Database cleanup does not
reset monthly egress or Edge Function invocation quotas.

Migration `20261009191000_reduce_audit_retention.sql` reduces decision audit
retention from 36 to 24 hours while preserving the existing cleanup function,
permissions, and six-hour schedule. Runtime errors retain three days and cron
history retains 36 hours, preserving the health endpoint's 24-hour metrics.

The migration was applied and cleanup executed: 14,971 expired decision audit
rows and 110 expired cron history rows were deleted. Signal history, positions,
configuration, authentication, and delivery ledgers were preserved. A regular
VACUUM ANALYZE was run on the decision audit table. This makes deleted-row space
reusable; it does not guarantee that the database file shrinks.

The subsequent health RPC succeeded, with zero cron failures in the previous
24 hours, zero HTTP 5xx errors in the previous 30 minutes, and two current open
positions without duplicate assets. Historical errors remain visible.

Do not truncate the whole database to address an unidentified quota. Confirm
the warning's quota first; changing engine frequency affects signal latency
and requires a separate assessment.
