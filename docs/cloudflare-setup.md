# Cloudflare の無料セットアップと公開前確認

**2026-10-29更新:** D1権限の再認証は完了。標準workers.dev URLをWorker単位Accessで保護する最新の公開手順は [標準URLでの安全な公開](cloud-deployment.md) を使用する。以下の当初の状態・カスタムホスト手順は2026-10-28時点の記録。

2026-10-28時点の公式資料と、このリポジトリの実設定に基づく手順。料金プランの変更、カード登録、課金機能の有効化は行わない。設定値は実際のCloudflareアカウントとドメインから取得し、推測で補わない。

## 現在の状態

- ローカル実装と `wrangler.jsonc` はある。開発時は `.dev.vars` とローカルD1を使う。
- Wrangler OAuth自体は有効だが、現在の権限は `user:read`、`account:read`、`workers_scripts:write`、`workers_tail:read`、`offline_access` のみ。`pnpm exec wrangler d1 list` は認証エラー 10000 で失敗した。
- Cloudflareダッシュボードはログイン画面までで、Accessアプリ・ポリシーの設定を確認できていない。
- リモートD1はまだ作成していない。本番デプロイもAccess保護確認も未実施。
- アカウント所有者のメールは `wrangler whoami` で確認済み。メールアドレスとAccount IDはこのGit管理文書へ記録しない。

そのため、現在はローカル利用まで。公開済みとは扱わない。

## 無料枠と運用上限

Workers Free は 100,000 Worker requests/日、CPU 10 ms/呼び出し、メモリ128 MB、subrequests 50/request。日次枠を超えるとWorker呼び出しが制限される。静的ファイルをAssetsから直接返すリクエストは無制限で追加料金なし。ただし、このアプリは `assets.run_worker_first: true` のため、静的ファイルを含む全リクエストでWorker認証処理が走り、Worker request枠を消費する。WorkerごとのAssets上限は20,000ファイル、1ファイル25 MiB。

D1 Freeはアカウント合計5 GB、最大10データベース、1 DBあたり最大500 MB、5,000,000 rows read/日、100,000 rows written/日。日次read/write枠を超えると翌日UTC 00:00までD1クエリがエラーになる。保存枠を使い切ると新規書込やスキーマ変更もできない。無料枠はアカウント単位なので、他のCloudflareプロジェクトの利用分も合算される。

D1 Time Travelは自動・常時有効で、追加料金なし。Freeは過去7日間、Paidは30日間の任意時点に戻せる。Time Travel対象は新しい本番ストレージ方式のDB。`wrangler d1 info hiro-knowledge` の `version` が `production` であることを確認する。復元はDB全体をその場で上書きする破壊的操作で、実行中クエリもキャンセルされる。復元前にSQLエクスポートを別のローカル保管場所へ保存し、戻す時刻とbookmarkを確認する。

Cloudflare Zero Trust Freeは最大50 users。本人専用であればAllowポリシーのIncludeに、現在の `wrangler whoami` で確認した本人メールの完全一致だけを登録する。メールドメイン全体やEveryoneは使わない。メールOTPを使う場合はCloudflare AccessのOne-time PIN認証を設定し、許可メール以外にPINが送られずログインできないことを確認する。

公式資料:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 Free枠の超過時動作](https://developers.cloudflare.com/d1/reference/faq/)
- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/)
- [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Workers.devとURL保護](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [WorkersでCloudflare Accessを使う](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

## まずローカルで使う

既存の `.dev.vars` に `LOCAL_DEV=true` を設定し、次を実行する。ローカルDBは `.wrangler/state` に保持される。

```powershell
pnpm db:local
pnpm dev
```

`wrangler dev` の通常動作と `--local` のマイグレーションはローカルDBを使う。`--remote` を付けるコマンドはCloudflare上のデータを操作する。開発作業中に不用意に切り替えない。

## Wrangler認証の不足を直す

必要なOAuth権限だけを追加してCloudflareにログインする。現在インストールされている Wrangler 4.153.0 の `wrangler login --help` で `--scopes` が配列指定であること、`--scopes-list` で次のscope名が存在することを確認済み。

```powershell
pnpm exec wrangler login --scopes user:read --scopes account:read --scopes workers_scripts:write --scopes workers_routes:write --scopes d1:write
```

ブラウザーに出るCloudflare OAuth画面で、本人が許可内容を確認して認証を完了する。アカウント画面のログインも本人が行う。この作業はプラン変更や支払い情報の登録を要求しない。完了後、`pnpm exec wrangler whoami` と `pnpm exec wrangler d1 list` を再実行する。D1一覧が読めない場合は先へ進めず、エラーを記録する。

## 本番設定とD1を用意する

本番専用設定 `wrangler.production.json` は `.gitignore` 対象。`wrangler.jsonc` を土台に、Cloudflareが返したD1 ID、実際に所有・管理できる本番ホスト、Access設定値を反映する。Workers URLやDNS名は推測しない。`workers_dev: false` と `preview_urls: false` は維持する。`assets.run_worker_first: true` と単一の `DB` binding / `hiro-knowledge` DB名 / `migrations` ディレクトリも維持する。

CloudflareのDashboardでプランがWorkers FreeかつZero Trust Freeであることを確認してから、専用D1を一度だけ作る。

```powershell
pnpm exec wrangler d1 create hiro-knowledge
```

出力されたD1 UUIDだけをローカルの無視対象 `wrangler.production.json` に記入する。IDをGitへ保存しない。Free planと500 MBのper-DB上限を確認し、作成されたDBが一つだけであることを `pnpm exec wrangler d1 list` と `pnpm exec wrangler d1 info hiro-knowledge` で読む。

AccessアプリはCloudflare Dashboardの **Zero Trust → Access controls → Applications** で作る。対象は設定ファイルに実在する `routes[0].pattern` のproduction hostと完全一致させ、本人メール完全一致のAllowポリシーを付ける。別の `workers.dev` やPreview URLを公開経路にしない。設定ファイルでは既に `workers_dev` と `preview_urls` を `false` にしているが、Dashboard上でもWorker URL/Previewの状態を確認する。アプリ保護が実際に効くまでは個人データをデプロイしない。

## AccessのJWT設定

本番WorkerはAccess経由のアクセスだけを信頼する。`Cf-Access-Jwt-Assertion` の署名を `https://<実際のteam名>.cloudflareaccess.com/cdn-cgi/access/certs` のJWKSで検証し、issuerとこのAccessアプリ固有のAUDを検査する。メールclaimだけ、Cookieだけ、ヘッダーの存在だけでは認証成功にしない。署名鍵は定期的にローテーションされるため固定公開鍵を埋め込まない。

実際の値をDashboardから取得して `wrangler.production.json` の `vars.ACCESS_TEAM_DOMAIN` と `vars.ACCESS_AUD` に設定する。本人のメールは `pnpm exec wrangler secret put OWNER_EMAIL --config wrangler.production.json` でCloudflare Secretとして登録し、Git管理ファイルやコマンド引数・ログへ値を書かない。開発時の `.dev.vars` はローカル専用とする。

## マイグレーションとデプロイ

初回・変更時とも、適用対象を確認してから本番migrationを実行する。

```powershell
pnpm exec wrangler d1 migrations list hiro-knowledge --remote --config wrangler.production.json
pnpm exec wrangler d1 migrations apply hiro-knowledge --remote --config wrangler.production.json
```

既存DBへmigrationを適用する前は、別エクスポートを確保する。初回の空DBでは既存学習データはない。

```powershell
pnpm exec wrangler d1 export hiro-knowledge --remote --output=<Git管理外の安全な保存先> --config wrangler.production.json
pnpm deploy:check
pnpm deploy
```

ただし、`pnpm deploy` はデプロイ前チェックを通った後にだけWorkerを公開する。チェック用 `.wrangler/deployment-verification.json` はGit管理外に置き、次の項目を設定する。

```json
{
  "freePlan": true,
  "accessAppVerified": true,
  "ownerOnlyPolicy": true,
  "authSecretsVerified": true,
  "checkedAt": "確認時点のISO 8601時刻",
  "productionHost": "wrangler.production.jsonのroutes[0].patternと完全一致する値"
}
```

これは確認済みという記録であり、Access設定の代用ではない。`checkedAt` は公開前24時間以内である必要がある。D1のID・メール・AUD・認証secretをこのJSONやGitへ記録しない。

## 本番公開前の確認

デプロイ後も公開完了とは扱わず、実URLで次を確認する。

1. 無ログイン状態で本番ホストを開くとAccessが遮断し、アプリAPIもHTML/JS/CSSも読めない。
2. `workers.dev` とPreview URLが無効である。Cloudflare AccessのWorkers保護設定でも対象URLを確認する。
3. Accessへ本人メールでログインすると利用でき、別メールでは利用できない。
4. Worker側JWT検証で無効署名、期限切れ、別issuer、別AUD、別メールが拒否される。
5. 本人の通常操作が本番D1へ保存され、再読込後も残る。DashboardでFree usageを確認する。

一つでも未確認なら公開済み・本人専用と報告しない。Free枠超過時は利用再開まで待つか、クエリを減らす。Paidへアップグレードしない。

## D1 Time Travelの調査と復元

Time Travel履歴はFreeで7日間だけ使える。異常発生時は、まず現状bookmarkを読み、直近の全DB SQLエクスポートをGit管理外へ退避する。

```powershell
pnpm exec wrangler d1 time-travel info hiro-knowledge --config wrangler.production.json
pnpm exec wrangler d1 export hiro-knowledge --remote --output="実際のGit管理外のバックアップ.sqlへのパス" --config wrangler.production.json
```

`--output` の説明文字列は、そのまま実行せず、安全な実在パスへ置き換える。

復元は既存DB全体を書き換えるため、対象時刻と影響を確認できた場合だけ本人判断で実行する。自動化・通常デプロイへ組み込まない。

```powershell
pnpm exec wrangler d1 time-travel restore hiro-knowledge --timestamp="確認したRFC3339形式のUTC時刻" --config wrangler.production.json
```

復元コマンドの時刻説明文字列も、対象として確認した時刻へ置き換えてから実行する。

コマンドが返す `previous_bookmark` を安全な記録へ控える。復元後は別ファイル名へ再度全DBをエクスポートし、復元結果を確認する。誤復元を戻す必要があれば、控えた `previous_bookmark` を指定して再復元する。

## 参考コマンドと資料

- 現在のWrangler OAuth scope一覧: `pnpm exec wrangler login --scopes-list`
- [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [D1 export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Workers deployment command](https://developers.cloudflare.com/workers/wrangler/commands/workers/)
