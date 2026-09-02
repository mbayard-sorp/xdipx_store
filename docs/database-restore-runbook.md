# Database restore runbook

**Status:** first version, 2026-09-02. Written as Stage G1 of the response to the
2026-09-01 agent automation audit, where "backups and restore" was the only line
marked RED with nothing at all behind it.

Before this, a grep of the whole repository for `pg_dump`, Neon branching, PITR
or any restore policy returned zero hits outside prose in two earlier audits.
Meanwhile the four stages that shipped that same week each increased the number
of writes this system makes to this database with no human in the loop. This
document and the machinery it describes exist because a system that manages
itself but cannot be restored is not self-sufficient; it is one bad migration
from unrecoverable.

---

## 1. What you are restoring

Measured 2026-09-02 against production.

| | |
|---|---|
| Total size | 231 MB |
| Tables in the `public` schema | 105 |
| Largest table | `pricing_audit_log`, 432,013 rows, 188 MB — **81% of the whole database** |
| Tables classified `critical` and dumped nightly | 62, 17,137 rows, 16 MB on disk |

**This database is shared, and nothing in the repository recorded that until
now.** Nineteen tables in the `public` schema belong to a dormant video-studio
application — `characters`, `scenes`, `shots`, `takes`, `scripts`, `productions`,
`loras`, `pods`, `pod_sessions`, `assets`, `cost_ledger`, `jobs`,
`activity_events`, `_studio_marker`, `call_qualification_scripts`,
`character_refs`, `scene_characters`, `script_messages`, `settings` — all at 0-1
rows. A further nine live in the `neon_auth` schema and are Neon's own, plus
`drizzle.__drizzle_migrations`.

This matters for exactly one reason, and it is the first decision below.

---

## 2. Choose the path first. They are not interchangeable.

### Path A — Neon point-in-time restore

**Use when:** a migration went wrong, or a bulk write corrupted many tables at
once, and you want the whole database as it was at a moment in time.

**Do not use when:** one table was clobbered and everything else has been
written to since. **A PITR rewinds the entire database**, which means it also
rewinds the video-studio tables above, every order and conversation that landed
in the meantime, and every ticket the fleet has moved. There is no such thing as
a partial PITR.

**Steps.**

1. Neon Console → the xdipx project → **Branches** → **Create branch**, and pick
   *Time* as the branch point. Choose a timestamp a few minutes **before** the
   bad write.
2. The branch comes up with its own connection string. **Do not repoint
   production yet.** Connect to the branch read-only and confirm it actually
   holds what you expect:
   ```sql
   SELECT max(started_at) FROM homepage_team_runs;     -- is this before the incident?
   SELECT count(*) FROM homepage_team_suggestions;     -- does this match pre-incident?
   SELECT version FROM schema_migrations_applied ORDER BY applied_at DESC LIMIT 5;
   ```
3. Decide what you are moving: the whole database, or rows out of one table.
   - Whole database: promote the branch to primary in the Neon console, then
     update `DATABASE_URL` in Vercel and redeploy. Everything written since the
     branch point is gone.
   - One table: keep the branch as a side connection and copy the rows across
     (`INSERT ... SELECT` over a dblink, or dump the one table from the branch
     with `pg_dump -t`). Slower, and it is almost always the right answer.
4. Re-run `npx tsx scripts/apply-migrations.ts` against the restored database if
   step 2 showed it behind on migrations.

> **The retention window is currently an assumption, not a fact.** Neon's
> history retention is a plan setting, and nothing in this repository can read
> it — there is no `NEON_API_KEY` in the environment. Until there is, nobody can
> say how far back Path A reaches. That is filed as an owner blocker, and it is
> the single most load-bearing unknown in this document: if the window turns out
> to be 24 hours, Path A is only useful for something noticed the same day, and
> Path B below becomes the primary path rather than the surgical one.

### Path B — the nightly logical dump

**Use when:** one or a few tables were clobbered and you want them back without
touching anything else. Also the only path if the Neon project itself is gone.

**What exists.** `/cron/db-backup` runs at 04:40 UTC and writes one gzipped
NDJSON object per critical table to a **separate, private Vercel Blob store**,
under `db-backup/<YYYY-MM-DD>/<table>.ndjson.gz`, plus a `_manifest.json`
recording per-table row counts and byte sizes. Fourteen days are kept.

**A separate store, not a separate flag.** The first live run failed on the
first table with `Cannot use private access on a public store. The store must
be configured with private access.` Access is a property of the store in Vercel
Blob, and the existing store has to stay public — the video and ad pipelines put
bytes there that Instagram and Meta fetch by URL, so flipping it would break
publishing to fix backups. Dumps therefore go to a second store with its own
token, `BLOB_BACKUP_READ_WRITE_TOKEN`, and there is deliberately **no fallback**
to the public token: a fallback would put consent records, voicemail rows and
SMS transcripts on a public URL the moment the private token went missing.

Private is not a detail. The critical tier contains consent records, SMS and
voicemail transcripts, order lines and every conversation a customer has had
with Emma. A random URL suffix is obscurity, not access control, so these objects
are never written through the public `blobPut` path.

**Steps.**

1. Confirm the snapshot you want exists and was graded readable:
   ```sql
   SELECT id, kind, started_at, status, snapshot_key, total_bytes, error
     FROM backup_runs ORDER BY started_at DESC LIMIT 10;
   ```
   You want a `dump` row with `status='succeeded'` and, after it, a
   `restore-probe` row with `status='succeeded'`. A `partial` dump wrote **no
   manifest** and is deliberately unusable: it is not a smaller backup, it is a
   failed one.
2. Fetch the object. It is private, so this needs the blob read-write token from
   the Vercel environment (`BLOB_READ_WRITE_TOKEN` or `XDIPX_READ_WRITE_TOKEN`):
   ```ts
   import { blobGetPrivate } from '~/lib/blob.server'
   const gz = await blobGetPrivate('db-backup/2026-09-02/consent_log.ndjson.gz')
   ```
   Or from a script, via `app/lib/db-backup.server.ts`, which is the only file
   that knows the path layout.
3. Inspect before you write. One JSON object per line, column names as they come
   out of Postgres:
   ```
   zcat consent_log.ndjson.gz | head -3 | jq .
   zcat consent_log.ndjson.gz | wc -l     # must equal the manifest's row count
   ```
4. Load it back. There is deliberately no automatic restore command: a script
   that writes 17,000 rows into production on one argument is a worse hazard
   than the one it guards against. Write the `INSERT ... ON CONFLICT DO NOTHING`
   for the specific table, run it inside a transaction, and check the count.

**What Path B does not cover.** Only the 62 `critical` tables are dumped.
`derived` tables rebuild from their named external source (Shopify, the Nalpac
feed, Search Console, a recompute cron); `disposable` tables are gone and that
is the accepted trade. `app/lib/backup-manifest.ts` holds the classification and
the reason for each one, and its rule for anything uncertain is that it goes in
`critical`.

---

## 3. How you find out it is broken

Three independent signals, deliberately, because the failure being guarded
against is a backup that reports success over nothing.

| Signal | Where | What it means |
|---|---|---|
| `/cron/db-backup` missing from `cron_runs` | janitor sweep, every 6h | The dump did not run. Daily cadence, 120-minute grace. |
| `/cron/db-restore-probe` recorded `failed` | `cron_runs` | The newest dump could not be read back, or is more than 36 hours old. |
| `unclassified` non-empty in the dump result | the run's `result` JSON, and the cron log | A live table exists that `backup-manifest.ts` has never heard of, so it is not being backed up. |

That third one is the normal steady state of this system rather than an
exception: a migration that adds a table is merged by the release engine
unattended, and nothing in that path asks whether the new table needs backing
up. It is loud on purpose.

Both crons answer **HTTP 500** on a failed or partial run. That is not cosmetic:
`classifyCronOutcome` reads any 200 without a `skipped` string as `succeeded`, so
answering 200 with `ok: false` would record a failed backup as a healthy cron
run — the exact "prints GOOD over a dead pipeline" failure this program exists
to remove.

---

## 4. Row drift, which is the part that decides whether any of this helps

A point-in-time restore only reaches back as far as the retention window, so what
actually determines whether a mass-delete is recoverable is **how quickly anyone
notices**. Before this stage nothing would have: an agent DML bug that emptied
800 rows from `homepage_team_suggestions` would have left no trace except the
rows being gone.

Each nightly dump compares its per-table row counts against the previous
successful dump and logs every table that **lost** rows. Growth is never
reported — every table here grows every day, and an alarm that fires constantly
is trained away before the day it matters.

To read it by hand:

```sql
SELECT started_at, tables FROM backup_runs
 WHERE kind = 'dump' AND status = 'succeeded'
 ORDER BY started_at DESC LIMIT 2;
```

---

## 5. What is still missing

Stated here rather than left implied, because an incomplete restore path that
reads complete is the failure mode this whole document is about.

- **The Neon retention window is unknown** (§2, Path A). Owner blocker filed.
  Until `NEON_API_KEY` is set, no probe can check it and nobody can say how far
  Path A reaches.
- **No restore has ever been rehearsed end to end.** The probe proves the bytes
  read back and parse. It does not prove that loading them into a live table
  produces a working store. That drill needs a scratch Neon branch, which needs
  the same API key.
- **Path B is manual by design, and that is a real cost.** Restoring one table
  is currently a person writing SQL against an NDJSON file at the worst possible
  moment. The alternative — a scripted restore — is a command that can write
  thousands of rows into production on one argument, which is a larger hazard
  than the one it removes. Revisit if a restore is ever actually needed.
- **Blob storage is one provider.** A snapshot that survives the Neon account
  does not survive the Vercel account. A second destination is worth having
  before it is worth automating.
- **The private store does not exist yet.** Until it does and
  `BLOB_BACKUP_READ_WRITE_TOKEN` is set, `/cron/db-backup` records `skipped`
  every night and there is no dump at all. Owner blocker filed.
