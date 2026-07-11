# Program Trackers

One tracker doc per multi-week program. `program-manager` (a read-only sub-step of the weekly
strategy routine) audits every tracker here each Monday, recomputes milestone status from
**evidence, not vibes**, reports overall status into the weekly strategy brief, and files
suggestions for anything off track. The tracker doc in git is the durable record; the weekly
brief is where the owner sees status without opening the repo.

## Format

Each tracker starts with a header block:

```
Program: <name>
Source plan: <path to the plan doc this tracks>
Started: <YYYY-MM-DD>   Target end: <YYYY-MM-DD>
Overall: GREEN | AMBER | RED
```

Then the milestone table:

| id | milestone | phase | owner | target week | status | RAG | evidence probe | last verified | notes |

- **id** — short stable slug (`p1-stack`), never renumbered.
- **owner** — the agent or routine expected to deliver it, or `owner` for human actions.
- **target week** — the Monday (YYYY-MM-DD) of the week it should be done.
- **status** — `not-started | in-progress | done | blocked | dropped`.
- **evidence probe** — a machine-checkable assertion: a file exists at a path, a PR is merged,
  a `pipeline_settings` key is set, a `homepage_team_runs`/`_events` row exists with a given
  phase/agentRole. `done` requires the probe to pass; an unverifiable probe caps status at
  `in-progress` and RAG at AMBER.

## RAG rules (evidence-based, no vibes)

- **GREEN** — on schedule: probe passes, or target week not yet reached and prerequisites are
  moving.
- **AMBER** — at risk: target week reached with partial evidence; a named blocker exists but
  has an owner and a path; or the probe cannot be verified this run.
- **RED** — off track: past target week with no evidence; blocked with no path or owner; or a
  dependency was dropped/superseded.

Overall program RAG = RED if any milestone on the critical path is RED, else AMBER if ≥2
milestones are AMBER or any is blocked, else GREEN.

## Status log

Every tracker ends with a `## Status log` section. `program-manager` prepends one dated entry
per run: overall RAG, what moved since last run, what's stuck (with the RAG reason), and
explicit asks for the owner. Entries are append-only history; never rewrite old ones.

## Who writes here

Only `program-manager`, and only via a docs-only PR (branch `pm/tracker-<date>`, never
auto-merged). Anyone may add a new tracker for a new program by copying this format; register
it simply by placing the file in this directory — the PM globs `docs/store-team/trackers/*.md`.
