import sys
import subprocess
import logging
from src.config import setup, check_env_vars
from src.garmin import fetch_garmin_data
# from src.gemini import generate_report_and_plan

def save_report(markdown_text: str):
    """Save the report markdown to a file."""
    filepath = "report_output.md"
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(markdown_text)
    logging.info(f"Saved report to {filepath}")

def run_full_pipeline():
    """Run the complete automated pipeline."""
    try:
        check_env_vars()
        logging.info("--- Starting Full Pipeline ---")
        activities = fetch_garmin_data()
        
        # Gemini integration disabled for now. Generate a fallback report.
        # weekly_plan = generate_report_and_plan(activities)
        # save_report(weekly_plan.report_markdown)
        
        fallback_report = f"# Garmin Weekly Report\n\nSuccessfully fetched {len(activities)} recent running activities.\n\n*Note: Gemini AI analysis and Google Calendar synchronization are currently disabled.*"
        save_report(fallback_report)
        
        logging.info("--- Full Pipeline Completed Successfully ---")
        
    except Exception as e:
        logging.error(f"An error occurred in pipeline: {e}", exc_info=True)
        raise

def run_data_fetch_only():
    """Only fetch and save Garmin data to CSV."""
    try:
        check_env_vars()
        logging.info("--- Starting Garmin Data Fetch ---")
        fetch_garmin_data()
        logging.info("--- Garmin Data Fetch Completed ---")
    except Exception as e:
        logging.error(f"An error occurred fetching data: {e}", exc_info=True)

def run_dashboard():
    """Launch the FastAPI dashboard."""
    logging.info("Starting Dashboard Server...")
    try:
        # Run uvicorn as a subprocess
        subprocess.run([sys.executable, "-m", "uvicorn", "dashboard.app:app", "--reload", "--host", "127.0.0.1", "--port", "8000"])
    except KeyboardInterrupt:
        print("\nDashboard server stopped.")
    except Exception as e:
        logging.error(f"Failed to start dashboard: {e}")

def display_menu():
    """Display interactive menu."""
    while True:
        print("\n" + "="*40)
        print(" Garmin Report Automation Menu")
        print("="*40)
        print("1. Run Full Pipeline (Fetch Data & Generate Plan)")
        print("2. Fetch Garmin Data Only (Update CSV)")
        print("3. Launch Local Dashboard (Web View)")
        print("0. Exit")
        print("="*40)
        
        choice = input("Select an option: ")
        
        if choice == '1':
            run_full_pipeline()
        elif choice == '2':
            run_data_fetch_only()
        elif choice == '3':
            run_dashboard()
        elif choice == '0':
            print("Exiting...")
            break
        else:
            print("Invalid option. Please try again.")

def main():
    setup()
    
    # Check if run by GitHub Actions (e.g. `--auto` flag)
    if len(sys.argv) > 1 and sys.argv[1] == '--auto':
        run_full_pipeline()
    else:
        # Run interactive menu
        display_menu()

if __name__ == '__main__':
    main()
