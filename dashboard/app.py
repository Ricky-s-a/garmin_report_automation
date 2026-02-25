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
            gpx_filtered['lat'] = pd.to_numeric(gpx_filtered.get('latitude', 0), errors='coerce')
            gpx_filtered['lon'] = pd.to_numeric(gpx_filtered.get('longitude', 0), errors='coerce')
            
            # Calculate distance using Haversine formula
            lat1 = np.radians(gpx_filtered['lat'].shift())
            lon1 = np.radians(gpx_filtered['lon'].shift())
            lat2 = np.radians(gpx_filtered['lat'])
            lon2 = np.radians(gpx_filtered['lon'])
            dlon = lon2 - lon1
            dlat = lat2 - lat1
            a = np.sin(dlat / 2.0)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0)**2
            c = 2 * np.arcsin(np.sqrt(a.clip(0, 1))) # clip to handle precision issues
            km = 6371 * c
            
            gpx_filtered['dist_km'] = km.fillna(0).cumsum()
            gpx_filtered['km_bucket'] = np.floor(gpx_filtered['dist_km']).astype(int)
            
            trend_lines = []
            for k, chunk in gpx_filtered.groupby('km_bucket'):
                if chunk.empty: continue
                avg_hr = chunk['heartRate'].mean()
                std_hr = chunk['heartRate'].std()
                avg_cad = chunk['cadence'].mean()
                avg_ele = chunk['elevation'].mean()
                ele_diff = chunk['elevation'].iloc[-1] - chunk['elevation'].iloc[0]
                
                hr_str = f"{avg_hr:.0f}bpm(σ{std_hr:.1f})" if pd.notna(avg_hr) else "--"
                cad_str = f"{avg_cad:.0f}spm" if pd.notna(avg_cad) else "--"
                ele_str = f"平{avg_ele:.0f}m(Δ{ele_diff:+.0f}m)" if pd.notna(avg_ele) else "--"
                
                trend_lines.append(f" - [{k}km~{k+1}km] 心拍:{hr_str}, ピッチ:{cad_str}, 標高:{ele_str}")
            
            if trend_lines:
                gpx_summary = "【GPX 1km毎ラップ推移データ (平均値と標準偏差σ、区間内標高変化Δ)】\n" + "\n".join(trend_lines)
    except Exception as e:
        print(f"GPX parsing error: {e}")

    # Extract new advanced metrics if they exist
    cadence = activity.get('averageRunningCadenceInStepsPerMinute')
    cadence_str = f"{int(cadence*2)} spm" if cadence else "データなし"
    
    stride = activity.get('avgStrideLength')
    stride_str = f"{stride} m" if stride else "データなし"
    
    vert_osc = activity.get('avgVerticalOscillation')
    vert_osc_str = f"{vert_osc} cm" if vert_osc else "データなし"
    
    gct = activity.get('avgGroundContactTime')
    gct_str = f"{gct} ms" if gct else "データなし"
    
    aerobic_te = activity.get('aerobicTrainingEffect')
    anaerobic_te = activity.get('anaerobicTrainingEffect')
    te_str = f"有酸素 {aerobic_te} / 無酸素 {anaerobic_te}" if (aerobic_te or anaerobic_te) else "データなし"
    
    user_content = f"""本日のランニングデータ:
距離: {dist_km:.2f} km
時間: {m}分{s}秒
平均ペース: {pace_str}
累積標高: {activity.get('elevationGain', 0)} m
平均心拍数: {activity.get('averageHR', 'Unknown')} bpm
最大心拍数: {activity.get('maxHR', 'Unknown')} bpm

【ランニングダイナミクス・指標】
ピッチ: {cadence_str}
歩幅 (ストライド): {stride_str}
上下動: {vert_osc_str}
接地時間: {gct_str}
トレーニング効果 (TE): {te_str}

{gpx_summary}

ユーザーの現状: 最近はベース構築をメインに行っており、将来的にはMt.Fuji Kai 70kのような長距離レースに参加したいと考えている。

上記のデータを評価し、アドバイスをお願いします。
特に以下の点を含めた分析をお願いします：
1. 目的に合致しているか: 心拍数やペースから、ベース構築（AeT以下）の範囲に収まっているか、または意図した強度のトレーニングになっているか。
2. ペース配分と心拍の推移: 詳細推移データから、後半タレていないか、上りで心拍を使いすぎていないか。
3. ランニングフォーム: ピッチ、ストライド、上下動、接地時間の各指標から、地形に適したまたは無駄のないエコノミーな走りができているか。
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
