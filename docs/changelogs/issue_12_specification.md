# Issue #12: Long Term View AI 分析機能 仕様書

## 1. 概要（Overview）
現在「Single Run View」で提供されているAIコーチング機能を拡張し、「Long Term View（中長期のトレンドビュー）」にもAI分析機能を導入する。
ユーザーの過去のトレーニングデータ（走行距離、ペース、心拍数、各種ランニングダイナミクスなど）のトレンドと、**来週予定している練習メニュー**を照らし合わせることで、トレーニングの方向性が目的に合致しているか、オーバートレーニングの懸念はないかといった、より長期的な視点でのAIレポートを提供する。

## 2. 対象画面
*   **ダッシュボードUI**: `dashboard/static/index.html` および `dashboard/static/dashboard.js`
*   **ターゲット箇所**: 「Long-Term Trends (Long Term View)」画面の上部または適切な分析エリア

## 3. 機能要件
1.  **AI分析UIの表示**: Long Term ViewにAI分析生成エリアを追加する。
2.  **来週のメニュー入力**: ユーザーが「来週予定している練習メニュー」や「直近の目標・コンテキスト」を入力できるテキストエリアを提供する。
3.  **使用モデルの選択機能**: ユーザー側でAIモデル（Gemini 2.5 Flash / Pro など）を選択できるようにする（Single Run Viewと同様）。
4.  **AIレポートの生成**: 過去の統計データと入力されたメニューを加味してAIを実行し、Markdown形式などでレポートを表示する。

## 4. コンポーネント別 実装方針

### 4.1 フロントエンド (`dashboard/static/index.html`, `dashboard/static/dashboard.js`)
*   **UI要素の追加**:
    *   `id="trends-view"` 内の上部に、AI分析用のカード `div.card.ai-analysis-card` を追加する。
    *   来週の練習メニューを入力を受け付ける `<textarea id="upcoming-menu">` を設置。
    *   モデル選択用 `<select id="longterm-model-select">` を設置。
    *   分析実行ボタン `<button id="btn-generate-longterm-ai">` を設置。
    *   分析結果を表示する `<div id="longterm-ai-analysis-content">` を用意する。
*   **イベントハンドラ（JS）**:
    *   ボタン押下時に、テキストエリアの内容（予定メニュー）、モデル選択値、および現在選択されている「期間（Weekly/Monthly/Yearly）」や「ユーザーID」などをまとめたペイロードを作成。
    *   新設するバックエンドAPI `/api/trends/analysis` へ POST リクエストを送信する。
    *   ローディング表示を行い、レスポンスが返却されたらマークダウンをHTMLに変換して描画する。

### 4.2 バックエンド (`dashboard/app.py`)
*   **新規APIエンドポイントの追加**:
    ```python
    @app.post("/api/trends/analysis")
    def get_trends_analysis(req: TrendsAnalysisRequest):
        ...
    ```
*   **コンテキストデータの収集**:
    リクエストを受け取った際、AIに高精度の分析をさせるため以下のデータをSupabaseから取得してまとめる。
    1.  **ランナープロファイル**: `user_profiles` テーブルから `runner_profile` や設定目標（`max_hr` など）を取得。
    2.  **ローリングスタッツ (過去の統計)**: `activity_rolling_stats` テーブル等から、過去30日・先月・去年同月などの走行距離、平均心拍、TE、ランニングダイナミクスのデータを取得（または再計算して取得）。
    3.  **ユーザー入力**: リクエストに乗ってきた「来週の予定練習メニュー」。
*   **AI (Gemini) APIの呼び出し**:
    *   上記データを文字列で構造化して `user_content` とする。
    *   Long Term分析専用の System Instruction（後述）を使用して `genai.Client` を呼び出し、結果を取得する。
*   **エラーハンドリング**:
    *   認証エラー、API呼び出し上限、入力過多等のエラーを適切にフロントへ返す。

### 4.3 プロンプトエンジニアリング (`prompts/`)
*   **新規プロンプトファイルの作成 (`prompts/long_term_prompt.txt`)**:
    現在の `system_prompt.txt` が「1回の走行（Single Run）」に対するものになっている場合、中長期分析用（Coach / Physiologistの視点）のプロンプトを新規作成する。
*   **プロンプトに含める役割・制約（案）**:
    *   全体的な負荷（ボリューム）の推移を評価し、強度が適切か（Polarized Trainingや80/20ルールの観点）。
    *   提出された「来週の予定メニュー」と過去の実績に無理がないか、目標達成に寄与するかのアドバイス。
    *   トレーニングの継続性・ピーキングに対する推奨事項。

## 5. 作業手順（ステップ）
1.  **バックエンド & プロンプトの準備**
    *   `prompts/long_term_prompt.txt` の作成
    *   `dashboard/app.py` への `/api/trends/analysis` エンドポイントおよびリクエストモデルの実装
2.  **フロントエンドのUI実装**
    *   `index.html` への要素追加（Trends View 内）
3.  **フロントエンドのロジック実装**
    *   `dashboard.js` にて API の呼び出し、ローディングUI、結果のレンダリング処理を実装
4.  **動作確認とUI/UXの微調整（デザインの適応）**
    *   実際に動かしてGeminiからの返答の質を確認し、プロンプトをチューニングする。
    *   UIが違和感なく既存デザインに溶け込んでいるかスタイルを整える。
