# AI Draft Review Implementation Plan

> Use superpowers:subagent-driven-development with an independent final review.

**Goal:** Review and save several candidates without another AI request, while preserving owner privacy and accurate usage display.

**Architecture:** Reuse the existing generator dialog and editor. Keep a session-bound ephemeral batch, and reuse unchanged Knowledge and AI APIs.

**Spec:** `docs/superpowers/specs/2026-10-29-ai-draft-review-design.md`

## Constraints and review focus

- No new billing, model, SDK, API, migration or persisted draft storage.
- Every record is saved by explicit existing editor action.
- Late save/status responses must not revive a discarded batch or another owner's content.
- Closing a saved batch refreshes the underlying list/count without reopening it.
- Failed generation consumes usage; refresh status without automatic inference retry.

## Steps

- [x] Write failing UI regressions for multiple candidates, return, saved markers and quota errors.
- [x] Implement batch lifecycle and editor callbacks with focused changes.
- [x] Run AI/auth UI and real Worker/D1 E2E; independent review.
- [x] Build/check and deploy; verify production no-extra-generation/save/reload and privacy.
- Source delivery uses the existing branch; commit and clean remote-state verification are recorded in the final chat.
