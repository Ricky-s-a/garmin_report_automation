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

import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from src.garmin import fetch_garmin_data, get_supabase_client

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

@app.post("/api/sync")
def sync_data():
    try:
        activities = fetch_garmin_data()
        return {"status": "success", "fetched": len(activities)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/activities")
def get_activities():
    try:
        supabase = get_supabase_client()
        response = supabase.table("activities").select("*").execute()
    except Exception as e:
        return []
    
    if not response.data:
        return []

    df = pd.DataFrame(response.data)
    df = df.fillna('')
    df['activityId'] = df['activityId'].astype(str)
    
    if 'startTimeLocal' in df.columns:
        df = df.sort_values(by='startTimeLocal', ascending=False)
        
    return df.to_dict(orient="records")

@app.get("/api/activities/{activity_id}/gpx")
def get_activity_gpx(activity_id: str):
    try:
        supabase = get_supabase_client()
        response = supabase.table("gpx_points").select("*").eq("activityId", activity_id).execute()
    except Exception as e:
        return []
    
    if not response.data:
        return []

    df_filtered = pd.DataFrame(response.data)
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
    try:
        supabase = get_supabase_client()
        response = supabase.table("activities").select("*").eq("activityId", activity_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail="Database connection error")
        
    if not response.data:
        raise HTTPException(status_code=404, detail="Activity not found")
        
    activity = response.data[0]
    
    # Read system prompt
    base_dir = os.path.dirname(os.path.dirname(__file__))
    system_prompt_path = os.path.join(base_dir, "prompts", "system_prompt.txt")
    try:
        with open(system_prompt_path, "r", encoding="utf-8") as f:
            system_instruction = f.read().strip()
    except Exception:
        system_instruction = "You are a running coach."
        
    # Prepare user prompt
    dist_m = activity.get('distance')
    dist_km = float(dist_m if dist_m else 0) / 1000
    
    duration_s = float(activity.get('duration', 0) or 0)
    m = int(duration_s // 60)
    s = int(duration_s % 60)
    
    pace_str = "--"
    speed_ms = float(activity.get('averageSpeed', 0) or 0)
    if speed_ms > 0:
        mins_per_km = 1000 / speed_ms / 60
        pm = int(mins_per_km)
        ps = int((mins_per_km - pm) * 60)
        pace_str = f"{pm}:{ps:02d} / km"
        
    # Fetch GPX data for deeper analysis
    gpx_summary = "詳細推移データ(GPX): データなし"
    try:
        gpx_resp = supabase.table("gpx_points").select("*").eq("activityId", activity_id).execute()
        if gpx_resp.data:
            import numpy as np
            gpx_filtered = pd.DataFrame(gpx_resp.data)
            gpx_filtered['elevation'] = pd.to_numeric(gpx_filtered['elevation'], errors='coerce').fillna(0)
            gpx_filtered['heartRate'] = pd.to_numeric(gpx_filtered['heartRate'], errors='coerce').fillna(0)
            gpx_filtered['cadence'] = pd.to_numeric(gpx_filtered['cadence'], errors='coerce').fillna(0)
            
            # Split the data into 10 temporal buckets
            chunks = np.array_split(gpx_filtered, min(10, len(gpx_filtered)))
            trend_lines = []
            for i, chunk in enumerate(chunks):
                avg_hr = chunk['heartRate'].mean()
                avg_cad = chunk['cadence'].mean()
                avg_ele = chunk['elevation'].mean()
                
                hr_str = f"{avg_hr:.0f}bpm" if not np.isnan(avg_hr) else "--"
                cad_str = f"{avg_cad:.0f}spm" if not np.isnan(avg_cad) else "--"
                ele_str = f"{avg_ele:.0f}m" if not np.isnan(avg_ele) else "--"
                
                trend_lines.append(f" - [%{i*10} ~ %{(i+1)*10}区間] 心拍: {hr_str}, 標高: {ele_str}, ピッチ: {cad_str}")
            
            if trend_lines:
                gpx_summary = "詳細推移データ(Run全体を10分割したときの平均遷移):\n" + "\n".join(trend_lines)
    except Exception as e:
        print(f"GPX parsing error: {e}")

    user_content = f"""本日のランニングデータ:
距離: {dist_km:.2f} km
時間: {m}分{s}秒
平均ペース: {pace_str}
平均心拍数: {activity.get('averageHR', 'Unknown')} bpm
最大心拍数: {activity.get('maxHR', 'Unknown')} bpm
累積標高: {activity.get('elevationGain', 0)} m
主観的疲労度(RPE): 確認不能 (データなし)

{gpx_summary}

ユーザーの現状: 最近はベース構築をメインに行っており、将来的にはMt.Fuji Kai 70kのような長距離レースに参加したいと考えている。

上記のデータを評価し、アドバイスをお願いします。特に、区間ごとの心拍や標高の遷移(詳細推移データ)から「後半タレていないか」「上りで心拍を使いすぎていないか」などを分析してください。
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
