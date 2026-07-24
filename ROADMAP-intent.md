# Roadmap: intent alignment — checkpoints + preference memory

Status: **planned (2026-07-24), nothing built.** This document is the source
of truth for the intent-alignment phases. It extends — never contradicts —
`proofjury-full-scope.md` (§4 two loops, §5 dataset moat, §8 redact at the
edge) and inherits every locked decision: deterministic checks alone decide
gates; the LLM advises and never blocks; BYOK only, no server-side LLM;
training-ready records from day one.

## The product in one sentence

Proofjury watches each moment a coding agent claims a chunk of work is done,
learns from how the user corrects it, distills those corrections into
durable preferences, and feeds them back to the agent *before* it codes —
so the agent drifts less from what the user actually wants.

## Why this is the second pillar

The correctness gate answers "will this break?" It cannot answer "is this
what the user wanted?" — code can be correct and still wrong: a 100k-line
single file when the user wants small modules, a landing page that takes
five re-prompts because the agent keeps misreading taste. Model vendors
will always out-code us on raw ability; none of them owns a durable,
**cross-agent, per-user** record of how their output misses this user's
intent. That is the same structural-neutrality gap the gate exploits, and
the corrections corpus — (stated task, diff, user's correction) — is the
same dataset moat extended from correctness failures to intent misses.
Today the system captures almost none of this: tier-5 advisory findings
fire only at gate events and only when `task_ref` was captured; advisory
labels teach the judge which of *its own opinions* the user values, not
what the user wants from *code*. The five-re-prompt loop is invisible.

## Architecture principles

1. **Boundary events, never per-turn interposition.** The sensor is the
   agent's turn end — the implicit claim of done — plus git commits as an
   agent-agnostic fallback. We never sit between user and agent on every
   exchange; we instrument the moments the agent yields.
2. **Advise, never block (in this pillar too).** Checkpoints and
   preferences produce context, not decisions. An opt-in "active" mode may
   later ask the agent to keep working once per turn; it ships last and
   defaults off.
3. **Zero perceived latency.** Deterministic capture runs inline in the
   hook (milliseconds); any LLM work runs in a detached background process
   whose findings are staged and delivered at the next natural injection
   point. A turn is never slowed waiting on the judge.
4. **Derived statements, not transcripts.** User messages are more
   sensitive than diffs. We persist scrubbed, distilled correction
   statements and preference sentences with record-id evidence pointers —
   never raw conversation logs (full-scope §8: minimize at capture).
5. **The prompt is the training feature.** Exactly like `advisory_input`:
   whatever the intent judge sees is persisted verbatim as the record's
   input, so runtime behavior and training pairs never diverge.

## The three components

### 1. Sensor — claim-of-done checkpoints

**Trigger.** Claude Code `Stop` hook (turn end; payload carries
`transcript_path`), registered by `proofjury init` alongside the existing
PreToolUse entry; `proofjury hook` grows an `--event` flag
(`pretooluse` default for back-compat, plus `stop`, `prompt`,
`session-start`). Agent-agnostic fallback: a git `post-commit` hook —
a commit is a claim of done in any workflow. Cursor/Codex turn-end
adapters follow as their hook APIs allow (verify current event names
before building; both marked LIVE VERIFICATION PENDING at first).

**Deterministic guards (all free, all inline).** A checkpoint is recorded
only when: checkpoints are enabled AND the worktree digest differs from
the last checkpoint's (reuses `session.worktree_digest`) AND the diff
since the last checkpoint meets `min_diff_lines` AND a per-session rate
cap isn't exceeded. No new diff → the turn was conversation → no record.

**What is captured.** A `checkpoint` record in `memory.jsonl` (schema
additive): the turn's task (this turn's user prompt via the existing
`task_from_payload` tail-read), diff summary since last checkpoint,
changed files, digest, session id, and — filled in later, possibly by a
background judge run — findings and an outcome label. Scrub applies to
everything, as everywhere.

### 2. Labels — how we learn a turn missed

**The next user message is the label.** A `UserPromptSubmit` hook
classifies the incoming prompt against the previous checkpoint:
`corrected` (the message redirects work the agent just claimed done),
`new_task`, or `accepted` (implicit — a new topic after a checkpointed
turn is weak acceptance). Classification is a single cheap BYOK call in
the background process, with deterministic priors (overlapping file
mentions, negation openers) and a conservative threshold — `unknown` is
an acceptable and common outcome. No LLM configured → labels stay
`unknown`; the sensor still records.

A confirmed `corrected` label stores a **distilled correction statement**
("wanted the component split into files under ~300 lines") plus an
intent-taxonomy category — not the raw message. TAXONOMY.md grows an
intent section (v0.3): initial categories `decomposition`, `size`,
`style_fidelity`, `framework_choice`, `naming`, `scope` (did more/less
than asked), `other`. Categories are the graduation signatures.

### 3. Memory + delivery — preferences

**Store.** `.proofjury/preferences.jsonl` (repo-scoped: "this project uses
Tailwind") and `${XDG_CONFIG_HOME}/proofjury/preferences.jsonl`
(user-scoped, cross-repo: "prefers small files" — follows the
registry.json patterns: atomic writes, self-healing, kill switch).
Schema: `pref_NNN`, statement, category, scope, status
(`candidate | active | rejected`), evidence (checkpoint record ids),
counts, timestamps.

**Graduation, mirroring advisories.** ≥3 corrections in the same category
and scope → a `candidate` preference is synthesized. Candidates require
explicit approval (`proofjury prefs approve pref_003`) to become
`active` — the user always curates what gets injected in their agent's
context. Rejected candidates suppress that signature, exactly like
rejected advisories. Repo-scoped preferences override user-scoped on
conflict; an active preference that keeps being contradicted by later
corrections is flagged stale for re-review rather than silently applied.

**Delivery — before coding, not after.**
- **Session start:** the `SessionStart` hook injects active preferences as
  context ("Proofjury preferences for this user/repo: …"). For agents
  without a session hook, `proofjury prefs export` writes them between
  markers into a gitignored local rules file (personal preferences never
  go into the committed AGENTS.md — that file is team-shared).
- **Next prompt:** staged checkpoint findings (the background judge's
  intent findings, retractions) drain as `additionalContext` on the next
  `UserPromptSubmit` — reusing the staged-note machinery advisories
  already have.
- **Gate events:** unchanged; the advisory judge's input simply gains an
  "active preferences" section so deploy-time findings are
  preference-aware too.

## What it will do — the two motivating examples, replayed

*The 100k-line file:* turn ends → checkpoint records the diff → user
replies "break this into smaller files" → classified `corrected`,
category `decomposition` → third such correction graduates a candidate →
user approves → every future session starts with "prefers modules under a
few hundred lines; has rejected single-file implementations 3×" → the
agent structures code that way on the *first* attempt.

*The landing page, five prompts:* each re-prompt labels the previous
checkpoint `corrected` with a distilled statement ("hero should match the
mockup's spacing", …). Even before graduation, the checkpoint judge's
next-prompt context can say "the last 2 turns on landing/S1Hero were
corrected for visual fidelity — re-check against the stated design before
claiming done." The re-prompt count itself becomes the product's success
metric.

## How the user interacts

- **Zero-config default:** `proofjury init` wires the new hook events;
  checkpoints record passively. Nothing is injected until the user
  approves a preference. `proofjury status` shows checkpoint/pref counts.
- **CLI:** `proofjury prefs list | approve | reject | add | rm`
  (manual `add` is the escape hatch — a user can just *state* a
  preference without waiting for graduation), `proofjury checkpoint`
  (manual trigger), `proofjury memory stats` gains re-prompt rate and
  intent-category counts.
- **Config:** `[checkpoint] enabled / min_diff_lines / max_per_hour /
  model`, `[prefs] enabled / inject_at_session_start`; env kill switches
  `PROOFJURY_NO_CHECKPOINT`, `PROOFJURY_NO_PREFS`.
- **Modes:** `off` → `passive` (record only; the I1–I2 default) →
  `advise` (session-start injection + staged notes; default once I4
  lands) → `active` (opt-in, I5: at most one "keep going" Stop
  continuation per turn, high-confidence tier-5 mismatch only, never for
  style preferences).
- **Dashboard (later, E-backlog):** an Intent tab — corrections timeline,
  preference board with approve/reject (syncing labels back through the
  existing label_events pull, like advisory labels today), re-prompt-rate
  chart per repo.

## How the model improves from this

1. **Immediately (no training):** personalization by memory — rejected
   signatures stop firing, approved preferences shape the agent's first
   attempt, checkpoint context flags repeat misses mid-session. The
   feedback loop that today only exists at deploy time runs at every
   claim of done.
2. **Measurably:** corrections-per-task is the metric. I2 (passive)
   captures a baseline before I4 (delivery) turns injection on — a
   natural before/after that becomes both the product's proof and the
   landing-page claim. If re-prompt rate doesn't drop, delivery isn't
   earning its context budget and we iterate on that evidence.
3. **Eventually (the moat):** the corpus of (task, diff, correction,
   category, resolution) across Claude Code / Cursor / Codex is the
   intent-misalignment dataset nobody else can collect — vendors see only
   their own agent, and never at the neutral layer. It trains the judge
   that predicts "this diff will get corrected, and how" — the trained
   intent judge is to this pillar what the trained correctness judge is
   to the gate (full-scope §5, unchanged flywheel).

## Limitations — honest, up front

- **Turn end ≠ done.** Agents yield mid-task to ask questions; those
  checkpoints review work-in-progress. Acceptable for an advisory
  surface; the diff guards keep pure-conversation turns out.
- **Labels are noisy.** Correction-vs-new-task classification will be
  wrong sometimes; that's why thresholds are conservative, `unknown` is
  normal, graduation needs 3 hits, and activation needs a human approve.
- **Uneven agent coverage.** Claude Code gets first-class events;
  Cursor/Codex start with partial adapters; the git-commit fallback works
  everywhere but fires at commit granularity. The neutrality story
  requires closing this gap — tracked, not assumed.
- **Offline degrades gracefully.** No LLM → checkpoints and diffs still
  record; no classification, no findings, no synthesis. Nothing breaks.
- **Preferences drift and conflict.** Handled by scope precedence,
  staleness flagging, and recency — but a preference system that nags or
  fossilizes is worse than none; rejection and decay are first-class.
- **Cost is real but bounded.** ~1 cheap-model call per checkpoint +1 per
  classification, BYOK, with rate caps and the same cheap defaults as the
  judge. No new spend for no-key users.
- **We influence, we don't control.** Injected context shapes the agent;
  it cannot force compliance. Only active mode applies pressure, and it
  is opt-in, capped, and last.

## Pinned invariants (tests written with, not after, each phase)

- Gate exit codes byte-identical with checkpoints/prefs on, off, or
  crashing (extends the existing invariance suite).
- Hook handlers for `stop`/`prompt`/`session-start` never emit permission
  decisions and complete inline work under a wall-time budget; LLM work
  is provably out-of-process.
- §5 schema stays additive; every persisted intent artifact passes the
  env-value scrub; raw prompts are never written to disk.
- A `rejected` preference/category never re-injects (signature
  suppression parity with advisories).

## Phases

- **I1 — Sensor (deterministic only).** `--event stop` + Claude Code
  registration + git post-commit fallback; checkpoint records with digest
  diffing and guards; stats surface. *Accept:* a session of N coding
  turns yields N-ish checkpoint records, zero LLM calls, invariance green.
- **I2 — Labels + baseline.** `--event prompt`; background classifier;
  outcome labels + distilled statements; TAXONOMY v0.3 intent categories;
  re-prompt metric (baseline capture). *Accept:* the five-prompt scenario
  produces 4 `corrected` labels in a scripted replay.
- **I3 — Checkpoint judge.** Background intent-advisory run at
  checkpoints (preference- and correction-aware prompt, persisted as
  input/output pair); staged findings drain via next-prompt injection;
  rejection suppression shared with advisories.
- **I4 — Preferences.** Store + graduation + `prefs` CLI + session-start
  injection + gate-advisory prompt gains preferences. Default mode
  becomes `advise`. *Accept:* the 100k-file scenario replayed end-to-end
  (3 corrections → candidate → approve → next session injects).
- **I5 — Active mode + surfaces.** Opt-in Stop continuation (capped,
  tier-5 only); dashboard Intent tab + label sync; cross-repo user-scope
  prefs hardening; Cursor/Codex adapter verification.

## Decisions — locked 2026-07-24 (owner approved)

- **Build order:** Claude Code first-class first; git-commit fallback (the
  `proofjury checkpoint` command, wired to `post-commit` by the user or a
  later opt-in) is the universal floor. Cursor/Codex adapters follow once
  their turn-end hook APIs are live-verified — parity is eventual, not
  simultaneous.
- **Implicit acceptance is its own label:** `accepted_implicit` — recorded
  distinctly (never folded into a binary accepted/corrected), so the
  observation is kept while its interpretation (metric weight, training
  weight) stays deferrable.
- **Models:** `[checkpoint] model` defaults to the provider's cheap tier
  and NEVER inherits `[advisory].model` — that override exists for
  low-volume deploy review; silently applying it at checkpoint volume
  would multiply cost ~20–50×. The classification call always uses the
  cheap tier even when the checkpoint judge is upgraded.
- **Hook-less delivery is injection-only for I4.** No preference export
  file until a per-agent personal-rules convention is verified
  (`prefs export` adapters are a fast-follow, not a blocker). Personal
  preferences never enter the committed AGENTS.md.
- **Preferences are personal-only.** Team conventions, when they come,
  will be a separate human-authored committed surface read alongside the
  learned store — never a shared version of it (provenance: preference
  evidence derives from private transcripts).

Implementation notes vs. the sketch above (decided at build time):
checkpoints live in their own `.proofjury/checkpoints.jsonl` (not
`memory.jsonl`) — they are high-volume, must not enter gate recall or
dashboard sync, and this keeps the pinned §5 record schema untouched.
Checkpoint findings ship injected-or-recorded only (no hold queue) in v1.
