# 標準URLでの安全な公開 — 2026-10-29

## 現在の実測状態

- Wranglerの再ログインを本人が完了し、D1一覧取得が成功した。
- 既存D1が1つあることを確認したが、今回は変更していない。Hiro Knowledge専用の本番D1は未作成。
- Workerアカウントの標準サブドメインは取得できた。値は公開Gitへ保存しない。
- 現在のOAuthはAccess組織/アプリと契約情報の読取を許可せず、APIは403となる。Workersのusage modelがstandardであることだけではFreeプランの証明にならない。
- Windowsブラウザーの現在URLを安全に確認できず、画面操作ツールがこのターンの操作を停止した。別のUI操作方法へ迂回しない。
- 料金プラン・Accessを確認できていないため、リモートDB作成と本番公開はまだ実行していない。

## 公開手順

独自ドメインの購入は不要。CloudflareのWorker単位のAccess保護を先に設定してから、標準のworkers.dev URLを有効にする。

1. DashboardでWorkers FreeとZero Trustの利用状態を確認する。Zero Trustの初期設定で支払い情報や契約同意を求められた場合は、本人の操作が必要。新規課金・カード登録は本依頼で許可されていない。
2. 専用D1を1つだけ作成し、返された実際のUUIDをGit管理外の `wrangler.production.json` へ保存する。既存DBへ適用しない。
3. `workers_dev:false`、`preview_urls:false`、`routes:[]`、単数の`route`なし、`LOCAL_DEV`なしの設定で準備する。OWNER_EMAILは公開設定へ含めない。
4. 無料プランの実確認を記録して、bootstrapモードの公開前検査を通す。その後、URLが無効のWorkerだけをデプロイする。
5. Dashboardの対象WorkerのAccessタブで、対象を**All traffic**にし、本人メール完全一致だけのAllowポリシーを設定する。`Previews only`やアカウント全Workers対象は選ばない。
6. AccessアプリのAUD、team domain、実際のWorker ID、アプリID、保護対象、本人のみのAllowを読み戻す。OWNER_EMAILをWorker secretとして設定する。
7. 本番モードの確認記録を作り、公開先が実際の `<worker名>.<アカウントサブドメイン>.workers.dev` であることを検査する。
8. この段階でのみ `workers_dev:true` として公開する。プレビューは無効のまま。未ログイン拒否・本人ログイン・API保存/復習/再読込・実端末での同一データ確認を実施する。

API側でもJWT署名/issuer/AUD/本人メールを検証する。Accessの設定が未確認であることを、設定ファイルや自己申告の確認記録で置き換えない。

## 検査の呼出し

本番設定と `.wrangler/deployment-verification.json` はGit管理外。準備段階だけを検査する場合:

```powershell
$env:HIRO_DEPLOY_MODE='bootstrap'
pnpm deploy:check
Remove-Item Env:HIRO_DEPLOY_MODE
```

bootstrapの必要記録: `workerName`、`freePlan:true`、`checkedAt`。本番設定も非公開条件を満たす必要がある。

本番用記録は、さらに以下を**実際に確認して**記入する。例の文字列を実設定として使用しない。

```json
{
  "workerName": "hiro-knowledge",
  "freePlan": true,
  "checkedAt": "実確認時点のISO日時",
  "productionHost": "実際の公開先ホスト名",
  "workerSubdomain": "実際のアカウントサブドメイン",
  "workerId": "APIから取得したWorker ID",
  "accessDestinationType": "worker",
  "accessDestinationWorkerId": "同じWorker ID",
  "accessAppVerified": true,
  "ownerOnlyPolicy": true,
  "authSecretsVerified": true,
  "accessAppId": "実際のAccessアプリID",
  "accessAudience": "設定と一致するAUD",
  "teamDomain": "設定と一致するteam domain"
}
```

通常の `pnpm deploy:check` はproductionモード。確認記録は24時間以内、未来5分超は拒否する。追加ルート、単数`route`、プレビュー有効、別Workerの保護、別ホスト、公開設定内の本人メール、開発用の認証迂回設定も拒否する。

`pnpm deploy` は検査と実行の両方で `wrangler.production.json` を明示する。`HIRO_DEPLOY_CONFIG` は単独の検査時の指定にだけ使用でき、本番コマンドの検査対象を差し替えない。設定内の `env` と環境変数 `CLOUDFLARE_ENV` は拒否し、検査後に別の環境へ切り替わる経路を防ぐ。

従来の単一カスタムホスト設定も検査できるが、このアプリの推奨経路はドメイン購入不要のWorker単位Access + workers.dev。

## 公式根拠

- [Worker単位のAccess: productionとpreviewの保護、Dashboard手順](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [workers.devの有効化と無効化](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Version/Preview URLの扱い](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/)
- [Zero Trustの初期設定](https://developers.cloudflare.com/cloudflare-one/setup/)
- [D1の無料枠](https://developers.cloudflare.com/d1/platform/pricing/)
