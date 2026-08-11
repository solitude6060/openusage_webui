# ADR: Preserve Local ccusage When Provider Refresh Fails

Date: 2026-08-11

## Context

The generic ccusage provider previously discarded Claude and Codex rows to prevent duplicate totals
when their plugins also returned structured local usage. If a Claude or Codex plugin refresh failed,
the generic local rows were still discarded and the Tokens page lost otherwise valid local usage.

The storage layer already clears overlapping token fields from same-date generic CLI rows after a
successful structured Claude or Codex refresh. It preserves historical cost and raw provenance.

## Decision

- Keep all recognized provider rows returned by the generic ccusage provider.
- Let a successful structured Claude or Codex refresh clear overlapping generic token fields.
- Keep generic local token totals when the corresponding plugin refresh fails.
- Preserve the existing provider-level refresh error and stored cost/raw evidence.

## Consequences

- Local token usage remains visible during provider authentication or usage API failures.
- Successful Refresh All runs continue to count Claude and Codex totals once.
- No API, database schema, or user setting changes are required.
