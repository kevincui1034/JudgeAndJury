# PLAN-swarmhack — Self-Evolving Agents Hackathon integration plan

Event: SwarmHack (luma.com/swarmhack), theme **self-evolving and
multi-agent systems**. Prize condition across all sponsors: the product
must be an **integral and vital** part of the project — bolt-ons lose.
Proofjury's pitch IS the theme: *a correctness gate whose memory makes
every agent it supervises improve — and now the judge itself retrains on
what it caught.*

**Sponsor set (locked): Actian + Pioneer + Replay (core three), Senso
(fourth, planned), Guild + Band (stretch, demo-level).** Prize pool
addressed: $3k Replay + $1k Actian + $500 Pioneer + $2k Senso credits
(+ $2k Guild, $1k Band if stretch lands).

## Ground rules for every stage (repo invariants — do not break)

1. Deterministic checks alone decide `blocked`/`exit_code`. Sponsor
   integrations are evidence sources, context, or judge transport —
   NEVER the decision, with ONE exception: a sponsor-backed
   *deterministic* check (Replay, stage H4) may fail the gate the same
   way tests_not_run does — from recorded facts, not model output.
2. Everything is best-effort/firewalled: sponsor API down → gate output
   byte-identical to a run without it (mirror `test_gate_sync_invariance`).
3. BYOK, scrub-at-edge: env-value scrub before anything persists or
   leaves the machine; raw prompts never on disk.
4. Each stage ends with: tests green (`cli: pytest -q`), demo passes
   (`scripts/demo.sh`), plus the stage's own acceptance check.
5. Schema changes additive only (§5 pinned key set; checkpoint schema
   likewise).

Stages are ordered by (leverage ÷ effort) and are independent unless a
dependency is named — an implementing model takes ONE stage, reads only
the files it lists, and lands it with tests.

---

## Stage H0 — Scaffolding (30 min, human)

- Branch `hack/swarmhack` off `feature/intent-alignment`.
- Accounts + keys: Pioneer (pioneer.ai), Actian VectorAI DB Community
  Edition (local install), Replay (access code `HACKATHON`), Senso
  (docs.senso.ai). Store keys in shell env only — never in the repo.
- Env names (used by later stages): `PIONEER_API_KEY`,
  `ACTIAN_VECTOR_PATH` (local dir), `REPLAY_API_KEY` (if API access),
  `SENSO_API_KEY`, `SENSO_KB_ID`.

## Stage H1 — Pioneer as a first-class judge provider  [Pioneer · $500]

The judge already speaks OpenAI-compatible chat (`_openai_compat.py` /
`OpenRouterJudge`). Pioneer exposes an OpenAI/Claude-compatible endpoint
with model routing — so this is an adapter, not a rewrite, and it makes
Pioneer the transport for EVERY LLM surface (diagnosis, advisory,
intent classifier, checkpoint reviewer) at once.

- **Files:** new `cli/src/proofjury/judge/pioneer.py`; edit
  `cli/src/proofjury/config.py` (provider tables), `cli/src/proofjury/judge/advisory.py`
  (`_ADAPTERS`), `cli/src/proofjury/judge/intent.py` (`_ADAPTERS`),
  `cli/src/proofjury/cli.py` (`JUDGE_PROVIDERS`, login flow).
- **Functions:**
  - `class PioneerJudge(OpenRouterJudge)` — override base URL to
    Pioneer's endpoint and default model to a routed cheap model; reuse
    `_chat()` wholesale.
  - `config.resolve_judge`: recognize `PIONEER_API_KEY` env +
    `provider = "pioneer"`; auto-detect order stays
    openrouter → anthropic → openai → pioneer.
- **Tests:** clone `test_judge.py`'s mock-endpoint pattern (the
  `PROOFJURY_OPENROUTER_URL`-style override) — add
  `PROOFJURY_PIONEER_URL` for a local mock; assert adapter selection,
  fallback-on-error, and that advisory + intent surfaces route through it.
- **Acceptance:** `PIONEER_API_KEY=… proofjury guard deploy --no-exec`
  produces an LLM diagnosis with `judge_model_id` prefixed `pioneer/`;
  offline behavior unchanged.

## Stage H2 — The self-evolving judge: fine-tune on our own records  [Pioneer · integral story]

Depends on H1. This is the thesis made real ON STAGE: memory records are
training-ready by design — Pioneer turns them into a tuned model in
hours, and the gate starts using it. "The dataset is the company" as a
live demo.

- **Files:** new `cli/src/proofjury/memory/finetune.py`; edit
  `cli/src/proofjury/cli.py` (new `memory finetune` command under
  `memory_app`).
- **Functions:**
  - `build_dataset(store, ckpt_store) -> list[dict]` — pairs:
    (`advisory_input` → labeled `advisories` outcomes) and
    (`checkpoint_input` → outcome label/category). Only labeled records;
    scrubbed text is already the stored form. Output JSONL matching
    Pioneer's fine-tune format (check docs; it's prompt→completion).
  - `submit(dataset_path, env) -> job_ref` — one Pioneer API call (their
    "single prompt" fine-tune agent); print the job ref + docs URL.
  - CLI `proofjury memory finetune [--dry-run]` — dry-run writes the
    dataset and prints counts per label; live submits.
  - Wire-up: once tuned, the user sets `[checkpoint] model` /
    `[advisory] model` to the returned model id — no code change needed
    (H1 adapter serves it).
- **Tests:** `build_dataset` on fixture records — asserts pair shapes,
  label filtering, and that NO unscrubbed/raw-prompt text can appear
  (source fields are the persisted scrubbed ones).
- **Acceptance (demo):** scripted loop — seed ~30 labeled records
  (extend `scripts/demo.sh` patterns), `memory finetune`, then show the
  intent classifier hit-rate on 10 held-out labeled checkpoints:
  routed base model vs tuned model. Even +2 correct is the story.

## Stage H3 — Actian VectorAI DB as the semantic memory layer  [Actian · $1k]

Recall today is heuristic (failure-class + recency + labels). Actian's
EMBEDDED, portable vector DB is the only sponsor shape compatible with
"analysis stays local" — it lives inside `.proofjury/` like the JSONL
does, same API from laptop to CI runner. It upgrades the core loop:
recall by meaning, not just class.

- **Files:** new `cli/src/proofjury/memory/semantic.py`; edit
  `cli/src/proofjury/gate.py` (index after append; candidate fetch),
  `cli/src/proofjury/memory/recall.py` (merge candidates),
  `cli/src/proofjury/config.py` (`[semantic]` table: `enabled`,
  `top_k=5`), `cli/pyproject.toml` (optional dep, extras group
  `[semantic]` so the base install stays lean).
- **Functions:**
  - `get_index(root, env) -> SemanticIndex | None` — opens/creates the
    Actian DB at `.proofjury/vector/` (or `ACTIAN_VECTOR_PATH`); returns
    None when lib/config absent — EVERYTHING degrades to current recall.
  - `SemanticIndex.index_record(record)` — embed
    `diagnosis + failure evidence + advisory concerns` (one doc per
    record; embedding via the resolved judge provider's embedding
    endpoint, Pioneer/OpenAI-compatible — reuse H1 transport; no key →
    skip indexing).
  - `SemanticIndex.candidates(query_text, k) -> list[record_id]`.
  - `recall.py`: semantic candidates are ADDITIVE inputs to the existing
    scorer — they can surface a prior the class-filter missed, they can
    never strong-match on their own (mirror the foreign-prior rule:
    context, not authority) and never override `EXCLUDED_RESOLUTIONS`.
  - Also index checkpoint correction statements → `semantic.py` powers
    "recent corrections on these files" in `_review_input` by meaning.
- **Tests:** fake embedder (deterministic hash → vector) so CI needs no
  key and no network; assert: index round-trip, candidate merge respects
  exclusions, recall output identical when index absent (invariance),
  `.proofjury/vector/` never enters the worktree digest
  (`session._drop_proofjury_*` already excludes `.proofjury`— assert it).
- **Acceptance:** demo moment — a NEW failure worded differently from
  its prior (`"payment key unset"` vs `"missing STRIPE_API_KEY"`) still
  recalls the old record via vector search where class+text heuristics
  alone wouldn't rank it first.

## Stage H4 — Replay QA as a gate check: browser-verified deploys  [Replay · $3k, biggest prize]

Two prongs — the check (integral) and the SaaS polish (their judging
criteria favors "well-designed SaaS apps with completed QA and all bugs
fixed").

**Prong A — `browser_qa` check class (integral).**
- **Files:** new `cli/src/proofjury/checks/browser_qa.py`; edit
  `cli/src/proofjury/checks/__init__.py` (register + CHECK_NAMES entry
  `"browser_qa"`), `cli/src/proofjury/cli.py` (`RUN_KINDS` += `"qa"`),
  `cli/TAXONOMY.md` (class 10: `browser_qa_failed` /
  `browser_qa_not_run` — additive, spec section mirroring tests_not_run).
- **Functions:**
  - `proofjury run qa -- <replay CLI or curl to Replay run>` — nothing
    new to build: `run` already stamps arbitrary kinds once `"qa"` is in
    RUN_KINDS; the stamp binds Replay's pass to the worktree digest.
  - `check_browser_qa(ctx)` — session-marker check identical in shape to
    `checks/tests.py` (copy it, rename, kind `"qa"`): skipped unless
    `.proofjury.toml [commands] qa` is configured (so every existing
    repo/test/demo is untouched); `missing/stale/digest-mismatch` →
    `browser_qa_not_run`; recorded nonzero exit → `browser_qa_failed`.
  - Optional richer evidence: `parse_replay_summary(log_path)` — pull
    bug count/URLs from the stamped run's log into the evidence string.
- **Tests:** copy `test_tests_check.py` shape for the new kind; assert
  skipped-when-unconfigured (demo.sh untouched), digest invalidation,
  and the evidence line.
- **Acceptance:** in the hackathon web app repo:
  `proofjury run qa -- npx replay-qa …` (or the loop-qa URL run recorded
  via a wrapper script) → gate blocks deploy until a **passing, current**
  Replay QA run exists. "The deploy is blocked because the browser tests
  Replay ran are stale" is the demo line.

**Prong B — the SaaS surface (judging optics).** Deploy the dashboard
branch as a PREVIEW (Vercel preview URL off `feature/hosted-dashboard`;
a preview is not the launch — or, if the owner prefers, a small
purpose-built demo web app the coding agent builds live on stage). Run
Replay QA against that URL, feed its bug reports to the coding agent,
fix, re-run to green, and keep the before/after recordings for the
pitch. **Owner decision needed: preview-deploy the WIP dashboard vs.
stage-built demo app.**

## Stage H5 — Senso as the team-conventions context layer  [Senso · $2k credits]

Proofjury deliberately deferred human-authored team conventions
(ROADMAP-intent.md locked decision: conventions ≠ learned prefs, they're
a separate authored surface). Senso IS that surface: deploy runbooks,
style guides, and policies compiled into a verified KB the judge can
query — with citations, which matches "proof, not promises".

- **Files:** new `cli/src/proofjury/judge/conventions.py`; edit
  `cli/src/proofjury/config.py` (`[conventions]` table: `enabled=false`
  by default, `senso_kb`), `cli/src/proofjury/gate.py` +
  `cli/src/proofjury/checkpoint.py` (one extra AdvisoryInput /
  review-input section), `cli/src/proofjury/judge/advisory.py`
  (`AdvisoryInput.conventions: list[str] = []` + a prompt section
  emitted only when non-empty — same pattern as `preferences`).
- **Functions:**
  - `fetch_conventions(changed_files, task, env, config) -> list[str]` —
    one Senso REST query ("policies relevant to: <files, task>"), each
    result rendered as `"<statement> [source: <doc>]"`. Timeout 3s,
    any error → `[]` (firewalled).
  - Findings that cite a convention keep the `[source: …]` citation in
    the concern text — the dashboard/CLI shows a grounded, cited policy
    hit.
- **Setup (human, 20 min):** ingest 3–5 short authored docs into a Senso
  KB: deploy runbook, "no direct-to-main deploys after 5pm", "payments
  code requires a second QA pass", frontend conventions.
- **Tests:** injected fake fetcher; assert section only-when-non-empty
  (advisory prompt byte-identical otherwise — extend
  `test_advisory_prompt_gains_preferences_section` pattern), firewall on
  exception, disabled-by-default.
- **Acceptance:** a diff touching `payments.py` at the gate yields an
  advisory finding citing the runbook doc by name.

## Stage H6 (stretch) — Guild.ai governs the agent fleet  [Guild · $2k]

Demo-level, no CLI changes: run the stage demo's coding agents under
Guild's control plane, and register the Proofjury gate as the
deploy-policy step Guild enforces pre-dispatch (Guild intercepts the
deploy tool call → executes `proofjury guard deploy --no-exec --json` →
allows only on exit 0). Defense-in-depth story: Guild governs WHO may
act and budgets; Proofjury proves the action is CORRECT. Deliverable is
a Guild workspace config + a thin policy webhook (TypeScript, their
SDK) — keep it in `hack/guild/` inside the hackathon branch, not the
product tree.

## Stage H7 (stretch) — Band as the cross-agent verdict mesh  [Band · $1k]

Demo-level: a Band channel `proofjury-verdicts` where every gate verdict
and advisory publishes (one `POST` from a tiny `hack/band/publish.py`
invoked exactly where sync's post-gate hook runs — same firewall rules).
Second machine's agent subscribes: when agent B attempts the mistake
agent A made, its Proofjury already recalls the record AND Band shows
the fleet-level warning in real time. This is the "cross-agent memory"
moat rendered visible in a multi-agent demo — thematically perfect for
SwarmHack, thin by design.

## Stage H8 — Demo assembly + pitch (last 2–3 hours, human + any model)

One scripted arc, each sponsor load-bearing in sequence:
1. Coding agent (under **Guild**, stretch) builds/edits the web app.
2. It tries to deploy → **Proofjury blocks**: tests stale, AND
   `browser_qa_not_run` (**Replay**), AND an advisory citing the deploy
   runbook (**Senso**), diagnosis written via **Pioneer**.
3. Agent fixes, runs Replay QA green, redeploys → pass; verdict
   broadcast on **Band** (stretch); second agent's repeat mistake is
   recalled semantically via **Actian** despite different wording.
4. Finale: `proofjury memory finetune` → **Pioneer** returns the tuned
   judge → the gate is now measurably better *because of everything it
   caught during the demo*. Self-evolving, on the record.

Pitch line: *"Every agent in the swarm ships through one gate; every
mistake makes the gate smarter; tonight the gate retrained itself."*

## Effort budget (1-day hack, two implementers + models)

| Stage | Est. | Prize | Risk |
|---|---|---|---|
| H1 Pioneer adapter | 1–2 h | $500 | low — adapter clone |
| H3 Actian semantic recall | 3–4 h | $1,000 | med — lib API unknown until H0 |
| H4 Replay check + QA pass | 2–3 h | $3,000 | low (check) / med (SaaS polish) |
| H2 Pioneer fine-tune | 2–3 h | (same $500, but the story) | med — job turnaround time; start EARLY, it runs async |
| H5 Senso conventions | 2 h | $2,000 credits | low |
| H6 Guild (stretch) | 2 h | $2,000 | med — TS SDK, new surface |
| H7 Band (stretch) | 1–2 h | $1,000 | med — API access unknown |

Ordering note: kick off H2's fine-tune job as soon as H1 lands (it runs
~hours async, per Fastino's docs) and build H3/H4/H5 while it cooks.
