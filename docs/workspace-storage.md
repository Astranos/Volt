# Workspace storage

Every signed-in account has free capture sync and a rolling seven-day history. The default limits are 1,000 stored captures and 100 MiB per workspace. Legacy StoreKit subscriptions affect AI allowances only; they do not extend history or restrict workspace writes.

## Configuration

`WORKSPACE_STORAGE_POLICY_ENABLED=true` enables retention enforcement and quota reservations. It is enabled in production. Keep it enabled to enforce the history window. `WORKSPACE_FREE_RECORD_LIMIT` and `WORKSPACE_FREE_BYTE_LIMIT` can override the default quotas with positive safe integers up to 1,000,000,000,000. There are no web checkout or billing settings.

## Storage lifecycle

Managed captures expire seven days after server receipt. The iPhone removes uploaded captures from its local history on the same window and keeps anything not yet uploaded. Retention tombstones cannot be restored.

Rows without `storageManaged` remain excluded from automated retention and managed counters until enrolled. `workspaceStorage:enrollLegacyHistory` enrolls those captures onto the seven-day window in bounded pages and supports a dry run. Run `workspaceStorage:recountWorkspaceStorage` afterwards to rebuild the workspace counters. Review and communicate the migration before running it on existing captures.

Quota reservations are transactional across device/guest upload, append and restore paths. Text size is calculated from UTF-8 content. Photos require a positive declared size of at most 10 MiB and an exact HEAD size match at finalization. Caps bound validated logical storage: presigned PUT does not impose a hard R2 payload limit. Rejected/unfinalized oversized objects need operational monitoring; a bounded upload gateway and orphan-object sweep remain follow-up work.

User deletion releases record allowance immediately, retains byte allowance during the 30-day undo period, then schedules purge. Retention expiry permits no undo. R2 deletion retries on failure; bytes are released only after successful cleanup. A ten-minute delay allows existing five-minute signed URLs to expire. Minimal sync tombstones remain for idempotency; metadata pruning is future work. Cleanup is bounded (100 expiry rows / sweep, 25 objects / purge run) and should be monitored against ingestion volume.

