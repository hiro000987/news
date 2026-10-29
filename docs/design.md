# Hiro Knowledge design — 2026-10-28

2026-10-29 AI追加承認: 本人はPC常駐を避け、Cloudflare上の別モデルへの切り替えを承認した。新しいAI仕様は `docs/superpowers/specs/2026-10-29-ai-cards-design.md`、運用と実証は `docs/ai-cards.md`。以下の初期「新規AI APIなし」はAI追加前の境界として保持する。

2026-10-29変更承認: ZeroTrust Freeが支払い情報と超過課金同意を要求したため、ユーザーはFirebase SparkのGoogle本人ログインへの変更と、既存Sparkプロジェクトへの今回の認証ホスト1件追加を承認した。現在の公開構成は `docs/firebase-auth.md`。以下のAccess仕様は初期設計として保持し、実装も既定互換モードとして残す。

本人専用の知識登録・想起・復習を、月額0円の Workers + D1 + Access で提供する。
ユーザーは添付依頼で質問と設計承認待ちを明示的に省略し、合理的判断での実装、無料専用D1作成、安全なデプロイ、GitHub保存を承認している。

## Existing state / chosen approach

`hiro000987/news` の main は `b20fd7c`（初期空コミット）のみ。既存ファイル・フレームワーク・DB・ニュース既読状態は存在しない。2026-10-28 に確認。
統合先がないため、作業ブランチ `feature/hiro-knowledge` に独立した小さなアプリを実装する。
バニラ JavaScript ESM + CSS + Worker API + D1 を選ぶ。フレームワークによる余分なビルドを避け、同一オリジンで使う。
比較案: React SPA は既存資産がなく本MVPでは依存が増える。既存ニュースへの組込は対象実装がない。Supabase は変更しない。

## Boundaries / security

APIとHTML/JS/CSSの全ルートは Worker を先に通し、Access JWT署名・issuer・aud・本人メール完全一致を検証する。設定不足・認証失敗は拒否。
ローカルだけは `.dev.vars` の `LOCAL_DEV=true` かつ request URL の loopback hostname で使用可能。公開先でLOCAL_DEVを設定しても外部URLでは無効。
書込は同一Originのみ。入力サイズ・型・URL・選択肢を検証し、SQLはbind、画面はtextContentを使う。第三者記事を取得・複製しない。
workers.dev と preview は初期無効。Access保護・本人Allowポリシーを実設定で確認できるまで個人データを公開しない。
無料プラン以外へ変更しない。APIキーや利用者メールを公開Gitに保存しない。新規AI APIなし。

## Data and behavior

知識、カテゴリー、タグ、中間テーブル、情報源、クイズ、追記型回答履歴、復習状態、学習メモを分離。UUID、FK、検索・期限インデックス、マイグレーションを使う。
編集で回答履歴を失わない。アーカイブは可逆で、削除UIを設けない。重複は正規化したタイトルとURLで抑止し、既存項目への案内を返す。
復習アルゴリズムを `src/scheduler.js` へ分離。忘れた10分、曖昧1日、覚えたは過去の間隔/失敗/連続成功に応じ延長、上限180日。最適性を主張しない。
3択だけを客観正答率とする。自由回答は自己評価で、正答率に混ぜない。習得済みは自己評価の連続成功と間隔からの運用上の目安。
日付の集計は Asia/Tokyo。弱点は回答3件以上のカテゴリーでのみ表示し、未測定はnull。
JSONは version=1、全テーブルを含む。復元は事前全検証後、単一D1 batchで追記/同一ID同一内容をスキップ、競合は拒否。既存データの一括消去なし。

## API contract (camelCase DTO; DB internal snake_case)

全APIレスポンスはJSON、エラー `{error: string, code: string}`。競合409、検証400、認証401/503。
- GET `/api/knowledge?q=&category=&tag=&status=&offset=0&limit=40` → `{items, total}`。status new/due/mastered/archived。各itemにscheduleとquizzes。
- GET `/api/knowledge/:id` → `{item, history}`。
- POST `/api/knowledge` → `{item}` (201)。PUT `/api/knowledge/:id` bodyには直前GETの`expectedUpdatedAt`を含める → `{item}`。古い編集は409で全体を拒否。
- PATCH `/api/knowledge/:id/archive` body `{archived: boolean}` → `{item}`。
- GET `/api/meta` → `{categories: string[], tags: string[]}`。
- GET `/api/review/next` → `{item: Knowledge|null}`。期限到来/未学習の順。
- POST `/api/reviews` body `{knowledgeId,quizId,rating,response,selectedIndex,idempotencyKey}` → `{review,schedule}`。選択肢の不正解ではrememberedを拒否/forgot扱い。idempotencyKeyで二重登録防止。
- GET `/api/dashboard` → `{dueCount, learnedToday, addedToday, totalKnowledge, reviewsToday, reviewCount, recentAccuracy, objectiveAnswers, recallRememberedRate, streakDays, categories, recentDays}`。
- GET `/api/backup` → versioned backup; POST `/api/backup/validate` → `{counts, conflicts}`; POST `/api/backup/import` → `{imported, skipped}`。
- GET `/api/export.csv` → UTF-8 BOM CSV、Excel式の先頭文字を無害化。

Knowledge `{id,title,content,category,tags,sourceUrl,notes,understanding,createdAt,updatedAt,archivedAt,schedule,quizzes}`。
Schedule `{dueAt,intervalDays,streak,lapses,reviews,status}`。understanding は0〜3。
Quiz `{id,type,prompt,answer,explanation,options,correctIndex}`。type recall/choice、choice は文字列3件、correctIndex 0..2、recall は options=[]/correctIndex=null。
新規でクイズ未指定ならタイトルを問う自由回答を作る。編集時クイズIDを保持し、使わなくなった問題は無効化する。
Category stat `{category,total,correct,totalAnswers,accuracy,recallRemembered,recallAnswers}`。
recentDays `{date,reviews}`。recentAccuracy は直近30日/最大100回答の3択のみ、未測定null。
dashboardは`learnedTodayItems`（最大5件のKnowledge DTO）も返す。JSONは10MiB・全テーブル50,000行を上限とし、出力でも同じ上限を検査する。backup version1はscheduler v1の履歴遷移を検証する。

## UI

4画面: ホーム / 知識 / 復習 / 分析。PCサイドバー、モバイル下ナビ。ライト/ダーク/システム設定。
登録フォームはタイトル・内容を優先、URLからの `?url=&title=&summary=` 引継ぎ対応。勝手に保存しない。
自由想起を既定とし、回答を入力してから答えを開く。3択は任意切替。答えの確認後のみ自己評価。
JSON/CSV出力と復元は設定内。復元はファイル検査・件数/競合プレビュー・明示実行。偽統計や飾りリンクなし。
応用は知識メモへ「どこで使えそうか」を追記できる。デモは自動投入しない。

## Acceptance

実ローカルD1を使い登録/編集/検索/アーカイブ/クイズ/履歴/日付計算/リロード保持/JSON出力・別DB復元/不正バックアップの原子性を確認。
署名付きJWTの正常/期限切れ/issuer/aud/他人メール/偽装を検証。未設定時の未認証APIと静的画面拒否を確認。
PCとスマホ幅でE2E操作し、同じローカルサーバー上のデータを読めることを確認。実端末間クラウド同期は本番検証が必要。
本番に到達できなければ未検証と明記し、ローカル起動導線と最小限の認証手順を残す。
