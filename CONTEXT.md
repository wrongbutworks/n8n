# Context

Ubiquitous language for n8n source-control ("Environments") sync of data
tables. Glossary only — no implementation details.

## Terms

**Data table** — A named, project-scoped tabular resource. Its *schema*
(columns) is synced through source control; its *rows* are always local to an
instance and never synced.

**Sync identity** — The identity of a data table across instances, defined as
the id recorded in git. When a destination instance holds the same logical
table under a different id, the destination converges by adopting the git id.
A data table's uniqueness key within an instance is `(project, name)`; sync
identity and uniqueness key are distinct concepts.

**Source / destination** — Directional roles in a pull: the git repository is
the source; the instance pulling is the destination.

**Previously synced (table)** — A destination table whose id has ever appeared
in the git repository's history. The opposite is a *never-synced* table: one
created locally that git has never known.

**Name collision** — On pull, an incoming table and a destination table share
`(project, name)` but differ in id. The incoming id is new to the destination
in every collision; collisions are classified solely by the destination
table's sync history and the losslessness of the merge.

**Lossless merge** — A merge where every destination column has a matching
incoming column by `(name, type)`, so no destination column is removed or
retyped and no cell data can be lost.

**Recreated table** — A name collision where the destination table was
previously synced: the same logical table over time, deleted and recreated
upstream under a new id. Always reconciled; schema differences are aligned
per the documented (possibly lossy) contract.

**Pre-sync twin** — A name collision where the destination table was never
synced and the merge is lossless: typically the same table created
independently on both instances before source control was adopted. Reconciled
automatically.

**Genuine collision** — A name collision where the destination table was never
synced and the merge would be lossy: a private local table with local-only
data at stake. Never reconciled automatically; surfaced as a per-table
conflict that never aborts the rest of the pull. Replacement is expressed
only by an explicit destructive act (renaming or deleting the local table).

**Reconciliation (identity adoption)** — Resolving a name collision by
re-keying the destination table to the incoming sync identity while
preserving its rows, then letting ordinary schema alignment proceed. An
identical recreate reconciles to a no-op.

**Stale reference** — A workflow node, favorite, or evaluation config pointing
at a retired table id after a delete+recreate. References are bare strings
with no referential integrity; going stale is inherent to deletion and out of
scope for reconciliation. Known limitation.
