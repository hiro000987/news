# Google本人ログインでの公開 — 2026-10-29

## 採用した構成

公開先: https://hiro-knowledge.aprintingmachinehiro.workers.dev/

Web/APIと知識・回答履歴はCloudflare Workers/D1、本人認証はFirebase AuthenticationのGoogleログイン。ユーザーは2026-10-29に認証方式の変更と、既存Sparkプロジェクトへのこのホスト1件の追加を明示的に承認した。

既存Firebase「Hiro Tasks」はコンソール上でSpark・月額0ドル、Googleプロバイダー有効を確認。追加したのは今回のホストの認証許可だけ。既存ドメイン、Firestore、既存アプリのデータ・ルールは変更していない。Firebaseへ知識本文を保存しない。サービスアカウント、電話SMS、Identity Platformへのアップグレードは使用しない。

Cloudflare AccessはZero Trust Freeの申込画面で支払い情報と超過時の自動課金同意が必要だったため、申込を完了しなかった。課金情報の入力・同意・プラン変更は行っていない。

## 保護するもの

HTML/JS/CSSのログイン画面とFirebaseのWeb設定4項目は公開。知識・復習・分析・バックアップのAPIはBearer認証必須。FirebaseのWeb API keyはブラウザー用の公開識別子で、本人認証やDB権限の代わりにはならない。本人メールとサーバーの認証情報は公開設定へ返さない。

Workerは固定のGoogle JWKSでRS256署名を検証し、次を照合する。

- `iss` は対象プロジェクトのsecuretoken、`aud` は同じプロジェクトID。
- `exp`、`iat`、`auth_time`、`sub` の形式・時刻・必須条件。
- Googleプロバイダー、確認済みメール、`OWNER_EMAIL` secretとの完全一致。

未認証・偽装・別対象・別ユーザーは拒否する。別ユーザー拒否は署名付きトークンの自動テストで確認し、実在する別Googleアカウントを使った試験は行っていない。

ログアウトとUID変更で画面・ダイアログ・処理中のリクエストを破棄する。IDトークンを検証する方式で、サービスアカウントによる失効照会は行わない。取得済みトークンの期限までの有効性はFirebaseの通常のIDトークン方式に従う。

## 環境設定

Git管理外の `wrangler.production.json` には、`AUTH_PROVIDER: firebase`、Firebaseコンソールで確認した `FIREBASE_PROJECT_ID`、`FIREBASE_API_KEY`、`FIREBASE_AUTH_DOMAIN`、`FIREBASE_APP_ID` を設定する。実値をGitへ保存しない。`OWNER_EMAIL` はWorker secretへ登録する。

`workers_dev:true`、`preview_urls:false`、`routes:[]`。`LOCAL_DEV`と名前付き環境は本番に使わない。公開前検査はSpark、Googleプロバイダー、許可ドメイン、本人secretと実設定の一致を要求するが、記録だけで実環境確認を代用しない。

Firebase SDKは `client/auth-client.js` からesbuildで生成し、外部CDNのアプリコードを読み込まない。Google認証に必要な通信先・フレームのみCSPで許可する。生成物とSDKライセンスは `pnpm build` で `public/` に配置する。生成物はGit管理外で、依存と元コードを固定して再生成する。

## 実確認

本番URLでGoogle本人ログイン、登録、リロード保持、自由回答、履歴・次回日付、本番D1読戻し、JSON出力、同一JSON再取込（追加0・スキップ9）、アーカイブ、ログアウト時のDOM消去、再ログインを確認した。

未ログインの知識/分析/バックアップAPIと偽装認証は本番で401。プレビュー無効、D1 bindingと認証プロバイダー、OWNER_EMAIL secretの存在も管理APIで読み戻した。

PC幅1280とスマホ幅390で画面を確認。390幅でdocumentWidthも390。実際のAndroid/iPhone端末は未確認。画面検証用のノート1件はアーカイブ済みで、分析・履歴には動作確認の復習1回が含まれる。

専用D1のスキーマ初期バックアップと本番JSONはGit管理外 `.wrangler/backups/` に保管。Time Travelの現在bookmark取得にも成功した。破壊的なTime Travel復元は行っていない。

## 使う場所

デスクトップの「Hiro Knowledge」はクラウド版を開く。「Hiro Knowledge（ローカル）」と `Start-App.cmd` はPC内の別DBを使う。ローカルデータを自動移動・削除していない。必要な移行はJSON出力と競合確認から行う。

## 公式資料

- [Firebase Spark: 支払い情報不要、無償のAuthentication](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Googleログイン](https://firebase.google.com/docs/auth/web/google-signin)
- [IDトークンの検証条件](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firebase Web設定のAPI keyの扱い](https://firebase.google.com/docs/projects/api-keys)
