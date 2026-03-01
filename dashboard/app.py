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
from src.crypto_utils import encrypt_password, decrypt_password

load_dotenv()

app = FastAPI(title="Garmin Dashboard API")

# Ensure static directory exists
os.makedirs("dashboard/static", exist_ok=True)

# Mount static files for the frontend
app.mount("/static", StaticFiles(directory="dashboard/static"), name="static")

@app.get("/api/config")
def get_config():
    # Only return public/anon key needed for frontend auth
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    
    # Strip whitespace and potential Windows PowerShell BOM characters (\ufeff)
    url = url.strip().strip('\ufeff')
    key = key.strip().strip('\ufeff')
    
    return {
        "supabase_url": url,
        "supabase_anon_key": key
    }

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    with open("dashboard/static/index.html", "r", encoding="utf-8") as f:
        return f.read()

class SyncRequest(BaseModel):
    user_id: str
    email: str = None
    password: str = None

class CredentialRequest(BaseModel):
    user_id: str
    garmin_email: str
    garmin_password: str
    runner_profile: str = ""
    max_hr: int = None

class TrailPresetsRequest(BaseModel):
    user_id: str
    trail_presets: dict

@app.delete("/api/account/{user_id}")
def delete_account(user_id: str):
    try:
        supabase = get_supabase_client()
        # Delete GPX points linked to activities of this user
        acts = supabase.table("activities").select("activityId").eq("user_id", user_id).execute()
        if acts.data:
            for act in acts.data:
                supabase.table("gpx_points").delete().eq("activityId", act["activityId"]).execute()
        
        # Delete Activities
        supabase.table("activities").delete().eq("user_id", user_id).execute()
        # Delete Trail Presets
        supabase.table("trail_presets").delete().eq("user_id", user_id).execute()
        # Delete Profile
        supabase.table("user_profiles").delete().eq("user_id", user_id).execute()
        
        return {"status": "success", "message": "All data associated with the user has been deleted."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/garmin-credentials")
def save_credentials(req: CredentialRequest):
    try:
        supabase = get_supabase_client()
        enc_pass = encrypt_password(req.garmin_password)
        data = {
            "user_id": req.user_id,
            "garmin_email": req.garmin_email,
            "garmin_password_encrypted": enc_pass,
            "runner_profile": req.runner_profile,
            "max_hr": req.max_hr
        }
        # Upsert: check if exists
        existing = supabase.table("user_profiles").select("*").eq("user_id", req.user_id).execute()
        if existing.data:
            supabase.table("user_profiles").update(data).eq("user_id", req.user_id).execute()
        else:
            supabase.table("user_profiles").insert(data).execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/garmin-credentials")
def get_credentials(user_id: str):
    try:
        supabase = get_supabase_client()
        existing = supabase.table("user_profiles").select("garmin_email,runner_profile,max_hr").eq("user_id", user_id).execute()
        if existing.data and len(existing.data) > 0:
            return {
                "garmin_email": existing.data[0].get("garmin_email", ""),
                "runner_profile": existing.data[0].get("runner_profile", ""),
                "max_hr": existing.data[0].get("max_hr")
            }
        return {"garmin_email": "", "runner_profile": "", "max_hr": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/trail-presets")
def save_trail_presets(req: TrailPresetsRequest):
    try:
        supabase = get_supabase_client()
        data = {"trail_presets": req.trail_presets}
        existing = supabase.table("user_profiles").select("user_id").eq("user_id", req.user_id).execute()
        if existing.data:
            supabase.table("user_profiles").update(data).eq("user_id", req.user_id).execute()
        else:
            data["user_id"] = req.user_id
            supabase.table("user_profiles").insert(data).execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/trail-presets")
def get_trail_presets(user_id: str):
    try:
        supabase = get_supabase_client()
        existing = supabase.table("user_profiles").select("trail_presets").eq("user_id", user_id).execute()
        if existing.data and len(existing.data) > 0:
            return existing.data[0].get("trail_presets") or {}
        return {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sync")
def sync_data(req: SyncRequest):
    try:
        email = req.email
        password = req.password
        
        # If not provided directly (frontend MVP), lookup from DB
        if not email or not password:
            supabase = get_supabase_client()
            profile = supabase.table("user_profiles").select("*").eq("user_id", req.user_id).execute()
            if not profile.data:
                raise ValueError("Garmin credentials not found for this user. Please save them first.")
            email = profile.data[0]["garmin_email"]
            password = decrypt_password(profile.data[0]["garmin_password_encrypted"])
            
        activities = fetch_garmin_data(email=email, password=password, user_id=req.user_id)
        return {"status": "success", "fetched": len(activities)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/activities")
def get_activities(user_id: str = None):
    try:
        supabase = get_supabase_client()
        query = supabase.table("activities").select("*")
        if user_id:
            query = query.eq("user_id", user_id)
        response = query.execute()
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
def get_activity_analysis(activity_id: str, regenerate: bool = False, model: str = "gemini-2.5-flash", report_type: str = "long"):
    # Allowlist to prevent arbitrary model injection
    ALLOWED_MODELS = {"gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"}
    if model not in ALLOWED_MODELS:
        model = "gemini-2.5-flash"
    try:
        supabase = get_supabase_client()
        response = supabase.table("activities").select("*").eq("activityId", activity_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail="Database connection error")
        
    if not response.data:
        raise HTTPException(status_code=404, detail="Activity not found")
        
    activity = response.data[0]
    
    # Return cached analysis if it exists and regenerate is not requested
    cache_field = "aiAnalysisShort" if report_type == "short" else "aiAnalysis"
    cached = activity.get(cache_field)
    if cached and not regenerate:
        return {"analysis": cached, "cached": True}
    
    # Read system prompt
    base_dir = os.path.dirname(os.path.dirname(__file__))
    prompt_filename = "short_prompt.txt" if report_type == "short" else "system_prompt.txt"
    system_prompt_path = os.path.join(base_dir, "prompts", prompt_filename)
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
    
    description = activity.get('description', '')
    notes_str = f"\n【ランナー自身のメモ・感想】\n{description.strip()}" if description and description.strip() else ""
    
    past_30_summary = ""
    try:
        user_id_for_profile = activity.get("user_id")
        current_date_str = activity.get("startTimeLocal")
        if user_id_for_profile and current_date_str:
            curr_date = pd.to_datetime(current_date_str, format='mixed', utc=False)
            if curr_date.tzinfo is not None:
                curr_date = curr_date.tz_localize(None)
            past_30 = curr_date - pd.Timedelta(days=30)
            past_30_iso = past_30.isoformat()
            
            history_resp = supabase.table("activities").select("distance,duration,averageSpeed,averageHR").eq("user_id", user_id_for_profile).gte("startTimeLocal", past_30_iso).lt("startTimeLocal", current_date_str).execute()
            
            if history_resp.data:
                h_df = pd.DataFrame(history_resp.data)
                h_num = len(h_df)
                h_dist = h_df['distance'].astype(float).sum() / 1000 if 'distance' in h_df else 0
                past_30_summary = f"\n【過去30日間のトレーニング状況 (本アクティビティは含まず)】\nラン回数: {h_num}回\n合計距離: {h_dist:.1f} km"
                if h_num > 0:
                    avg_dur_mins = (h_df['duration'].astype(float).sum() / h_num) / 60
                    avg_speed = h_df['averageSpeed'].astype(float).mean()
                    if avg_speed > 0:
                        mins_per_km = 1000 / avg_speed / 60
                        pm = int(mins_per_km)
                        ps = int((mins_per_km - pm) * 60)
                        past_30_summary += f"\n平均ペース: {pm}:{ps:02d} / km"
                        past_30_summary += f"\n1回あたりの平均時間: {avg_dur_mins:.0f}分"
    except Exception as e:
        print(f"Error fetching 30 days history: {e}")

    runner_profile_str = "最近はベース構築をメインに行っており、将来的にはMt.Fuji Kai 70kのような長距離レースに参加したいと考えている。"
    try:
        if user_id_for_profile:
            profile_resp = supabase.table("user_profiles").select("runner_profile").eq("user_id", user_id_for_profile).execute()
            if profile_resp.data and profile_resp.data[0].get("runner_profile"):
                runner_profile_str = profile_resp.data[0]["runner_profile"]
    except Exception as e:
        print(f"Error fetching runner profile: {e}")

    user_content = f"""本日のランニングデータ:
名前: {activity.get('activityName', 'Running')}
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
{notes_str}

{gpx_summary}
{past_30_summary}

ユーザーの現状 (AIへの共有事項): {runner_profile_str}"""

    if report_type == "long":
        user_content += """

上記のデータを評価し、アドバイスをお願いします。
特に以下の点を含めた分析をお願いします：
1. 目的に合致しているか: 心拍数やペースから、ベース構築（AeT以下）の範囲に収まっているか、または意図した強度のトレーニングになっているか。
2. ペース配分と心拍の推移: 詳細推移データから、後半タレていないか、上りで心拍を使いすぎていないか。
3. ランニングフォーム: ピッチ、ストライド、上下動、接地時間の各指標から、地形に適したまたは無駄のないエコノミーな走りができているか。
4. ランナーのメモ（あれば）: ランナー自身の感想や主観的な情報と、客観データが一致しているか、またはどんな追加的なコンテキストが得られるか。
"""

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")
        
    client = genai.Client(api_key=api_key)
    try:
        response = client.models.generate_content(
            model=model,
            contents=user_content,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
            ),
        )
        analysis_text = response.text
        
        # Save the result back to Supabase for future use
        try:
            update_data = {}
            if report_type == "short":
                update_data["aiAnalysisShort"] = analysis_text
            else:
                update_data["aiAnalysis"] = analysis_text
            supabase.table("activities").update(update_data).eq("activityId", activity_id).execute()
        except Exception as save_err:
            print(f"Warning: failed to cache AI analysis to Supabase: {save_err}")
        
        return {"analysis": analysis_text, "model": model}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print("Starting Dashboard server at http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
