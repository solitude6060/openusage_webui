# WebUI Codex Multi-Instance Implementation Plan

> **For agentic workers:** Implement task-by-task. Docs to update: `docs/providers/codex.md`, `docs/USER_GUIDE_WEBUI.zh-TW.md`.

**Goal:** Let WebUI users add multiple Codex homes and see one card per home.

**Architecture:** Persist instances in SQLite; rebuild `getProviders()` with per-instance `CODEX_HOME`; Settings page for detect + CRUD.

**Tech Stack:** Bun, SQLite, existing `OpenUsagePluginProvider`, React Settings page.

## Tasks

1. Core: `CodexInstance` + `isValidProviderId` (base ids + `codex:<slug>`)
2. Storage: `codex_instances` table + CRUD
3. Registry: `getProviders({ codexInstances })`
4. Server: mutable provider bag + `/api/codex/instances*` + detect
5. Web: Settings panel, labels, Providers page instance cards
6. Docs + regression tests
