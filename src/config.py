import os
import logging
from dotenv import load_dotenv

def setup():
    """Load environment variables and configure logging."""
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def check_env_vars():
    """Ensure required environment variables are present."""
    required_vars = ["GARMIN_EMAIL", "GARMIN_PASSWORD", "SUPABASE_URL", "SUPABASE_KEY"]
    # Temporarily removed: "GEMINI_API_KEY", "GCP_SA_KEY", "CALENDAR_ID"
    missing_vars = [var for var in required_vars if not os.environ.get(var)]
    if missing_vars:
        raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
