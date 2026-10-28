# Hiro Knowledge Implementation Plan

> Agent execution: execute in this session with independent API/UI implementation and one final fresh review. The user explicitly requested autonomous execution without design approval waits.

**Goal:** 個人専用の知識登録と復習を保存・復元まで実際に使える状態にする。
**Architecture:** same-origin static UI and Worker API, normalized D1, Access JWT defense in depth.
**Tech Stack:** JavaScript ESM, Cloudflare Workers/D1/Access, jose, Wrangler, Node tests, Playwright.
**Spec:** `docs/design.md` (authoritative DTO/routes and constraints).

## Global constraints

Free only. No paid AI. No Supabase changes. No existing data deletion. Public endpoints fail closed. No secrets or owner email in Git. No deploy until dedicated resource and Access protection can be verified.

## Review focus

Duplicate and racing review requests; partial/hostile backups; false Access headers and CSRF; stale quiz/history after editing; unmeasured statistics represented as null.

## Tasks

- [x] 1. Establish isolated branch, pin dependencies, record existing empty repo and contracts. Verify baseline and environment authentication without exposing secrets.
- [x] 2. API/data: write failing D1-backed acceptance checks; migrate schema; implement CRUD/archive/search, editable quizzes, append-only history, statistics, atomic additive backups and CSV. Test real local D1.
- [x] 3. Scheduler/auth: write failing unit/security tests; implement isolated adaptive scheduler, JWT verification, loopback-only local access, same-origin mutations, security headers and fail-closed entry point. Run all tests.
- [x] 4. UI: implement Japanese responsive four-screen UI against documented DTOs. All controls functional, recall-first review, masked answers, metrics distinguish objective/self-rated, backup preview/import and theme.
- [x] 5. Verify: real Worker + D1 E2E on desktop/mobile, persistence, restore to isolated DB, authentication negatives, deployment build. Fix demonstrated failures.
- [ ] 6. Cloud: check existing free account/identity permissions; create dedicated D1 only when feasible; Access before user data. Deploy only with protection configured; verify actual runtime separately. If auth blocked, finish all local work.
- [ ] 7. Review/docs/delivery: fresh security/data review, fix material findings, README with free limits/Time Travel/restore and authentication steps, save verified branch to GitHub, final report with evidence and limits.

Task6 cloud stage is paused at missing D1/Access privileges (actual API10000 / Dashboard login), not a code failure. Task7 review/docs are verified; delivery commit and remote save are reported in the final response.
