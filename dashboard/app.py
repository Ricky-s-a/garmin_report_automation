import os
import json
import uvicorn
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

app = FastAPI(title="Garmin Dashboard API")

# Ensure static directory exists
os.makedirs("dashboard/static", exist_ok=True)

# Mount static files for the frontend
app.mount("/static", StaticFiles(directory="dashboard/static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    with open("dashboard/static/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.get("/api/activities")
def get_activities():
    csv_path = "data/raw/all_activities.csv"
    if not os.path.exists(csv_path):
        return []
    
    try:
        df = pd.read_csv(csv_path)
    except pd.errors.EmptyDataError:
        return []

    if df.empty or 'activityId' not in df.columns:
        return []
        
    df = df.fillna('')
    # Convert activity ID to string to ensure stable JS handling
    df['activityId'] = df['activityId'].astype(str)
    
    if 'startTimeLocal' in df.columns:
        df = df.sort_values(by='startTimeLocal', ascending=False)
        
    return df.to_dict(orient="records")

@app.get("/api/activities/{activity_id}/gpx")
def get_activity_gpx(activity_id: str):
    csv_path = "data/raw/all_gpx_points.csv"
    if not os.path.exists(csv_path):
        return []
        
    # Read in chunks or simply load filtering by ID if file isn't too huge
    # For robust production, consider reading just the needed rows or using a database.
    try:
        df = pd.read_csv(csv_path, dtype={'activityId': str})
    except pd.errors.EmptyDataError:
        return []
    
    if df.empty or 'activityId' not in df.columns:
        return []
        
    # Filter for the specific activity
    df_filtered = df[df['activityId'] == activity_id]
    if df_filtered.empty:
        return []
        
    df_filtered = df_filtered.fillna('')
    
    # Attempt to convert types for charts
    try:
        df_filtered['elevation'] = pd.to_numeric(df_filtered['elevation'], errors='coerce').fillna(0)
        df_filtered['heartRate'] = pd.to_numeric(df_filtered['heartRate'], errors='coerce').fillna(0)
        df_filtered['cadence'] = pd.to_numeric(df_filtered['cadence'], errors='coerce').fillna(0)
    except:
        pass
        
    return df_filtered.to_dict(orient="records")

if __name__ == "__main__":
    print("Starting Dashboard server at http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
