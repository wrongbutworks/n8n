# LIGO-768 — Data table source-control reconciliation

Implementation spec. Vocabulary: `/CONTEXT.md`. Decision + rationale:
`/docs/adr/0001-data-table-sync-identity-converges-to-git-id.md`.
Ticket: https://linear.app/n8n/issue/LIGO-768. Related: PR #26416 (ADO-4860
guard). Branch (from Linear): `ligo-768-source-control-deleting-and-recreating-a-data-table-with-the`
— not yet created; branch from fresh master.

## Bug being fixed

Deleting a data table and recreating it with the same name upstream gives it a
new id. On pull, the receiving instance hits the name-collision guard, which
throws a `UserError` that aborts the ENTIRE pull and re-fires on every
subsequent pull (cluster-wide sync freeze). The in-product workaround (delete
the table from git) makes the next pull drop the local table including its
local-only rows.

## Design (settled in grilling session)

Reconciliation = a pure **identity-adoption pre-step**; the existing import
path then runs unchanged and all schema outcomes fall out of shipped code.

### Classification (three tiers)

For a name collision (same `(project, name)`, different id), classify by the
DESTINATION table only (the incoming id is new to the destination in all
tiers):

| Tier | Destination table | Merge | Verdict |
|---|---|---|---|
| 1 Recreated table | previously synced (its id in git history) | lossless or lossy | reconcile |
| 2 Pre-sync twin | never synced | lossless | reconcile |
| 3 Genuine collision | never synced | lossy | per-table conflict; pull NEVER aborts |

- "Previously synced": destination table id ∈ `previouslySyncedIds`, already
  computed from git history in
  `packages/cli/src/modules/source-control.ee/source-control-status.service.ee.ts:701-713`.
- "Lossless": every local column has an incoming `(name, type)` match — a set
  comparison over columns already loaded in memory.
- Tier 3 is surfaced in status result / pull result / log, never silent.
  Replacement of a never-synced table requires the user to rename/delete the
  local table explicitly.

### Identity-adoption pre-step

Runs during data-table import, per colliding table, ONE transaction:

1. **Idempotency probe**: if the physical table for the incoming id already
   exists while metadata still holds the old id, finish the metadata swap
   (recovers MySQL half-states; doubles as rename-target-collision guard on
   all dialects).
2. `ALTER TABLE ... RENAME` physical row table `{prefix}data_table_user_{oldId}`
   → `{...}_{newId}`. Physical name is DERIVED from id at runtime
   (`toTableName`, `packages/cli/src/modules/data-table/utils/sql-utils.ts:377-380`)
   — never stored, so nothing else references it.
3. Re-key metadata: delete old `DataTable` row (FK `data_table_column.dataTableId`
   has `ON DELETE CASCADE` — migration `1754475614602-ReplaceDataStoreTablesWithDataTables.ts`),
   insert row with the incoming id, re-insert local columns **adopting the
   incoming column id where `(name, type)` matches**, keeping old ids where
   not (those then get DROPped by the existing path, which is the intended
   lossy-alignment semantics).
4. NO `UPDATE ... SET id` on any PK. No new column-sync algorithm.

Then the existing Phase 3 import
(`source-control-import.service.ee.ts:1356-1466`) runs unchanged:
identical recreate → all ids match → zero DDL, rows untouched; type change or
rename → existing DROP/ADD by name; index shuffle → metadata upsert.

### Code touch points

- Guard to replace with classification + adoption/skip:
  `source-control-import.service.ee.ts:1341-1353` (Phase 2). Must re-apply the
  tier rule itself (cannot blindly trust a stale status result). Tier-3 tables:
  skip + record per-table error in result; never throw out of the loop.
- Status classification: collision branch
  `source-control-status.service.ee.ts:745-776` — mark tier-1/2 as
  reconcilable `modified`, tier-3 as conflict. `getStatus` powers both the UI
  dry-run and the pull, so both see the same verdict.
- Rename DDL: add a `renameTable` to
  `packages/cli/src/modules/data-table/data-table-ddl.service.ts` (single
  `ALTER TABLE ... RENAME TO` query in `sql-utils.ts` — valid on SQLite,
  Postgres AND MySQL 8+, so no per-dialect branching needed). A `tableExists`
  probe (queryRunner `hasTable`) backs the idempotency check.
- Invalidate size-validator cache after adoption
  (`data-table-size-validator.service.ts:93` reset).

### Verified facts (do not re-derive)

- Column ids are persisted ONLY in `data_table_column` and the git export
  file; REST/MCP usages are transient per-request. Physical DB columns are
  named by column NAME. Column ids are freely swappable metadata.
- Nothing derives index/sequence names from the table id — Postgres keeping
  stale auto-index names after rename is cosmetic.
- MySQL DDL commits implicitly (non-atomic pre-step there); accepted with
  idempotent retry. Existing column sync already has this weakness on MySQL.
- Bare-string stale references after delete+recreate: workflow Data Table
  node (`packages/nodes-base/nodes/DataTable/common/fields.ts`), favorites
  (`resourceId`), evaluation configs (`datasetRef.dataTableId`). Known
  limitation, out of scope — they dangle identically on a plain delete.

### Ordering trap (needs an explicit test)

Today a tier-1 collision emits BOTH a `modified` and a `deleted` status entry
for the old id. `deleteDataTablesNotInWorkFolder`
(`source-control-import.service.ee.ts:1594-1602`) would drop the old table
WITH ROWS. After adoption the old id no longer exists, so
`deleteDataTable(oldId)` no-ops (`dropTable(..., true)` is if-exists) — but
only because import runs BEFORE the delete phase
(`source-control.service.ee.ts:617-625`). Test this ordering explicitly.

### Test points

- [x] Identical recreate reconciles to a no-op; rows preserved. (Headline
  case — covered by adoption tests: matching `(name, type)` columns adopt the
  incoming column ids, so Phase 3 sees all ids equal and emits zero DDL.)
- [x] Recreate with added/removed/retyped columns → documented lossy
  alignment, untouched columns keep data (recreated-table test keeps the
  non-matching local column id, which the existing path then drops by name).
- [x] Pre-sync twin (never synced, lossless) auto-reconciles.
- [x] Genuine collision (never synced, lossy) → per-table conflict; rest of
  pull completes; conflict visible in result (`conflicts` on import result +
  `conflict: true` status entry).
- [x] Idempotency: half-finished adoption (physical table renamed, metadata
  old) → retry skips rename, completes metadata swap.
- [x] Old-id `deleted` entry no-ops after adoption — ordering test asserts
  import runs before the delete phase in `pullWorkfolder`.
- [x] Force pull exercises all tiers without confirmation (import-level tests
  run the same code path force pull hits; ordering test uses `force: true`).
- [x] Status classification: tier 1/2 → `modified` + `conflict: false` on
  pull, tier 3 → `conflict: true`.

### Implementation notes (drift from spec, settled during implementation)

- `importDataTablesFromWorkFolder` now returns
  `{ imported: string[]; conflicts: Array<{ id; name }> }`. Tier-3 conflicts
  are deduped (the status result lists a colliding remote table as both
  `created` and `modified`, so the import sees the same file twice; adoption
  itself is idempotent so the duplicate import is harmless).
- A failure inside the adoption pre-step degrades to a per-table conflict
  (logged, recorded in `conflicts`) instead of aborting the pull.
  `pullWorkfolder` marks the matching status entries `conflict: true` from the
  import result, so conflicts only discovered at import time (e.g. a failed
  reconciliation) surface on the pull result, not just in the logs.
- Status classification applies to pull only; push collisions keep
  `conflict: true` (unchanged behavior).
- The full tier verdict lives in `canReconcileDataTableNameCollision`
  (`source-control-helper.ee.ts`, built on `isLosslessDataTableMerge`), shared
  by status and import so the pull preview cannot desynchronize from pull
  execution; import re-derives `previouslySyncedIds` from git history itself
  (new `SourceControlGitService` dependency) instead of trusting a stale
  status result.
- The old "collision aborts the whole import" unit tests were removed and
  replaced by per-tier reconciliation/conflict tests (intent inverted by this
  change); an explicit regression test asserts the import now resolves with a
  warning instead of throwing a `UserError` on an unreconcilable collision.
- Shared helpers in `source-control-helper.ee.ts` keep the two verdict sites
  literally in sync: `dataTableColumnKey` defines the `(name, type)` column
  identity used by BOTH `isLosslessDataTableMerge` and the adoption's column
  id mapping; `extractResourceIdsFromFilePaths` centralizes the
  git-tracked-file → id extraction used by status and import.
- Adoption re-inserts spread the loaded entities (`{ ...localTable }`,
  `{ ...column }`) and override only id / `dataTableId`, so future scalar
  fields on `DataTable`/`DataTableColumn` carry over without touching this
  code.

### Follow-ups (separate tickets / not in this change)

- "Pull and override" confirmation UI: show merge/column-loss detail.
- Docs (docs.n8n.io "Push and pull changes"): note that same-name recreates
  now reconcile.
