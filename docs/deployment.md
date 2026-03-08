# デプロイ・運用ガイド (Deployment & Operations Guide)

本ドキュメントでは、Garmin Report Automation & Dashboardシステムのデプロイ手順および定期実行の運用設定について解説します。

## 1. Google Cloud Run へのデプロイ (Webダッシュボード)

Webインターフェース（フロントエンドおよびAPI）は、Google Cloud Run (サービス) としてコンテナベースで稼働します。
`Dockerfile` を用いてビルド・デプロイを行います。

### 1.1 事前準備
1. **Google Cloud CLI (`gcloud`)** をインストールし、認証を済ませておきます。
   ```bash
   gcloud auth login
   gcloud config set project [YOUR_PROJECT_ID]
   ```
2. Cloud Run, Artifact Registry (または Container Registry), Cloud Build のAPIをGCPコンソール上で有効化します。

### 1.2 環境変数 (Secrets) の準備
ダッシュボードを正常に稼働させるため、GCPの **Secret Manager** に以下の秘匿情報を登録し、Cloud Runサービスに環境変数としてマウントするか、デプロイ時の引数で指定する必要があります。
- `SUPABASE_URL`: SupabaseプロジェクトのURL
- `SUPABASE_KEY`: SupabaseのAnonキー
- `SUPABASE_SERVICE_KEY`: (必要に応じて) SupabaseのService Roleキー
- `STRAVA_CLIENT_ID`: Strava API連携用クライアントID
- `STRAVA_CLIENT_SECRET`: Strava API連携用シークレット
- `STRAVA_REDIRECT_URI`: (デプロイ環境のURL)/api/strava/callback に設定

### 1.3 デプロイの実行
ソースコードディレクトリのルート（`Dockerfile`がある階層）で以下のコマンドを実行します。

```bash
gcloud run deploy garmin-dashboard \
    --source . \
    --platform managed \
    --region asia-northeast1 \ # 任意のリージョン
    --allow-unauthenticated \
    --set-env-vars="SUPABASE_URL=...,SUPABASE_KEY=...,STRAVA_CLIENT_ID=...,STRAVA_CLIENT_SECRET=...,STRAVA_REDIRECT_URI=..."
```
※ `--set-env-vars` の部分は、Secret Managerを利用して環境変数を参照する形が推奨されます。

デプロイが成功すると、Cloud Runの公開URL (`https://garmin-dashboard-*.a.run.app` など) が生成されます。
このURLをStrava側の Callback URL にも忘れずに登録してください。

---

## 2. GitHub Actions による定期実行 (AI分析とIssue自動起票)

過去の成果物（`/main.py`のロジック）を用いた「トレーニングレポートの生成」および「Issue自動起票」は、GitHub Actions を介してスケジューリングされています。

### 2.1 ワークフロー定義
`.github/workflows/weekly_report.yml` により、**毎週の指定曜日（例：月曜日の朝など）** にシステムが自動起動します。

### 2.2 GitHub Repository Secrets の設定
GitHubリポジトリの `Settings > Secrets and variables > Actions` から、以下の変数を登録してください。
- `GARMIN_EMAIL`: GarminのログインID (手動フォールバックや初回用)
- `GARMIN_PASSWORD`: Garminのパスワード
- `GEMINI_API_KEY`: Google Gemini APIキー
- `SUPABASE_URL`: SupabaseのURL
- `SUPABASE_KEY` / `SUPABASE_SERVICE_KEY`: データベースへのアクセスキー

※ Garminのセッショントークンについては、`generate_garmin_tokens.py` を手元で実行し、Supabase（`user_profiles` テーブル）に格納する仕組み（IPブロック回避）となっているため、定期実行時はそれらが参照されます。

### 2.3 手動トリガー (Workflow Dispatch)
GitHub上で即時レポート作成を行いたい場合は、Actions タブから該当のワークフローを選択し、「**Run workflow**」ボタンから手動実行することが可能です。

---

## 3. その他の運用Tips

### 3.1 コールドスタートの緩和 (Cloud Run)
Cloud Run のコスト設定（Free Tier内）においては、アクセスが無いとインスタンスがゼロにスケールダウンします。これにより、次回のアクセス時に数十秒のコールドスタート時間が発生します。
- レスポンス速度を重視する場合は、Cloud Run設定で `Minimum instances` を `1` に設定可能です。（無料枠を少し超える可能性に注意）

### 3.2 データベースとストレージ容量制限
Supabaseの無料プランでは転送量とデータベースサイズに制限があります。
特に `gpx_points` はログの塊であるため、本システムでは `src/garmin.py` および `src/strava.py` 内で 1/5 程度のサンプリング（間引き）処理を施して肥大化を抑える工夫を実装しています。
定期的な不要データ整理も必要になれば検討してください。
