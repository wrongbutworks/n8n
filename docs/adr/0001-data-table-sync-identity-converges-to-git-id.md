# Data table sync identity converges to the git id via identity adoption

On source-control pull, a name collision (same `(project, name)`, different id
— typically a delete+recreate upstream) is resolved by the destination
*adopting* the incoming id: the physical row table is renamed, the metadata is
re-keyed (adopting incoming column ids where `(name, type)` matches), and the
unchanged existing import path then aligns the schema. Rows are preserved; an
identical recreate is a no-op. We chose this over (a) matching by name while
keeping the local id — which leaves instances permanently disagreeing on ids,
so pulled workflows referencing the new id stay broken and any future two-way
sync is poisoned — and (b) processing deletes before creates, which destroys
local-only rows on every recreate under force pulls.

Adoption is gated by a losslessness rule to preserve the no-silent-clobber
guarantee (ADO-4860 / PR #26416): previously-synced destination tables always
reconcile (lossy schema alignment is the documented contract); never-synced
tables reconcile only when the merge is lossless (no local column dropped or
retyped); otherwise the single table degrades to a per-table conflict —
requiring an explicit destructive act (rename/delete the local table) to
accept replacement — and the pull as a whole never aborts.

## Consequences

- The identity-adoption pre-step is deliberately the *only* new mechanism;
  all schema DDL stays in the single existing import path.
- On MySQL, DDL commits implicitly, so rename + re-key is not atomic there;
  the pre-step is idempotent (it detects and completes a half-finished
  adoption on retry) rather than gated off per dialect.
- Bare-string references to a retired table id (workflow nodes, favorites,
  evaluation configs) stay stale; this is inherent to deletion and out of
  scope.

See `CONTEXT.md` for the vocabulary (recreated table, pre-sync twin, genuine
collision, lossless merge).
