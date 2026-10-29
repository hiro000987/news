# AI Auto-save and Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** 最大10枚を選択レベルで生成し、自由回答と3択を含め自動保存する。

**Architecture:** 既存WorkerのAI生成後に既存カード保存処理を使用する。レベルは生成指示と検証済みメタデータに反映し、ブラウザーは保存結果を表示する。

**Tech Stack:** Vanilla JS ESM, Cloudflare Worker/D1/Workers AI, Playwright, Node test runner.

**Spec:** docs/superpowers/specs/2026-10-29-ai-autosave-levels-design.md

## Global Constraints
無料プラン・既存モデル・本人認証を維持。自動再試行なし。DB移行・依存追加なし。既存データは上書きしない。公開先とGitHubブランチは既存を使用。

## Review Focus
- 不正レベルは推論前に拒否し、不正な選択肢を含む出力は保存前に拒否する。
- 10枚と2問ずつの出力を切り捨てず検証する。
- 重複・一部失敗・通信中断を保存完了と混同しない。
- 閉じた後や別セッションに秘密の生成結果を表示しない。
- 文章モードの難問でも原文以外の正解を作らない。

## Task 1: Backend
Files: src/ai.js, src/api.js, tests/ai.test.js, focused API tests.
- [x] Test 10枚/1回・4レベル・3択・全検証後保存・重複と失敗を追加し、失敗を確認。
- [x] 生成上限、JSON schema、来歴、レベル指示、保存結果契約を実装。
- [x] Node全体を通す。実AIで出力上限と原文対応を確認。

## Task 2: UI
Files: public/app.js, tests/ai-ui.mjs.
- [x] 10件既定と4レベル、自動保存、部分失敗、遅延応答のテストを先に追加。
- [x] 選択フォームと保存結果を実装。生成中の保存継続・通信失敗を明示。
- [x] AI画面・認証画面・390px幅を確認。

## Task 3: Integration and Delivery
Files: tests/e2e.mjs, docs/ai-cards.md, README.md if current wording differs.
- [x] 実Worker/D1で自動保存・読み戻し・復習選択を検証。
- [x] 独立レビューを実施して必要な修正を検証。
- [x] 無料プランの証拠とバックアップを確認して公開、本人UIとD1読み戻しを確認。
- [x] 説明文と検証記録を更新し、既存GitHubブランチへ保存。
