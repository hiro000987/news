# Cloudflare AI cards

User approved replacing ChatGPT with a Cloudflare-hosted model on 2026-10-29 after choosing smartphone-only website operation without a running PC. Existing authorization covers implementation, free deployment and GitHub delivery; no paid plan, purchased credits or new billing consent.

## Approach

Use the existing Worker AI binding with the free-compatible `@cf/qwen/qwen3-30b-a3b-fp8` model. No external SDK or browser credential. Alternatives considered: PC/Codex requires a running PC and was rejected; Gemini adds account/key setup and different free data-use terms; ChatGPT hosted plan access remains unconfirmed.

## Behavior and contract

- Authenticated, same-origin `GET /api/ai/status` returns `{available,model,dailyLimit,remainingCalls}`. No model call.
- `POST /api/ai/generate` accepts `{mode:'topic'|'source',topic,sourceText,sourceUrl,count}`. Topic required for topic mode (max 200 chars); pasted source required for source mode (max 8000 chars); optional source URL is metadata only and never fetched; count 1–3.
- Response `{candidates,model,mode,generatedAt,remainingCalls}`. Candidates are valid existing Knowledge input DTOs, containing exactly one recall quiz. No automatic knowledge save.
- Candidate sourceUrl is empty. A caller-provided source URL is kept in notes as a reference, preserving the existing unique sources.url contract when multiple cards share one passage. Model-invented links are discarded.
- Mark AI provenance and unverified content in notes. Source mode says supplied text, not independently verified; topic mode says general draft, source not verified. Do not suggest live news/price/legal/medical verification occurred.
- Live quality correction: source content and recall answers select verbatim source excerpts through bounded schema enums; server rejects noncontiguous or invented passages and forces source explanation empty. Generated titles/questions still need human review. Topic drafts remain generative.
- UI opens a generator dialog from the knowledge/home page, supports topic/pasted-source input, renders up to three drafts safely, and opens the existing editor for one selected draft so the user can edit and explicitly save. Closing/logout/account switch removes drafts and cancels outstanding work.
- Request/result length limits, 60s timeout, no automatic retries. Persistent atomic daily call cap 20 per UTC day in an additive operational D1 table. Failed provider calls count because they may have consumed resources. Existing learning backup format excludes operational usage metadata.
- Model is fixed to the reviewed free-compatible model; no paid fallback, AI Gateway, purchase or plan upgrade. Provider daily quota exhaustion returns a clear temporary limit error. Existing notes/review/export remain usable.

## Verification

Test input/output validation, forged URLs/prototype payloads, provider failure/timeout/quota, concurrent daily limits, auth/origin guards, no auto-save, session cleanup, desktop/mobile draft-edit-save and existing backup roundtrip. Test a small synthetic Japanese sample live before enabling, then real owner browser generation/edit/save on production. Real phone hardware remains separate from mobile viewport.
