import os
from garminconnect import Garmin
from dotenv import load_dotenv

def test_garmin_login():
    load_dotenv()
    
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    
    if not email or not password:
        print("❌ .env ファイルに GARMIN_EMAIL と GARMIN_PASSWORD が設定されていません。")
        return
        
    print(f"🔄 Garmin Connect に接続中... (Email: {email})")
    try:
        # Garmin API クライアントの初期化とログイン
        client = Garmin(email, password)
        client.login()
        
        print("✅ ログイン成功！")
        
        # テストとしてフルネームを取得
        full_name = client.get_full_name()
        print(f"👤 アカウント名: {full_name}")
        
    except Exception as e:
        print(f"\n❌ エラーが発生しました:\n{type(e).__name__}: {str(e)}")

if __name__ == "__main__":
    test_garmin_login()
