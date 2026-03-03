import os
import sys
import json
from garminconnect import Garmin
from supabase import create_client, Client
from dotenv import load_dotenv

# Run setup
load_dotenv()

def get_supabase() -> Client:
    url = os.environ.get("SUPABASE_URL", "").strip().strip('\ufeff')
    # Using service_role_secret if available, fallback to anon key
    key = (os.environ.get("SUPABASE_service_role_secret", "").strip().strip('\ufeff')
           or os.environ.get("SUPABASE_KEY", "").strip().strip('\ufeff'))
    if not url or not key:
        print("❌ Supabase credentials not found in .env")
        sys.exit(1)
    return create_client(url, key)

def main():
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    
    if not email or not password:
        print("❌ GARMIN_EMAIL and GARMIN_PASSWORD must be in .env")
        sys.exit(1)

    print(f"🔄 Logging in to Garmin Connect as {email}...")
    try:
        # Initialize client and login
        client = Garmin(email, password)
        client.login()
        
        # Garth stores the session tokens internally.
        # We dump them to a temp folder and read the json files.
        import shutil
        temp_dir = ".garth_temp"
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        client.garth.dump(temp_dir)
        
        with open(os.path.join(temp_dir, "oauth1_token.json"), "r") as f:
            oauth1 = json.load(f)
        with open(os.path.join(temp_dir, "oauth2_token.json"), "r") as f:
            oauth2 = json.load(f)
            
        tokens_dict = {
            "oauth1_token": oauth1,
            "oauth2_token": oauth2
        }
        shutil.rmtree(temp_dir)
        
        print("✅ Garmin login successful and tokens extracted.")
        
        # Connect to Supabase
        print("🔄 Connecting to Supabase...")
        supabase = get_supabase()
        
        # Since this script is run locally, we might not have the user_id readily available 
        # as a constant in this script. However, we know this is a single user setup or 
        # we can look up the user by email if we saved it in user_profiles.
        # Let's try to find their profile based on the garmin_email.
        result = supabase.table("user_profiles").select("user_id").eq("garmin_email", email).execute()
        
        if not result.data:
            print(f"❌ Could not find a user profile in Supabase with garmin_email '{email}'.")
            print("Please ensure you have saved your Garmin settings in the dashboard first.")
            sys.exit(1)
            
        user_id = result.data[0]['user_id']
        
        # Update the user profile with the new tokens
        print("🔄 Saving tokens to Supabase...")
        update_res = supabase.table("user_profiles").update({
            "garmin_session_tokens": tokens_dict
        }).eq("user_id", user_id).execute()
        
        if update_res.data:
            print("🎉 Success! Your Garmin session tokens have been securely saved to the database.")
            print("The Cloud Run backend can now use these tokens without hitting IP blocks.")
        else:
            print("❌ Failed to update the database.")
            
    except Exception as e:
        print(f"❌ Error occurred:\n{type(e).__name__}: {str(e)}")

if __name__ == "__main__":
    main()
