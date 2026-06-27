# Plan: Upstream Sync + Codex Reset-Credit Expiry + Dashboard UX Polish

Date: 2026-06-28
Author: Margo
Status: Approved (autonomous end-to-end execution authorized)
Track: 3 tasks across 2 PRs

---

## 0. Why this doc exists (SDD)

This is the canonical contract for three pieces of work the user asked for in one
session. Read this before touching code. Every claim below is grounded in a verifiable
observation (git output, file path + line, or a fetched source); the evidence is cited
inline so a reviewer can re-check it.

---

## 1. Findings (the ground truth, verified)

### 1.1 We and "upstream" are now two different programs

- Our repo (`solitude6060/openusage_webui`) was forked from `robinebers/openusage`
  during its **Tauri** era. Confirmed in `AGENTS.md:79` ("This repo is a GitHub fork of
  `robinebers/openusage`").
- Upstream has since **rewritten the app in Swift** as a *fresh, squashed history*.
  Evidence: `upstream/main` root commit is `53bc2f0 "OpenUsage — native Swift edition"`
  (2026-06-15), total 152 commits; its changed paths are dominated by `Sources/OpenUsage`
  (Swift, 563 file-touches) and `Tests/OpenUsageTests` (166).
- Our `main` and `upstream/main` share **no common ancestor**
  (`git merge-base main upstream/main` → empty). A plain merge is impossible without
  `--allow-unrelated-histories` and would be meaningless (different language/framework).
- The branch that *does* share our lineage is **`upstream/tauri-legacy`**
  (`git merge-base main upstream/tauri-legacy = 35f3188`, whose root `2611e82 "hello
  world :)"` is identical to ours). That branch is the Tauri code upstream kept as
  "legacy" while moving to Swift.

**Implication:** "merge upstream updates" means diffing against `upstream/tauri-legacy`,
never `upstream/main`.

### 1.2 What `tauri-legacy` has after our fork point (the only mergeable surface)

12 commits in `main..upstream/tauri-legacy`. Reviewed one by one:

| Commit | Subject | Take? | Reason |
|---|---|---|---|
| `b1b4d32` | fix: patch security vulnerabilities via dep updates (#712) | **YES** | We are exposed (see 1.3). |
| `ff9e8ca` `d4b8564` `7d51e5b` `6dfbc5e` | retirement-notice banner | NO | Banner literally tells users "this build is retired, go to the new app" (verified in commit diff: `docs/retirement-notice.md`). Harmful to our fork. |
| `445f571` `9d7fef7` `68e4209` `dcf18db` `026b419` | Tauri→Swift rollout guardrails / release-tauri skill chores | NO | Upstream's own migration/release process. Irrelevant to us. |
| `d88abd1` | chore: remove General Question from issue template | NO | Cosmetic, upstream repo housekeeping. |
| `0a08306` | chore: bump version to 0.6.28 | NO | Upstream's versioning, not ours. |

**Verdict: only the security fix is worth taking.**

### 1.3 We are genuinely exposed to the #712 advisories

| Dependency | Ours (verified) | Fixed in | Advisory |
|---|---|---|---|
| `vite` | `8.0.14` (bun.lock), declared `^8.0.5` (package.json:66) | `8.0.16` | GHSA-fx2h-pf6j-xcff |
| `undici` | `7.24.5` (bun.lock) | `7.28.0` | GHSA-vmh5-mc38-953g, GHSA-vxpw-j846-p89q, GHSA-hm92-r4w5-c3mj |
| `quinn-proto` | `0.11.14` (src-tauri/Cargo.lock:3944) | `0.11.15` | RUSTSEC-2026-0185 (memory exhaustion) |

### 1.4 Codex reset display — we already do windows; we lack credit-expiry

Our codex plugin already shows rate-limit **window** resets:
- `plugins/codex/plugin.js:355` `getResetsAtIso()` reads `reset_at` / `reset_after_seconds`
  from `rate_limit.primary_window` / `secondary_window` of the `/wham/usage` response and
  attaches `resetsAt` (ISO) to the "Session" / "Weekly" progress lines.
- The JWT `access_token.exp` claim is decoded in `needsRefresh()` (plugin.js:181–195) but
  only for *internal* token-refresh decisions — never surfaced to the user.
- It also shows a "Rate Limit Resets" *count* line (plugin.js:830–841) from
  `data.rate_limit_reset_credits.available_count` (a summary field on `/wham/usage`).

What `jordan-edai/codex-reset-watcher` adds that we don't have (researched from its
source on branch `main`):
- It calls a **dedicated endpoint** `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`
  that returns `credits[]`, each with an **`expires_at`** ISO8601 string and a `status`.
- It computes an **expiry urgency** per available credit
  (`Sources/CodexResetWatcher/Models/ResetExpiryUrgency.swift`):
  `<=0` expired · `<=86400s` ends today · `<=3d` expires soon · `<=7d` this week · else normal.
- Headline value: warn the user "your banked reset credit expires today — use it or lose it".

**Gap to close (Task 2):** we show *how many* reset credits are available, but never that
*one expires today*. Port the dedicated-endpoint fetch + per-credit `expires_at` parse +
urgency, and surface it on the dashboard.

### 1.5 Fork-removal constraint

GitHub's fork *relationship* is server-side metadata; there is no `git`/`gh` command to
detach it. The robust mitigation for "PRs must not open against robinebers" is the pinned
default repo, which is **already in place**: `gh repo set-default --view` →
`solitude6060/openusage_webui` (also documented in `AGENTS.md:79`).

---

## 2. User decisions (locked)

1. **Fork removal** = pin default repo only. Remove the temporary `upstream` remote;
   do **not** touch GitHub's server-side fork metadata.
2. **Task 1 scope** = apply the 3 security bumps + one-by-one review of other tauri-legacy
   commits (done in §1.2; verdict: take only the security fix).
3. **Task 2 display** = new dashboard line + urgency badge.
4. **Task 3** = make the dashboard UI/UX nicer, surveying/using a design skill.
5. **Execution** = autonomous end-to-end: build → verify → triple review → PR → merge,
   no per-gate approval pauses. Planning/spec/review files still land in the repo.

---

## 3. Design per task

### Task 1 — Upstream sync (security + fork hygiene)

- **Security bumps**, applied to *our* (monorepo) tree, not cherry-picked from upstream's
  differently-shaped `package.json`:
  - `vite`: bump declared range so the resolved version is `>= 8.0.16`; refresh `bun.lock`.
  - `undici`: add a root `overrides` entry `"undici": "7.28.0"` (we already have an
    `overrides` block: `package.json:69`).
  - `quinn-proto`: `cargo update -p quinn-proto --precise 0.11.15` in `src-tauri/`.
- **Fork hygiene**: `git remote remove upstream`; verify the pinned default; document the
  verified divergence so nobody re-adds upstream by reflex.
- **TDD note**: a dependency-version bump has no natural failing unit test. Verification is
  build + existing test suite green + advisory versions confirmed in the lockfiles. This
  is a documented TDD exception (global CLAUDE.md §2: generated code / deps).

### Task 2 — Codex reset-credit expiry (port + surface)

Data flow to build (TypeScript/JS, no new deps — reuse the plugin's existing
`ctx.host.http` + bearer/header machinery):

1. **Plugin** (`plugins/codex/plugin.js`): after the existing `/wham/usage` fetch, GET
   `/wham/rate-limit-reset-credits` with the same headers
   (`Authorization: Bearer …`, `originator: Codex Desktop`, `OAI-Product-Sku: CODEX`,
   `Accept: application/json`, `ChatGPT-Account-Id`). Parse `credits[]`:
   - keep `status === "available"` (case-insensitive),
   - parse `expires_at` (ISO8601, tolerate fractional seconds),
   - find the **soonest** expiry, compute urgency tier from `expires_at - now`.
   - **Tolerant decode**: a single malformed credit is skipped, not fatal (matches
     watcher's `FailableDecodable` behavior and AGENTS.md "fail loudly but stay tolerant
     at boundaries").
   - Emit one badge line: `ctx.line.badge({ label: "Reset Credit Expiry", text: "in 18h",
     tone: "urgent" })`. If no available credit has an expiry, emit nothing (no silent
     fake data).
   - Network/HTTP failure on this *secondary* endpoint must **not** break the primary
     usage card — log and skip the expiry line.
2. **Line API** (`packages/providers/src/providers/openusage-plugin-api.ts`): add `tone`
   to the `badge` allow-list (currently `["type","label","text","color","subtitle"]`).
3. **Web UI** (`apps/web/src/App.tsx`): in `UsageLine`, map a badge `tone`
   (`urgent|soon|week|normal|expired`) to a `status-pill` urgency class.
4. **CSS** (`apps/web/src/styles.css`): add `.status-pill.urgent/.soon/.week/.expired`
   variants using existing theme vars (`--warning`, `--warning-soft`, etc.), light+dark.

Urgency tiers (mirror the watcher exactly): `<=0` → expired · `<=1d` → urgent ("Ends
today") · `<=3d` → soon · `<=7d` → week · else → normal.

### Task 3 — Dashboard UI/UX polish

- Invoke the **`frontend-design`** skill (claude-plugins-official). Survey first, then
  apply.
- **Scope (YAGNI):** the provider usage cards on the dashboard + the new reset-expiry
  badge — visual hierarchy, spacing, typography, progress-bar treatment, urgency color
  semantics, dark mode. **Not** an app-wide rebrand; stay inside the existing
  CSS-variable design system (`apps/web/src/styles.css`).
- AGENTS.md:84 requires **before/after screenshots** for any visual PR — capture them.

---

## 4. Phased plan (PRs + exit criteria)

### PR1 — `chore/upstream-sync-2026-06` (Task 1)
1. Commit this plan doc (audit trail).
2. Apply 3 security bumps; refresh lockfiles.
3. Remove `upstream` remote; verify pin; doc the divergence.
4. **Exit:** `bun install` resolves; web build OK; `vitest` green; advisory versions
   confirmed (`vite>=8.0.16`, `undici 7.28.0`, `quinn-proto 0.11.15`); review doc landed;
   triple review APPROVE; PR merged `--no-ff` into `main`.

### PR2 — `feat/codex-reset-credit-expiry` (Task 2 + Task 3), branched off updated `main`
1. Task 2 TDD: red plugin test (mock `/wham/rate-limit-reset-credits`) → green plugin impl
   → line-API passthrough → web render → CSS.
2. Task 3: frontend-design polish of the cards + badge; before/after screenshots.
3. **Exit:** new `vitest` tests green (plugin urgency tiers + tolerant decode + UI badge
   mapping); full suite green; web build OK; screenshots attached; README plugin section
   still accurate; triple review APPROVE; PR merged `--no-ff` into `main`.

**Branch base:** `main` (observed convention — recent PRs merge into `main`, e.g. #14–#16).
**PR target:** `gh pr create -R solitude6060/openusage_webui ... --base main`.

---

## 5. Testing strategy (TDD)

- **Plugin (`plugins/codex/plugin.test.js`, vitest):** mock the new endpoint via the
  existing `makeCtx()` http stub; assert (a) urgency tier per `expires_at` offset,
  (b) soonest-credit selection, (c) tolerant decode drops one bad credit, (d) no line when
  no available credit has expiry, (e) secondary-endpoint failure doesn't kill the card.
- **Web (`apps/web/src/*.test.ts`, vitest):** assert badge `tone` → urgency class mapping
  and that the expiry line renders.
- **Task 1:** no new unit test (dep bump); verification = build + suite + lockfile assertion.
- Test runner is **`vitest`** (`package.json` `"test": "vitest"`; project memory: use
  `vitest`, not `bun test`).

---

## 6. Docs to update (AGENTS.md:9 — logic changes update docs)

- `README.md` — codex plugin capabilities (now surfaces reset-credit expiry).
- `docs/plugins/` and/or `docs/providers/` — codex reset-credit expiry behavior (simple,
  skimmable per AGENTS.md:11).
- `docs/dashboard.md` if present — the new card element.
- `AGENTS.md` "Before Creating Pull Request" — only if accuracy improves.

## 7. Triple review (global CLAUDE.md §5 + repo convention)

- Review docs land in `docs/reviews/2026-06-28-<scope>-triple-review.md` (matching
  existing `docs/reviews/*-triple-review.md`).
- Three independent passes, at least one by a **different model** (Codex via the
  `codex` rescue agent). Loop review → triage → TDD-fix → re-review until APPROVE.
- Findings + fixes recorded in `docs/fix-logs/`.

## 8. Risks

- **Codex API drift:** `/wham/rate-limit-reset-credits` is an internal ChatGPT endpoint;
  shape may change. Mitigation: tolerant decode + skip-on-failure, no card breakage.
- **No live Codex auth in CI:** the new code path is exercised by mocked tests, not a live
  call. Acceptable; matches existing codex plugin test pattern.
- **Visual regression (Task 3):** mitigate with before/after screenshots + keeping changes
  inside the existing design-token system.

---

## 9. Revision (2026-06-28, in-flight feedback)

Two pieces of user feedback during implementation, plus one bug caught by visual
verification:

1. **Codex-only — confirmed, no change.** Reset credits are a Codex-only mechanism. The
   detection lives solely in `plugins/codex/plugin.js`; only the Codex card emits these
   lines. The line-API/UI plumbing (`tone`, `expiresAt`) is generic, but no other provider
   produces such badges, so it is Codex-only in effect.

2. **Exact date per credit (display redesign).** The original design showed a single badge
   for the *soonest* credit with a rounded, fuzzy label ("Ends today", "in 5d"). The user
   asked to see the **exact countdown date for each** reset credit. New design:
   - Plugin emits **one line per available credit** (soonest first), each carrying the
     **exact `expiresAt` timestamp** + an urgency `tone` — no baked text.
   - The dashboard renders a stacked row: a header (label + a **live countdown** pill that
     stays fresh between refreshes, computed in the UI) over the **exact expiry date**
     (`Intl.DateTimeFormat` medium date + short time, e.g. "Jul 3, 2026, 8:00 PM").
   - Tier thresholds unchanged (expired / urgent ≤1d / soon ≤3d / week ≤7d / normal).

3. **CSS specificity bug (found via computed-style probe, fixed).** The first cut put the
   urgency pill as a direct `.usage-text-line > span:last-child` (specificity 0,0,2,1),
   which outranks `.status-pill.reset-*` (0,0,2,0) and forced the muted color onto every
   pill — only the background tints showed. A screenshot alone could have missed it;
   `getComputedStyle` caught that `color` was `rgb(85,85,85)` everywhere. Fix: the stacked
   layout nests the pill inside `.usage-credit-expiry-header`, so it is no longer that
   direct last-child and its own tier color wins. Verified: urgent→`--warning`,
   soon→`--caution`, week→`--ink-secondary`, expired/normal→`--muted`.

4. **Task 3 signature.** A leading status dot (`currentColor`) on each urgency pill —
   solid for active tiers, a hollow ring for `expired` — makes urgency glanceable and keeps
   the signal off color alone (the pill text always says it too). Boldness spent in this one
   place; the rest of the card stays quiet.

Screenshots (light + dark): `docs/reviews/screenshots/2026-06-28-codex-reset-credit-expiry-{light,dark}.png`.
