# AIエージェント向けシステムプロンプト (System Instructions for AI Agents)

このドキュメントは、本プロジェクト（Garmin Report Automation & Dashboard）の開発をサポートするAIエージェント（Antigravity、GitHub Copilotなど）向けの共通の前提知識・指示書（システムプロンプト）です。
AIエージェントがコードを修正・追加する際は、本ドキュメントのルールとコンテキストを最優先で考慮してください。

---

## 1. プロジェクトの目的と概要
本プロジェクトは、ランナー（ユーザー）のGarminおよびStravaのアクティビティデータを自動取得し、Gemini APIを利用して高度なデータ分析（ペース、フォーム、トレーニング効果など）を行うシステムです。
分析結果に基づく次週のトレーニングプランを生成し、GitHub Issueとして起票するとともに、専用のWebダッシュボードで自己ベストや長期的なトレンドを可視化します。

## 2. アーキテクチャと技術スタック
- **バックエンド**: Python (3.x), FastAPI
- **フロントエンド**: HTML/JS/CSS (Vanilla UIベース) または React (Next.js系) 
- **データベース**: Supabase (PostgreSQL)
- **インフラ**: Google Cloud Run (コンテナ稼働)
- **自動化**: GitHub Actions (週次ジョブ、Issue連携)
- **AI/LLM**: Google Gemini 2.5 Pro API 
- **連携API**: Garmin Connect (セッショントークン認証), Strava API

## 3. 開発における基本ルール（コーディング規約）

### 3.1 共通ルール
1. **Free Tier（無料枠）の厳守**:
   - 個人開発プロジェクトのため、Google Cloud（Cloud Run）およびSupabaseの無料枠内で運用できる設計を最優先してください。
   - 大量のデータ（生GPXポイントなど）を保存・ポーリングする場合は、ダウンサンプリング（例：1/5の間引き処理）やキャッシュを積極的に活用してください。
2. **エラーハンドリングとログ**:
   - 外部API（Garmin, Strava, Gemini）との通信には必ず `try-except` ブロックを用い、適切なログ（`logging.info`, `logging.error`）を残してください。
3. **日本語でのドキュメンテーション**:
   - `docs/` ディレクトリ配下のドキュメント（Markdown）、コメント、およびコミットメッセージは基本的に日本語で記述してください。

### 3.2 パイソン・バックエンド処理 (`/src/`, `main.py`, `/dashboard/app.py`)
- Pythonコードは可読性を重視し、複雑なロジックは小さな関数に分割してください。
- データの型ヒント（Type Hinting）を積極的に活用し、Pydantic (`BaseModel`) でデータバリデーションを行ってください。
- DBアクセスには `supabase-py` クライアントを利用し、不必要な全件取得（`select("*")` のみ）は避け、必要なカラムを明示してクエリを最適化してください。

### 3.3 フロントエンド処理 (`/dashboard/static/`)
- モダンでレスポンシブなUIを心がけてください。
- チャート描画などのライブラリ（Chart.js等）を利用する際は、モバイル端末での表示崩れがないかレイアウト（CSS）に注意してください。

## 4. プログラム・ディレクトリ構造の前提
エージェントは以下のディレクトリ構成を前提にタスクを実行してください。
- `docs/`: 仕様書やデプロイガイドなど（`specification.md`, `deployment.md`）
- `src/`: コアロジック (`garmin.py`, `strava.py`, `gemini.py`)
- `dashboard/`: APIサーバー実装 (`app.py`) とフロントエンド静的ファイル群 (`/static/`)
- `.github/workflows/`: 自動化スクリプト
- `prompts/`: Gemini APIなどのAIに渡すプロンプトテキスト

## 5. 現在の課題と改修時の注意点
- **セッショントークンの取り扱い**: Garminの認証はパスワードからIPブロック対策のセッショントークンへ移行済みです。トークン更新を破壊するような認証フローの変更は避けてください。
- **データ重複排除 (Deduplication)**: StravaとGarminの両方から同じアクティビティが取得される可能性があるため、常に「開始時間（`startTimeLocal`）」などを用いた重複チェックを意識した実装を行ってください。
- **MCP連携**: `/.antigravity/mcp_config.json` によりGitHubと連携しています。Issueの読み取りや自律的なタスク管理機能を拡充する際は、この構成を考慮してください。

---
*このプロンプトは、プロジェクトの成長に合わせて適宜アップデートしてください。*
