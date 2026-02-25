# Garmin Report Automation

Garminのランニングアクティビティを自動で取得し、Gemini APIを利用してデータを分析。次週のトレーニングプラン（筋力トレーニング含む）を作成してMarkdownレポートに出力し、GitHub Issueとして起票します。さらに、作成されたスケジュールをGoogle Calendarに自動で同期するシステムです。

GitHub Actionsを利用して、毎週月曜日に完全自動で定期実行されることを前提として設計されています。

## 主な機能

- **Garmin Connect 連携:** 過去7日間の `running` および `trail_running` アクティビティデータを取得し、ローカルにJSONとして保存。
- **Gemini AI 分析:** Gemini 2.5 Pro モデルと Structured Outputs を活用し、有酸素性作業閾値 (AeT: 149 bpm) と乳酸閾値 (LT: 161 bpm) のデータ分析を実施。「The Antifragile Engine」（耐久性とタフネスの追求）、「Earth Explorer」のコンセプトを取り入れた次週のトレーニング計画を立案。
- **(保留中) Google Calendar 同期:** Google Cloudのサービスアカウントを利用し、通知や自動割り当てでAIが作成したスケジュールを対象のGoogleカレンダーに終日予定として登録。（将来の拡張用としてコード内にコメントアウト状態で予約されています）
- **GitHub Actions 自動化:** 生データ (`data/raw/`) の自動コミット・プッシュ、および出力されたMarkdownレポート (`report_output.md`) の内容を本文としたGitHub Issueの自動起票。

## ローカル環境構築とテスト

手動でレポートを生成したい場合やローカルでテストする場合は以下の手順に従ってください。

1. **リポジトリのクローンと移動**
   ```bash
   git clone <your-repository-url>
   cd garmin_report_automation
   ```

2. **仮想環境の作成と有効化（推奨）**
   ```bash
   # Windows (PowerShell) の場合
   python -m venv venv
   .\venv\Scripts\Activate.ps1

   # macOS / Linux の場合
   python3 -m venv venv
   source venv/bin/activate
   ```

3. **依存パッケージのインストール**
   ```bash
   pip install -r requirements.txt
   ```

4. **環境変数の設定**
   プロジェクトのルートディレクトリに `.env` ファイルを作成し、以下の認証情報を設定してください。（このファイルは `.gitignore` に含まれており、GitHubにはプッシュされません）
   ```ini
   # Garmin アカウント情報
   GARMIN_EMAIL=your_garmin_email@example.com
   GARMIN_PASSWORD=your_garmin_password

   # Gemini API キー (Google AI Studio または Google Cloud から取得)
   GEMINI_API_KEY=your_gemini_api_key

   # Google Calendar API (将来の拡張用 / 現在は不要です)
   # GCP_SA_KEY={"type": "service_account", "project_id": "...", ...}
   # CALENDAR_ID=your_calendar_id@group.calendar.google.com
   ```

5. **スクリプトの実行**
   ```bash
   python main.py
   ```
   実行が成功すると、ルートディレクトリに `report_output.md` が生成されます。また `data/raw/all_activities.csv` にGarminのデータが保存されます。

## GitHub Actions での運用設定

ローカルでのテストが正常に完了したら、コードをGitHubリポジトリにプッシュして、GitHub Actionsで毎週自動実行させます。

1. **リポジトリの Secrets 登録**
   GitHubリポジトリの **Settings** > **Secrets and variables** > **Actions** にて、**New repository secret** をクリックし、`.env` ファイルに設定した以下の変数をそのまま登録してください。
   - `GARMIN_EMAIL`
   - `GARMIN_PASSWORD`
   - `GEMINI_API_KEY`
   （`GCP_SA_KEY` および `CALENDAR_ID` は現在機能保留中のため登録不要です）

2. **Workflow の権限確認**
   リポジトリの設定（または組織設定）で、GitHub Actions がリポジトリのコンテンツの読み書き (`contents: write`) と Issueの作成 (`issues: write`) を行える権限があるか確認してください。

3. **自動実行トリガー**
   ワークフローは毎週月曜日の **00:00 UTC (日本時間 09:00)** に自動実行されます。
   また、GitHubの **Actions** タブ > **Weekly Garmin Report** > **Run workflow** から手動で即時実行することも可能です。
