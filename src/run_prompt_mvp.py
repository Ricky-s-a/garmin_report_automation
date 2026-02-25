import os
import sys

# load_dotenv は .env を読み込むために使用 (インストール済みの想定)
try:
    from dotenv import load_dotenv
    # src/run_prompt_mvp.pyの親ディレクトリ（プロジェクトルート）にある .env を読み込む
    dotenv_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
    load_dotenv(dotenv_path)
except ImportError:
    pass

from google import genai
from google.genai import types
from google.genai.errors import APIError

def main():
    base_dir = os.path.dirname(os.path.dirname(__file__))
    
    # 1. システムプロンプト（理論に基づく分析方針）の読み込み
    system_prompt_path = os.path.join(base_dir, "prompts", "system_prompt.txt")
    try:
        with open(system_prompt_path, "r", encoding="utf-8") as f:
            system_instruction = f.read().strip()
    except FileNotFoundError:
        print(f"エラー: システムプロンプトが見つかりません: {system_prompt_path}")
        sys.exit(1)

    # 2. ユーザープロンプト（ダミーのGarminデータ）の読み込み
    user_prompt_path = os.path.join(base_dir, "prompts", "sample_prompt.txt")
    try:
        with open(user_prompt_path, "r", encoding="utf-8") as f:
            user_content = f.read().strip()
    except FileNotFoundError:
        print(f"エラー: ユーザープロンプトが見つかりません: {user_prompt_path}")
        sys.exit(1)
        
    print("--- 読み込んだユーザーデータ ---")
    print(user_content)
    print("--------------------------------\n")
    
    # 3. APIキーの確認
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("エラー: 環境変数 'GEMINI_API_KEY' が設定されていません。")
        sys.exit(1)
        
    # 4. Gemini APIの初期化
    print("Gemini APIを初期化中...")
    client = genai.Client(api_key=api_key)
    
    # 5. リクエスト送信・ターミナルへの出力
    print("Geminiにリクエストを送信しています...\n")
    try:
        # システムプロンプトをConfigで指定し、軽量な gemini-2.5-flash に送信
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
            ),
        )
        print("========== Gemini からの回答 ==========")
        print(response.text)
        print("=======================================")
        
    except APIError as e:
        print(f"APIエラーが発生しました: {e}")
    except Exception as e:
        print(f"予期しないエラーが発生しました: {e}")

if __name__ == "__main__":
    main()
