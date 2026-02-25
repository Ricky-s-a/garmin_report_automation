import os
import json
import uvicorn
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

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

@app.get("/api/activities/{activity_id}/analysis")
def get_activity_analysis(activity_id: str):
    csv_path = "data/raw/all_activities.csv"
    if not os.path.exists(csv_path):
        raise HTTPException(status_code=404, detail="Data not found")
        
    df = pd.read_csv(csv_path)
    df['activityId'] = df['activityId'].astype(str)
    
    df_filtered = df[df['activityId'] == activity_id]
    if df_filtered.empty:
        raise HTTPException(status_code=404, detail="Activity not found")
        
    activity = df_filtered.iloc[0].fillna('').to_dict()
    
    # Read system prompt
    base_dir = os.path.dirname(os.path.dirname(__file__))
    system_prompt_path = os.path.join(base_dir, "prompts", "system_prompt.txt")
    try:
        with open(system_prompt_path, "r", encoding="utf-8") as f:
            system_instruction = f.read().strip()
    except Exception:
        system_instruction = "You are a running coach."
        
    # Prepare user prompt
    dist_km = float(activity.get('distance', 0)) / 1000
    duration_s = float(activity.get('duration', 0))
    m = int(duration_s // 60)
    s = int(duration_s % 60)
    
    pace_str = "--"
    speed_ms = float(activity.get('averageSpeed', 0))
    if speed_ms > 0:
        mins_per_km = 1000 / speed_ms / 60
        pm = int(mins_per_km)
        ps = int((mins_per_km - pm) * 60)
        pace_str = f"{pm}:{ps:02d} / km"
        
    user_content = f"""本日のランニングデータ:
距離: {dist_km:.2f} km
時間: {m}分{s}秒
平均ペース: {pace_str}
平均心拍数: {activity.get('averageHR', 'Unknown')} bpm
最大心拍数: {activity.get('maxHR', 'Unknown')} bpm
累積標高: {activity.get('elevationGain', 0)} m
主観的疲労度(RPE): 確認不能 (データなし)
ユーザーの現状: 最近はベース構築をメインに行っており、将来的にはMt.Fuji Kai 70kのような長距離レースに参加したいと考えている。

上記のデータを評価し、アドバイスをお願いします。
"""

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")
        
    client = genai.Client(api_key=api_key)
    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
            ),
        )
        return {"analysis": response.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print("Starting Dashboard server at http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
