FROM python:3.11-slim

# 作業ディレクトリの設定
WORKDIR /app

# 必要なパッケージツールのインストール（軽量化のために不要なものは削除）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# 依存関係ファイルのコピーとインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ソースコードのコピー
COPY . .

# Cloud Run はデフォルトで環境変数 PORT に 8080 を割り当てます
ENV PORT=8080

# Cloud Run（サービス）起動時のデフォルトコマンド
# ここでは FastAPI のダッシュボードを立ち上げます。
# バッチ処理（Cloud Run Jobs）として動かす場合は、GCP側でコマンドを "python main.py --auto" に上書き設定します。
CMD uvicorn dashboard.app:app --host 0.0.0.0 --port ${PORT}
