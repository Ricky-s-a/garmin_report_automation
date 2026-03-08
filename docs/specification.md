# プログラム仕様書 (Garmin Report Automation & Dashboard)

## 1. システム概要
本システムは、Garmin ConnectおよびStravaからランニング・トレイルランニングのアクティビティデータを自動取得し、Gemini APIを利用して詳細な分析（フォーム、ペース、疲労度など）を行うシステムです。
分析結果から次週のトレーニングプラン（筋力トレーニング含む）を作成してMarkdown形式で出力し、GitHub Issueとして自動起票します。
さらに、取得・分析したデータを可視化するためのWebダッシュボード（Cloud Run上で稼働）を提供し、長期的なトレーニング傾向や自己ベストなどを管理します。

## 2. 主な機能

### 2.1 データ取得・同期機能
- **Garmin連携**: Garmin Connectからのアクティビティデータ（`running`, `trail_running`）、GPXデータ（1kmごとの区間データなど）、およびランニングダイナミクス（上下動、接地時間など）の取得。セッショントークン認証に移行済み。
- **Strava連携**: Strava APIを利用したデータ連携・同期。
- **データ保管**: Supabaseをデータベースとして活用し、セッショントークン、アクティビティデータ、ユーザー情報などをセキュアに管理。

### 2.2 AI分析・レポート生成機能
- **Gemini API活用**: Gemini 2.5 Pro および Structured Outputs を用いた高度な分析。
  - 有酸素性作業閾値 (AeT) や 乳酸閾値 (LT) の分析。
  - GPXベースの1kmごとのデータを用いた、トレイルランニングの疲労度やフォームの分析。
- **トレーニングプラン立案**: 「The Antifragile Engine」（耐久性とタフネスの追求）、「Earth Explorer」のコンセプトを取り入れた次週のトレーニング計画の作成。
- **GitHub Actions自動化**: 毎週月曜日にスクリプトを自動実行し、Markdownレポートを出力した上でGitHub Issueを自動作成する。

### 2.3 Webダッシュボード機能
- **可視化とUI**: React / Next.js をベースにしたモダンなWebフロントエンド。
- **分析チャート**:
  - Training Effect (TE) の分布チャート。
  - Easy Pace (HR Zone 2) の割合表示。
  - 長期的なトレンド分析（累積標高、有酸素効率、VO2max、ランニングダイナミクスのアプローチ）。
  - 自己ベスト（距離、ペース、累積標高、VO2max）の表示機能。
  - トレーニングカレンダーのヒートマップ。
- **インフラ環境**: Google Cloud Runによるコンテナデプロイ。

## 3. システム構成・技術スタック

### 3.1 技術スタック
- **バックエンド / データ処理**: Python (3.x)
- **フロントエンド / UI**: Node.js, React (Next.js系) / CSS
- **データベース / BaaS**: Supabase (PostgreSQL)
- **インフラ / ホスティング**: Google Cloud Run
- **AI / LLM**: Google Gemini 2.5 Pro API
- **CI/CD・自動化**: GitHub Actions
- **外部ツール連携**: Model Context Protocol (MCP) を用いたGitHub連携

### 3.2 ディレクトリ・ファイル構成
- `/main.py`: バックエンド処理のメインエントリーポイント。
- `/src/`: コアロジックを含むPythonモジュール。
  - `garmin.py`: Garmin Connect API通信処理。
  - `strava.py`: Strava API連携処理。
  - `gemini.py`: Gemini APIによるプロンプト実行と分析。
- `/dashboard/`: ダッシュボード（フロントエンド）のソースコード。
- `/.github/workflows/`: 自動起票および定期実行用のGitHub Actionsワークフロー定義。
- `/.antigravity/mcp_config.json`: AIエージェント用のModel Context Protocol (MCP) サーバー設定（GitHub Issue連携などに使用）。
- `/.env`: Supabaseキー、APIキーや認可情報などの環境変数（Git管理外）。
- `/docs/`: ドキュメント・仕様書群（本ファイル等）。

### 3.3 データベーススキーマ (Supabase)
本システムでは以下の主要なテーブルを用いてデータを管理しています。

#### `activities` (アクティビティサマリー)
| カラム名 | 型 | 説明 |
| :--- | :--- | :--- |
| `activityId` | String(PK) | GarminまたはStravaのアクティビティID（Stravaの場合は `strava_` プレフィックス） |
| `user_id` | String | ユーザー識別子 |
| `activityName` | String | アクティビティ名 |
| `startTimeLocal` | Timestamp | ローカル開始時刻 |
| `distance` | Float | 走行距離 |
| `duration` | Float | 経過時間・移動時間 |
| `averageSpeed` | Float | 平均ペース・速度 |
| `averageHR` | Int/Float | 平均心拍数 |
| `maxHR` | Int/Float | 最大心拍数 |
| `elevationGain` | Float | 獲得標高 |
| `description` | String | メモ・説明 |
| `vO2MaxValue` | Float | VO2Max (Garminのみ) |
| `averageRunningCadenceInStepsPerMinute` | Float | 平均ピッチ |
| `avgStrideLength` | Float | 平均ストライド長 |
| `avgVerticalOscillation` | Float | 平均上下動 |
| `avgGroundContactTime` | Float | 平均接地時間 |
| `aerobicTrainingEffect` | Float | 有酸素トレーニング効果 (TE) |
| `anaerobicTrainingEffect` | Float | 無酸素トレーニング効果 (TE) |
| `source` | String | データソース (`garmin` または `strava` 等) |

#### `gpx_points` (タイムシリーズ・ストリームデータ)
1kmラップ分析やダイナミクス可視化のために使用されるログデータです。データ量削減のため通常1/5などにダウンサンプリングして保存されます。
| カラム名 | 型 | 説明 |
| :--- | :--- | :--- |
| `id` | BigInt(PK) | レコードの自動採番ID |
| `activityId` | String | 紐づくアクティビティID |
| `user_id` | String | ユーザー識別子 |
| `time` | Timestamp | 該当ポイントの記録時刻 |
| `latitude` | Float | 緯度 |
| `longitude` | Float | 経度 |
| `elevation` | Float | 標高 |
| `heartRate` | Int/Float | 心拍数 |
| `cadence` | Int/Float | ピッチ |
| `power` | Float | パワー |
| `stride_length` | Float | ストライド長 |
| `vertical_oscillation` | Float | 上下動 |
| `ground_contact_time` | Float | 接地時間 |
| `source` | String | データソース |

#### `user_profiles` (ユーザー設定・認証情報)
| カラム名 | 型 | 説明 |
| :--- | :--- | :--- |
| `user_id` | String(PK) | ユーザー識別子 |
| `garmin_email` | String | Garminログイン用メールアドレス |
| `garmin_session_tokens` | JSON | Garminのセッショントークン情報 (IPブロック回避用) |
| `strava_access_token` | String | Strava API アクセストークン |
| `strava_refresh_token` | String | Strava API リフレッシュトークン |
| `strava_token_expires_at` | Int | Strava トークン有効期限 (Unix Timestamp) |

## 4. セキュリティと認証
- Garminの認証はパスワードベースからセッショントークンベースに移行しており、Cloud Run実行時のIPブロック問題を回避する設計となっています。
- 秘匿情報（APIキー、トークン類）は、ローカル環境では `.env` 、クラウド環境では Secret Manager や GitHub Secrets で管理されます。
- GitHub MCPサーバーの認証には、専用のパーソナルアクセストークン（PAT）が使用されています。

## 5. 将来の拡張構想
- Google Calendar APIを利用した、AI立案スケジュールの自動登録機能（実装検討段階）。
- MCPを通じたより高度なGitHub Issue管理と、AIエージェントを活用した自律的なタスク管理の連携。

## 6. 現在の課題・懸念事項 (Known Issues & Challenges)

現行のシステムにおいて、今後の運用に向けて以下の課題が整理されています：

1. **インフラの運用コスト・制限 (Cloud Run / Supabase)**
   - 個人開発の運用のため、GCPおよびSupabaseの無料枠（Free Tier）内にトラフィック・メモリ消費を収める必要があります。
   - Cloud Runのコールドスタート対策や、DBクエリ・データ量増加に伴うダウンサンプリング処理（現在は1/5にダウンサンプリング中）の最適化が引き続き必要です。

2. **Garmin認証の継続性**
   - Cloud RunのIPブロック対策として「セッショントークン認証」を導入しましたが、長期間経過した際のトークン失効（エクスパイア）対応が自動化されておらず、手動でローカルスクリプト（`generate_garmin_tokens.py`）を実行して更新しなければならない可能性があります。

3. **同期APIの安定性・エラーハンドリング**
   - Strava側とのデータ重複排除（Deduplication）は導入済みですが、稀に発生する同期エラー時の自動リトライ等、APIエンドポイント（`/api/sync`）のより堅牢なエラーハンドリングが求められます。

4. **GitHub IssueとAI連携の深化**
   - 導入したMCPを利用して、今後は出力したトレーニング管理Issueの進捗状況をAI自身が読み取り（Issue連携）、次週のプロンプトに動的に反映させるフィードバックループの構築に取り組む段階です。
