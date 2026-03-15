import os
import json
import uvicorn
import logging
import time as time_mod
import pandas as pd
from math import radians, sin, cos, sqrt, atan2
from datetime import datetime, timedelta
from collections import defaultdict
from fastapi import FastAPI, HTTPException, BackgroundTasks
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
from src.strava import get_auth_url, exchange_token, fetch_strava_data_with_dedup

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

from typing import Optional

class CredentialRequest(BaseModel):
    user_id: str
    garmin_email: Optional[str] = ""
    garmin_password: Optional[str] = ""
    runner_profile: str = ""
    max_hr: Optional[int] = None
    resting_hr: Optional[int] = None
    weekly_target_distance: Optional[float] = None

class TrailPresetsRequest(BaseModel):
    user_id: str
    trail_presets: dict

class TrendsAnalysisRequest(BaseModel):
    user_id: str
    upcoming_menu: str
    model: str = "gemini-1.5-flash"
    current_atl: Optional[float] = None
    current_ctl: Optional[float] = None
    current_tsb: Optional[float] = None

class MenuRequest(BaseModel):
    user_id: str
    upcoming_menu: str

@app.delete("/api/account/{user_id}/data")
def delete_activity_data(user_id: str):
    try:
        supabase = get_supabase_client()
        # Delete GPX points linked to activities of this user
        acts = supabase.table("activities").select("activityId").eq("user_id", user_id).execute()
        if acts.data:
            act_ids = [str(act["activityId"]) for act in acts.data]
            for i in range(0, len(act_ids), 20):
                chunk = act_ids[i:i+20]
                supabase.table("gpx_points").delete().in_("activityId", chunk).execute()
        
        # Delete Activities
        supabase.table("activities").delete().eq("user_id", user_id).execute()
        # Delete Pace Zone Stats cache
        supabase.table("pace_zone_stats").delete().eq("user_id", user_id).execute()
        # Delete Rolling Stats cache
        supabase.table("activity_rolling_stats").delete().eq("user_id", user_id).execute()
        
        return {"status": "success", "message": "Activity data has been deleted."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/account/{user_id}")
def delete_account(user_id: str):
    try:
        supabase = get_supabase_client()
        # Delete GPX points linked to activities of this user
        acts = supabase.table("activities").select("activityId").eq("user_id", user_id).execute()
        if acts.data:
            act_ids = [str(act["activityId"]) for act in acts.data]
            for i in range(0, len(act_ids), 20):
                chunk = act_ids[i:i+20]
                supabase.table("gpx_points").delete().in_("activityId", chunk).execute()
        
        # Delete Activities
        supabase.table("activities").delete().eq("user_id", user_id).execute()
        # Delete Pace Zone Stats cache
        supabase.table("pace_zone_stats").delete().eq("user_id", user_id).execute()
        # Delete Rolling Stats cache
        supabase.table("activity_rolling_stats").delete().eq("user_id", user_id).execute()
        # Delete Profile (which includes trail presets)
        supabase.table("user_profiles").delete().eq("user_id", user_id).execute()
        
        return {"status": "success", "message": "All data associated with the user has been deleted."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/garmin-credentials")
def save_credentials(req: CredentialRequest):
    try:
        supabase = get_supabase_client()
        data = {"user_id": req.user_id}
        if req.garmin_email:
            data["garmin_email"] = req.garmin_email
        if req.garmin_password:
            data["garmin_password_encrypted"] = encrypt_password(req.garmin_password)
        if req.runner_profile is not None:
            data["runner_profile"] = req.runner_profile
        if req.max_hr is not None:
            data["max_hr"] = req.max_hr
        
        # Note: resting_hr and weekly_target_distance are currently managed in localStorage 
        # because the database columns do not exist yet.

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
        existing = supabase.table("user_profiles").select("garmin_email,runner_profile,max_hr,last_upcoming_menu,last_longterm_analysis,last_longterm_model").eq("user_id", user_id).execute()
        if existing.data and len(existing.data) > 0:
            row = existing.data[0]
            return {
                "garmin_email": row.get("garmin_email", ""),
                "runner_profile": row.get("runner_profile", ""),
                "max_hr": row.get("max_hr"),
                "last_upcoming_menu": row.get("last_upcoming_menu", ""),
                "last_longterm_analysis": row.get("last_longterm_analysis", ""),
                "last_longterm_model": row.get("last_longterm_model", "")
            }
        return {
            "garmin_email": "", "runner_profile": "", "max_hr": None,
            "last_upcoming_menu": "", "last_longterm_analysis": "", "last_longterm_model": ""
        }
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

@app.get("/api/strava/auth-url")
def get_strava_auth_endpoint(user_id: str):
    """Generate Strava OAuth URL."""
    try:
        url = get_auth_url()
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/strava/callback")
def strava_callback(req: dict):
    """Exchange code for tokens and store in DB."""
    code = req.get("code")
    user_id = req.get("user_id")
    if not code or not user_id:
        raise HTTPException(status_code=400, detail="Missing code or user_id")
    
    try:
        tokens = exchange_token(code)
        supabase = get_supabase_client()
        
        data = {
            "strava_access_token": tokens.get("access_token"),
            "strava_refresh_token": tokens.get("refresh_token"),
            "strava_token_expires_at": tokens.get("expires_at"),
            "strava_athlete_id": str(tokens.get("athlete", {}).get("id"))
        }
        
        # Update user_profiles - upsert Strava tokens
        existing = supabase.table("user_profiles").select("user_id").eq("user_id", user_id).execute()
        if existing.data:
            supabase.table("user_profiles").update(data).eq("user_id", user_id).execute()
        else:
            data["user_id"] = user_id
            supabase.table("user_profiles").insert(data).execute()
            
        return {"status": "success", "athlete": tokens.get("athlete")}
    except Exception as e:
        logging.error(f"Strava callback error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/strava/disconnect")
def strava_disconnect(req: dict):
    """Remove Strava tokens for user."""
    user_id = req.get("user_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Missing user_id")
    
    from src.strava import disconnect_strava
    success = disconnect_strava(user_id)
    if success:
        return {"status": "success"}
    else:
        raise HTTPException(status_code=500, detail="Failed to disconnect Strava")

@app.get("/api/strava/status")
def get_strava_status(user_id: str):
    """Check if user has Strava linked."""
    try:
        supabase = get_supabase_client()
        profile = supabase.table("user_profiles").select("strava_athlete_id").eq("user_id", user_id).execute()
        if profile.data and profile.data[0].get("strava_athlete_id"):
            return {"linked": True, "athlete_id": profile.data[0]["strava_athlete_id"]}
        return {"linked": False}
    except Exception as e:
        return {"linked": False}

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
    return sync_all_data(req)

@app.post("/api/sync/all")
def sync_all_data(req: SyncRequest, background_tasks: BackgroundTasks):
    """Unified sync for Garmin and Strava."""
    # 1. Start Syncs in Parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        # Submit Garmin sync
        def _sync_garmin():
            try:
                email = req.email
                password = req.password
                session_tokens_dict = None
                
                supabase = get_supabase_client()
                profile = supabase.table("user_profiles").select("*").eq("user_id", req.user_id).execute()
                
                if profile.data:
                    if not email:
                        email = profile.data[0].get("garmin_email")
                    if not password and profile.data[0].get("garmin_password_encrypted"):
                        password = decrypt_password(profile.data[0]["garmin_password_encrypted"])
                    session_tokens_dict = profile.data[0].get("garmin_session_tokens")
                    
                if email and password:
                    activities = fetch_garmin_data(
                        email=email, 
                        password=password, 
                        user_id=req.user_id,
                        session_tokens_dict=session_tokens_dict
                    )
                    return {"status": "success", "fetched": len(activities)}
                else:
                    return {"status": "skipped", "reason": "No credentials"}
            except Exception as e:
                logging.error(f"Garmin sync error: {e}")
                return {"status": "error", "message": str(e)}

        # Submit Strava sync
        def _sync_strava():
            try:
                strava_res = fetch_strava_data_with_dedup(req.user_id)
                if strava_res:
                    return {"status": "success", **strava_res}
                else:
                    return {"status": "not_linked"}
            except Exception as e:
                logging.error(f"Strava sync error: {e}")
                return {"status": "error", "message": str(e)}

        future_garmin = executor.submit(_sync_garmin)
        future_strava = executor.submit(_sync_strava)
        
        results["garmin"] = future_garmin.result()
        results["strava"] = future_strava.result()

    # Compute and persist rolling training stats
    try:
        supabase_client = get_supabase_client()
        _compute_and_save_rolling_stats(supabase_client, req.user_id)
    except Exception as stats_err:
        logging.warning(f"Rolling stats computation failed: {stats_err}")

    # NEW: Trigger auto-generation of reports for last 5 activities in background
    if background_tasks:
        background_tasks.add_task(_auto_generate_recent_reports, req.user_id)
    else:
        # Fallback if somehow not provided (though FastAPI should provide it)
        pass

    return {"status": "success", "results": results}

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


# ── Pace-zone stats helpers ──────────────────────────────────────────────── #

_PACE_ZONES = [
    ("<5:00",     0,   300),
    ("5:00-6:00", 300, 360),
    ("6:00-7:00", 360, 420),
    ("7:00-8:00", 420, 480),
    (">8:00",     480, 9999),
]
_ZONE_NAMES = [z[0] for z in _PACE_ZONES]
_pz_mem_cache: dict = {}  # lightweight in-process cache (30 s) to avoid repeated DB reads

def _haversine_m(lat1, lon1, lat2, lon2):
    R = 6_371_000.0
    p1r, p2r = radians(lat1), radians(lat2)
    dp, dl   = radians(lat2 - lat1), radians(lon2 - lon1)
    a = sin(dp / 2) ** 2 + cos(p1r) * cos(p2r) * sin(dl / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))

def _gap_speed(actual_speed_ms: float, grade_pct: float) -> float:
    """
    Grade Adjusted Pace (GAP): convert actual speed to equivalent flat speed.
    grade_pct > 0 → uphill (harder), grade_pct < 0 → downhill (easier up to ~-15%).
    Formula: gap_speed = actual_speed × effort_factor
      uphill:   effort_factor = 1 + 0.04 × grade (4% per 1% grade, common trail approximation)
      downhill: effort_factor = 1 + 0.02 × grade (grade is negative, so factor < 1)
    Clamped to [0.6, 3.0] for sanity.
    """
    grade_pct = max(-30.0, min(45.0, grade_pct))
    effort = 1.0 + (0.04 * grade_pct if grade_pct >= 0 else 0.02 * grade_pct)
    return actual_speed_ms * max(0.6, min(3.0, effort))

def _zone_name(pace_sec_km: float) -> str:
    for name, lo, hi in _PACE_ZONES:
        if lo <= pace_sec_km < hi:
            return name
    return ">8:00"

def _period_key_fn(start_time_str: str, period: str):
    try:
        dt = datetime.fromisoformat(start_time_str.replace(" ", "T")[:19])
    except Exception:
        return None
    if period == "weekly":
        return (dt - timedelta(days=dt.weekday())).strftime("%Y-%m-%d")
    elif period == "monthly":
        return dt.strftime("%Y-%m")
    return dt.strftime("%Y")

def _empty_zstats():
    return {zn: {"t": 0.0, "hr_wt": 0.0, "sp_wt": 0.0, "t_cad": 0.0, "cad_wt": 0.0, "t_stride": 0.0, "stride_wt": 0.0, "t_osc": 0.0, "osc_wt": 0.0, "t_gct": 0.0, "gct_wt": 0.0} for zn in _ZONE_NAMES}

def _format_zstats(stats: dict) -> dict:
    out = {}
    for zn in _ZONE_NAMES:
        s = stats[zn]
        t = s["t"]
        if t < 1:
            continue
        avg_hr = s["hr_wt"] / t if t > 0 else None
        avg_sp = s["sp_wt"] / t if t > 0 else 0.0
        
        avg_cadence = s["cad_wt"] / s["t_cad"] if s["t_cad"] > 0 else None
        
        avg_stride = s["stride_wt"] / s["t_stride"] if s["t_stride"] > 0 else None
        # GPX stride_length stored in meters now; clamp to valid range
        if avg_stride and not (0.1 < avg_stride < 5.0):
            avg_stride = None
            
        avg_vert_osc = s["osc_wt"] / s["t_osc"] if s["t_osc"] > 0 else None
        # GPX vertical_oscillation stored in cm; clamp to valid range
        if avg_vert_osc and not (0 < avg_vert_osc < 20):
            avg_vert_osc = None
            
        avg_gct = s["gct_wt"] / s["t_gct"] if s["t_gct"] > 0 else None
        # GPX ground_contact_time is in ms (typically 150-400ms)
        if avg_gct:
            if not (150 < avg_gct < 500):
                avg_gct = None

        out[zn] = {
            "time_mins": round(t / 60, 1),
            "avg_hr":    round(avg_hr, 1) if avg_hr else None,
            "avg_ae":    round(avg_sp / avg_hr * 1000, 2) if avg_hr else None,
            "avg_cadence": round(avg_cadence, 1) if avg_cadence else None,
            "avg_stride": round(avg_stride, 2) if avg_stride else None,
            "avg_vert_osc": round(avg_vert_osc, 1) if avg_vert_osc else None,
            "avg_gct": round(avg_gct, 1) if avg_gct else None,
        }
    return out

def _rows_to_response(overall_rows, period_rows, date_from, date_to, period):
    """Convert flat DB rows into the API response dict."""
    overall = {}
    for r in overall_rows:
        overall[r["zone_name"]] = {
            "time_mins": r["time_mins"],
            "avg_hr":    r.get("avg_hr"),
            "avg_ae":    r.get("avg_ae"),
            "avg_cadence": r.get("avg_cadence"),
            "avg_stride": r.get("avg_stride"),
            "avg_vert_osc": r.get("avg_vert_osc"),
            "avg_gct": r.get("avg_gct"),
        }

    # filter by date range (period_key prefix)
    def in_range(pk):
        if date_from and pk < date_from[:7]:
            return False
        if date_to   and pk > date_to  [:7]:
            return False
        return True

    by_period = defaultdict(dict)
    for r in period_rows:
        if in_range(r["period_key"]):
            by_period[r["period_key"]][r["zone_name"]] = {
                "time_mins": r["time_mins"],
                "avg_hr":    r.get("avg_hr"),
                "avg_ae":    r.get("avg_ae"),
                "avg_cadence": r.get("avg_cadence"),
                "avg_stride": r.get("avg_stride"),
                "avg_vert_osc": r.get("avg_vert_osc"),
                "avg_gct": r.get("avg_gct"),
            }

    time_series = [
        {"period": pk, "zones": zones}
        for pk, zones in sorted(by_period.items())
    ]
    return {
        "overall":        overall,
        "time_series":    time_series,
        "zone_names":     _ZONE_NAMES,
        "from_cache":     True,
        "activity_count": 0,
        "point_count":    0,
    }

def _save_pz_to_db(supabase, user_id: str, period: str, result: dict):
    """Upsert computed stats into pace_zone_stats table."""
    from datetime import timezone as tz
    now_iso = datetime.now(tz.utc).isoformat()
    rows = []

    # overall rows
    for zn, stats in result.get("overall", {}).items():
        rows.append({
            "user_id":     user_id,
            "period_type": "overall",
            "period_key":  "all",
            "zone_name":   zn,
            "time_mins":   stats["time_mins"],
            "avg_hr":      stats["avg_hr"],
            "avg_ae":      stats["avg_ae"],
            "avg_cadence": stats.get("avg_cadence"),
            "avg_stride":  stats.get("avg_stride"),
            "avg_vert_osc": stats.get("avg_vert_osc"),
            "avg_gct":     stats.get("avg_gct"),
            "computed_at": now_iso,
        })

    # time-series rows
    for item in result.get("time_series", []):
        for zn, stats in item["zones"].items():
            rows.append({
                "user_id":     user_id,
                "period_type": period,
                "period_key":  item["period"],
                "zone_name":   zn,
                "time_mins":   stats["time_mins"],
                "avg_hr":      stats["avg_hr"],
                "avg_ae":      stats["avg_ae"],
                "avg_cadence": stats.get("avg_cadence"),
                "avg_stride":  stats.get("avg_stride"),
                "avg_vert_osc": stats.get("avg_vert_osc"),
                "avg_gct":     stats.get("avg_gct"),
                "computed_at": now_iso,
            })

    batch = 100
    for i in range(0, len(rows), batch):
        try:
            supabase.table("pace_zone_stats").upsert(
                rows[i:i+batch],
                on_conflict="user_id,period_type,period_key,zone_name"
            ).execute()
        except Exception as e:
            logging.error(f"pace_zone_stats upsert error: {e}")


@app.get("/api/pace-zone-stats")
def get_pace_zone_stats(
    user_id: str,
    date_from: str = None,
    date_to:   str = None,
    period:    str = "monthly",
    force:     bool = False,
):
    from datetime import timezone as tz

    # ── 0. Fast in-process cache (30 s) ───────────────────────────────────── #
    mem_key = (user_id, period)
    now_ts  = time_mod.time()
    if not force and mem_key in _pz_mem_cache:
        cached_result, cached_at = _pz_mem_cache[mem_key]
        if now_ts - cached_at < 30:
            return _rows_to_response(
                cached_result["overall_rows"],
                cached_result["period_rows"],
                date_from, date_to, period
            )

    supabase = get_supabase_client()

    # ── 1. Check Supabase DB cache (24 h TTL) ────────────────────────────── #
    if not force:
        try:
            check = (supabase.table("pace_zone_stats")
                     .select("computed_at")
                     .eq("user_id", user_id)
                     .eq("period_type", period)
                     .order("computed_at", desc=True)
                     .limit(1).execute())
            if check.data:
                ts_str = check.data[0]["computed_at"].replace("Z", "+00:00")
                computed_at = datetime.fromisoformat(ts_str)
                age = (datetime.now(tz.utc) - computed_at).total_seconds()
                if age < 86400:  # 24 hours
                    overall_rows = (supabase.table("pace_zone_stats")
                                    .select("*")
                                    .eq("user_id", user_id)
                                    .eq("period_type", "overall")
                                    .execute().data or [])
                    period_rows  = (supabase.table("pace_zone_stats")
                                    .select("*")
                                    .eq("user_id", user_id)
                                    .eq("period_type", period)
                                    .execute().data or [])
                    _pz_mem_cache[mem_key] = (
                        {"overall_rows": overall_rows, "period_rows": period_rows},
                        now_ts
                    )
                    return _rows_to_response(overall_rows, period_rows,
                                             date_from, date_to, period)
        except Exception as e:
            logging.warning(f"DB cache check failed: {e}")

    # ── 2. Full computation over ALL activities (no date filter on input) ── #
    q = (supabase.table("activities")
         .select("activityId, startTimeLocal")
         .eq("user_id", user_id))
    acts = q.execute().data or []

    act_period_map = {}
    for a in acts:
        pk = _period_key_fn(a.get("startTimeLocal", ""), period)
        if pk:
            act_period_map[str(a["activityId"])] = pk

    activity_ids = list(act_period_map.keys())
    if not activity_ids:
        return {"overall": {}, "time_series": [], "zone_names": _ZONE_NAMES,
                "activity_count": 0, "point_count": 0, "from_cache": False}

    # ── 3. Batch-fetch GPX points — now includes elevation ──────────────── #
    all_points: list = []
    for i in range(0, len(activity_ids), 20):
        chunk = activity_ids[i: i + 20]
        offset = 0
        while True:
            try:
                resp = (supabase.table("gpx_points")
                        .select("activityId,time,latitude,longitude,"
                                "elevation,heartRate,cadence,stride_length,"
                                "vertical_oscillation,ground_contact_time")
                        .in_("activityId", chunk)
                        .order("activityId").order("time")
                        .range(offset, offset + 999)
                        .execute())
                rows = resp.data or []
                all_points.extend(rows)
                if len(rows) < 1000:
                    break
                offset += 1000
            except Exception as e:
                logging.error(f"gpx batch error: {e}")
                break

    # ── 4. Group by activity ─────────────────────────────────────────────── #
    pts_by_act = defaultdict(list)
    for pt in all_points:
        pts_by_act[str(pt["activityId"])].append(pt)
    for aid in pts_by_act:
        pts_by_act[aid].sort(key=lambda p: str(p.get("time", "")))

    # ── 5. Compute GAP-based pace-zone statistics ────────────────────────── #
    overall    = _empty_zstats()
    period_map: dict = {}

    for aid, pts in pts_by_act.items():
        pk = act_period_map.get(aid)
        if not pk:
            continue
        if pk not in period_map:
            period_map[pk] = _empty_zstats()
        pstats = period_map[pk]

        for i in range(1, len(pts)):
            p0, p1 = pts[i - 1], pts[i]

            # time delta
            try:
                t0  = datetime.fromisoformat(str(p0["time"]).replace("Z", "+00:00"))
                t1  = datetime.fromisoformat(str(p1["time"]).replace("Z", "+00:00"))
                dt_s = (t1 - t0).total_seconds()
                if dt_s <= 0 or dt_s > 120:
                    continue
            except Exception:
                continue

            # actual speed from GPS
            speed_ms = None
            dist_m   = None
            try:
                la0 = float(p0.get("latitude")  or 0)
                lo0 = float(p0.get("longitude") or 0)
                la1 = float(p1.get("latitude")  or 0)
                lo1 = float(p1.get("longitude") or 0)
                if la0 and la1:
                    dist_m = _haversine_m(la0, lo0, la1, lo1)
                    s = dist_m / dt_s
                    if 0.8 < s < 8.0:
                        speed_ms = s
            except Exception:
                pass

            # stride × cadence fallback (treadmill)
            if speed_ms is None:
                try:
                    sl  = float(p1.get("stride_length") or 0)
                    cad = float(p1.get("cadence")       or 0)
                    s   = 0.0
                    if sl > 100 and cad > 100:
                        s = (sl / 1000.0) * (cad / 60.0)
                    elif 0.3 < sl < 3.0 and cad > 100:
                        s = sl * (cad / 60.0)
                    if 0.8 < s < 8.0:
                        speed_ms = s
                except Exception:
                    pass

            if speed_ms is None:
                continue

            # ── GAP adjustment using elevation ──────────────────────────── #
            gap_speed = speed_ms  # default: no adjustment
            if dist_m and dist_m > 0:
                try:
                    ele0 = float(p0.get("elevation") or 0)
                    ele1 = float(p1.get("elevation") or 0)
                    if ele0 != 0 or ele1 != 0:
                        grade_pct = (ele1 - ele0) / dist_m * 100
                        gap_speed = _gap_speed(speed_ms, grade_pct)
                except Exception:
                    pass

            zn = _zone_name(1000.0 / gap_speed)

            try:
                hr = float(p1.get("heartRate") or 0)
                if hr < 60 or hr > 220:
                    continue
            except Exception:
                continue

            cad_raw = float(p1.get("cadence") or 0)
            # Garmin often stores cadence as steps for one foot (e.g. 80-95). We want SPM (160-190).
            cad = cad_raw * 2 if 0 < cad_raw < 130 else cad_raw
            
            stride = float(p1.get("stride_length") or 0)
            # Garmin SDK stride is sometimes 2 footsteps. Convert to single Step Length.
            if stride > 1.6:
                stride = stride / 2.0
                
            vert_osc = float(p1.get("vertical_oscillation") or 0)
            gct = float(p1.get("ground_contact_time") or 0)

            for sd in (overall[zn], pstats[zn]):
                sd["t"]     += dt_s
                sd["hr_wt"] += hr * dt_s
                sd["sp_wt"] += gap_speed * dt_s   # store GAP speed
                if cad > 100:  # already converted to SPM
                    sd["t_cad"] += dt_s
                    sd["cad_wt"] += cad * dt_s
                if stride > 0:
                    sd["t_stride"] += dt_s
                    sd["stride_wt"] += stride * dt_s
                if vert_osc > 0:
                    sd["t_osc"] += dt_s
                    sd["osc_wt"] += vert_osc * dt_s
                if gct > 0:
                    sd["t_gct"] += dt_s
                    sd["gct_wt"] += gct * dt_s


    # ── 6. Format ─────────────────────────────────────────────────────────── #
    time_series = [
        {"period": pk, "zones": _format_zstats(period_map[pk])}
        for pk in sorted(period_map.keys())
    ]
    result = {
        "overall":        _format_zstats(overall),
        "time_series":    time_series,
        "zone_names":     _ZONE_NAMES,
        "activity_count": len(activity_ids),
        "point_count":    len(all_points),
        "from_cache":     False,
    }

    # ── 7. Persist to Supabase ──────────────────────────────────────────── #
    try:
        _save_pz_to_db(supabase, user_id, period, result)
    except Exception as e:
        logging.error(f"Failed to save pace-zone stats: {e}")

    # ── 8. Filter output by requested date range ─────────────────────────── #
    if date_from or date_to:
        result["time_series"] = [
            item for item in result["time_series"]
            if (not date_from or item["period"] >= date_from[:7])
            and (not date_to   or item["period"] <= date_to  [:7])
        ]

    return result


# ── Rolling Training Stats helpers ──────────────────────────────────────── #

_ROLLING_COLS = ",".join([
    "distance", "averageSpeed", "averageHR", "aerobicTrainingEffect",
    "averageRunningCadenceInStepsPerMinute", "avgStrideLength",
    "avgVerticalOscillation", "avgGroundContactTime"
])

def _agg_activities(rows: list) -> dict | None:
    """Aggregate key metrics from a list of activity rows. Returns None if empty."""
    if not rows:
        return None
    import numpy as np
    df = pd.DataFrame(rows)
    result = {"run_count": len(df)}

    dist = pd.to_numeric(df.get("distance", pd.Series(dtype=float)), errors="coerce").fillna(0)
    result["total_dist_km"] = round(float(dist.sum()) / 1000, 1)

    for col, out_key, transform in [
        ("averageSpeed",                          "avg_pace_sec_km",  lambda v: round(1000 / v, 1) if v > 0 else None),
        ("averageHR",                             "avg_hr",           lambda v: round(v, 1)),
        ("aerobicTrainingEffect",                 "avg_te_aerobic",   lambda v: round(v, 2)),
        ("averageRunningCadenceInStepsPerMinute", "avg_cadence_spm",  lambda v: round(v, 1)),
        ("avgStrideLength",                       "avg_stride_m",     lambda v: round(v/100.0 if v >= 50 else v, 2)),
        ("avgVerticalOscillation",                "avg_vert_osc_cm",  lambda v: round(v/10.0 if v > 20 else v, 1)),
        ("avgGroundContactTime",                  "avg_gct_ms",       lambda v: round(v * 1000 if v < 3 else v, 0)),
    ]:
        if col in df.columns:
            vals = pd.to_numeric(df[col], errors="coerce").dropna()
            vals = vals[vals > 0]
            if not vals.empty:
                mean_val = float(vals.mean())
                result[out_key] = transform(mean_val)
    return result


def _compute_and_save_rolling_stats(supabase, user_id: str, reference_date=None) -> dict:
    """
    Compute 30-day rolling, prev-month, and prev-year-same-month stats
    for the given user, upsert into activity_rolling_stats, and return the row.
    reference_date: str or datetime (default: today UTC)
    """
    from datetime import timezone as tz

    if reference_date is None:
        ref = datetime.now(tz.utc)
    else:
        ref = pd.to_datetime(reference_date, utc=True).to_pydatetime()
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=tz.utc)

    # ── Window definitions ──────────────────────────────────────────────── #
    ref_iso      = ref.isoformat()
    d30_start    = (ref - timedelta(days=30)).isoformat()

    first_of_ref_month = ref.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    prev_month_end     = first_of_ref_month.isoformat()
    prev_month_last    = first_of_ref_month - timedelta(days=1)
    prev_month_start   = prev_month_last.replace(day=1).isoformat()

    try:
        pysm_start = ref.replace(year=ref.year - 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    except ValueError:  # Feb 29 edge case
        pysm_start = ref.replace(year=ref.year - 1, month=2, day=28, hour=0, minute=0, second=0, microsecond=0)
    pysm_end = (pysm_start.replace(month=pysm_start.month + 1)
                if pysm_start.month < 12
                else pysm_start.replace(year=pysm_start.year + 1, month=1))

    def fetch_window(start, end):
        try:
            resp = (supabase.table("activities")
                    .select(_ROLLING_COLS)
                    .eq("user_id", user_id)
                    .gte("startTimeLocal", start)
                    .lt("startTimeLocal", end)
                    .execute())
            return resp.data or []
        except Exception as e:
            logging.warning(f"rolling stats fetch error: {e}")
            return []

    d30_data  = _agg_activities(fetch_window(d30_start,             ref_iso))
    pm_data   = _agg_activities(fetch_window(prev_month_start,      prev_month_end))
    pysm_data = _agg_activities(fetch_window(pysm_start.isoformat(), pysm_end.isoformat()))

    row = {
        "user_id":        user_id,
        "computed_at":    datetime.now(tz.utc).isoformat(),
        "reference_date": ref.date().isoformat(),
    }
    for prefix, data in [("d30", d30_data), ("pm", pm_data), ("pysm", pysm_data)]:
        if data:
            for k, v in data.items():
                row[f"{prefix}_{k}"] = v

    try:
        supabase.table("activity_rolling_stats").upsert(row, on_conflict="user_id").execute()
        logging.info(f"Rolling stats saved for user {user_id}")
    except Exception as e:
        logging.error(f"Failed to save rolling stats: {e}")
    return row


def _format_rolling_stats_for_prompt(stats: dict) -> str:
    """Format an activity_rolling_stats row into a readable prompt section."""
    if not stats:
        return ""

    def pace_str(sec_km):
        if not sec_km:
            return "--"
        pm = int(sec_km // 60)
        ps = int(sec_km % 60)
        return f"{pm}:{ps:02d}/km"

    def fmt(val, unit=""):
        if val is None:
            return "--"
        return f"{val}{unit}"

    d30  = {k[4:]:  v for k, v in stats.items() if k.startswith("d30_")}
    pm   = {k[3:]:  v for k, v in stats.items() if k.startswith("pm_")}
    pysm = {k[5:]:  v for k, v in stats.items() if k.startswith("pysm_")}

    metrics = [
        ("ラン回数",        "run_count",        "",     False),
        ("合計距離",        "total_dist_km",    "km",   False),
        ("平均ペース",      "avg_pace_sec_km",  "pace", False),
        ("平均心拍",        "avg_hr",           "bpm",  False),
        ("平均ピッチ",      "avg_cadence_spm",  "spm",  False),
        ("平均ストライド",  "avg_stride_m",     "m",    False),
        ("平均上下動",      "avg_vert_osc_cm",  "cm",   False),
        ("平均接地時間",    "avg_gct_ms",       "ms",   False),
        ("平均有酸素TE",    "avg_te_aerobic",   "",     False),
    ]

    lines = ["【過去トレーニング統計 (AI分析コンテキスト)】"]
    lines.append(f"{'指標':<16} {'過去30日':>12} {'先月':>12} {'去年同月':>12}")
    lines.append("-" * 56)
    for label, key, unit, _ in metrics:
        v30   = d30.get(key)
        vpm   = pm.get(key)
        vpysm = pysm.get(key)
        if unit == "pace":
            s30, spm, spysm = pace_str(v30), pace_str(vpm), pace_str(vpysm)
        else:
            s30, spm, spysm = fmt(v30, unit), fmt(vpm, unit), fmt(vpysm, unit)
        lines.append(f"{label:<16} {s30:>12} {spm:>12} {spysm:>12}")

    return "\n".join(lines)

def _get_recent_activities_context(supabase, user_id: str, count: int = 10, full_notes: bool = False) -> str:
    try:
        resp = supabase.table("activities").select("startTimeLocal, activityName, distance, averageSpeed, averageHR, aerobicTrainingEffect, description, aiAnalysisShort, aiAnalysis").eq("user_id", user_id).order("startTimeLocal", desc=True).limit(count).execute()
        if not resp.data:
            return ""
        
        lines = [f"【最近の個別アクティビティ履歴 (直近{len(resp.data)}件)】"]
        lines.append(f"{'日付':<12} {'名称':<25} {'距離':>6} {'ペース':>7} {'心拍':>5} {'TE':>4}")
        lines.append("-" * 75)
        
        for a in resp.data:
            dt = a.get("startTimeLocal", "")[:10]
            name = (a.get("activityName") or "Untitled")[:24]
            dist_m = a.get("distance", 0)
            dist_km = dist_m / 1000 if dist_m else 0
            
            speed = a.get("averageSpeed", 0)
            pace = "--"
            if speed > 0:
                mpk = 1000 / speed / 60
                pace = f"{int(mpk)}:{int((mpk-int(mpk))*60):02d}"
                
            hr = str(a.get("averageHR") or "--")
            te = str(a.get("aerobicTrainingEffect") or "--")
            
            desc = a.get("description")
            desc_str = ""
            if desc and desc.strip():
                if full_notes:
                    desc_str += f"\n   >> ユーザーメモ: {desc.strip()}"
                else:
                    desc_truncated = desc.strip()[:35]
                    desc_str += f" (備考: {desc_truncated}...)" if len(desc.strip()) > 35 else f" (備考: {desc.strip()})"
            
            # Add AI analyses if available and in enriched mode
            if full_notes:
                ai_long = a.get("aiAnalysis")
                ai_short = a.get("aiAnalysisShort")
                if ai_long and ai_long.strip():
                    desc_str += f"\n   >> AIコーチの詳細レポート:\n{ai_long.strip()}"
                elif ai_short and ai_short.strip():
                    desc_str += f"\n   >> AIコーチの評価: {ai_short.strip()}"
            
            lines.append(f"{dt:<12} {name:<25} {dist_km:>5.1f}k {pace:>7} {hr:>5} {te:>4}{desc_str}")
            
        return "\n".join(lines)
    except Exception as e:
        logging.warning(f"Error fetching recent activities context: {e}")
        return ""





def _get_pace_zone_context(supabase, user_id: str, limit: int = 15, enriched: bool = False) -> str:
    try:
        # monthly stats (5 zones * N months)
        resp = supabase.table("pace_zone_stats").select("*").eq("user_id", user_id).eq("period_type", "monthly").order("period_key", desc=True).limit(limit).execute()
        if not resp.data:
            return ""
        
        # Group by month
        by_month = defaultdict(list)
        for r in resp.data:
            by_month[r["period_key"]].append(r)
            
        lines = ["【ペース帯別トレーニング分布 (月次推移)】"]
        for month in sorted(by_month.keys(), reverse=True):
            lines.append(f"■ {month}")
            # Order by zone name
            for r in sorted(by_month[month], key=lambda x: x["zone_name"]):
                time_m = r.get("time_mins", 0)
                if time_m > 0:
                    hr = r.get('avg_hr') or '--'
                    ae = r.get('avg_ae') or '--'
                    cad = r.get('avg_cadence') or '--'
                    stride = r.get('avg_stride') or '--'
                    parts = [f"時間: {time_m:>5.1f} 分", f"心拍: {hr:>3} bpm", f"効率(Ae): {ae:>4}"]
                    if enriched:
                        osc = r.get('avg_vert_osc') or '--'
                        gct = r.get('avg_gct') or '--'
                        parts.extend([f"ピッチ: {cad:>3} spm", f"歩幅: {stride:>4} m", f"上下動: {osc:>4} cm", f"接地: {gct:>3} ms"])
                    lines.append(f"  - {r['zone_name']:<10}: " + ", ".join(parts))
        
        return "\n".join(lines)
    except Exception as e:
        logging.warning(f"Error fetching pace zone context: {e}")
        return ""

def _get_weekly_training_summary(supabase, user_id: str, limit_weeks: int = 8) -> str:
    try:
        # Get weekly pace zone stats (5 zones * N weeks)
        resp = supabase.table("pace_zone_stats").select("*").eq("user_id", user_id).eq("period_type", "weekly").order("period_key", desc=True).limit(limit_weeks * 5).execute()
        if not resp.data:
            return ""
        
        # Group by week
        by_week = defaultdict(list)
        for r in resp.data:
            by_week[r["period_key"]].append(r)
            
        lines = ["【週次トレーニングボリューム推移 (最近8週間)】"]
        for week_start in sorted(by_week.keys(), reverse=True):
            total_mins = sum(r.get("time_mins", 0) for r in by_week[week_start])
            if total_mins < 1: continue
            
            lines.append(f"■ 週開始日: {week_start} (合計 {total_mins:.0f} 分)")
            for r in sorted(by_week[week_start], key=lambda x: x["zone_name"]):
                m = r.get("time_mins", 0)
                if m > 0:
                    perc = (m / total_mins * 100) if total_mins > 0 else 0
                    lines.append(f"  - {r['zone_name']:<10}: {m:>5.1f} 分 ({perc:>3.0f}%)")
        
        return "\n".join(lines)
    except Exception as e:
        logging.warning(f"Error fetching weekly summary: {e}")
        return ""


def _build_longterm_user_content(supabase, req, profile_data, rolling_stats_row, enriched: bool = False):
    runner_profile = profile_data.get("runner_profile", "") if profile_data else ""
    max_hr = profile_data.get("max_hr") if profile_data else None
    
    rolling_context = ""
    if rolling_stats_row:
        rolling_context = _format_rolling_stats_for_prompt(rolling_stats_row)
    
    # Context Volume Adjustment
    act_count = 30 if enriched else 10
    pz_limit = 30 if enriched else 15 # 6 months vs 3 months
    
    recent_activities = _get_recent_activities_context(supabase, req.user_id, count=act_count, full_notes=enriched)

    pace_zones = _get_pace_zone_context(supabase, req.user_id, limit=pz_limit, enriched=enriched)
    weekly_summary = _get_weekly_training_summary(supabase, req.user_id, limit_weeks=8 if enriched else 4)

    # 1. Training Effect Trend (Enriched only)
    te_context = ""
    if enriched:
        try:
            te_resp = supabase.table("activities").select("startTimeLocal, aerobicTrainingEffect, anaerobicTrainingEffect").eq("user_id", req.user_id).order("startTimeLocal", desc=True).limit(20).execute()
            if te_resp.data:
                te_lines = ["【最近のトレーニング効果 (TE) 推移】"]
                for a in te_resp.data:
                    dt = a["startTimeLocal"][:10]
                    ae = a.get("aerobicTrainingEffect") or 0.0
                    an = a.get("anaerobicTrainingEffect") or 0.0
                    te_lines.append(f"  - {dt}: 有酸素 {ae:.1f} / 無酸素 {an:.1f}")
                te_context = "\n" + "\n".join(te_lines) + "\n"
        except Exception: pass

    # 2. Zone 2 Proportion Trend (Approximate from activities)
    z2_context = ""
    if enriched:
        try:
            # We don't have a direct zone2_ratio in activities, but we can look at aerobicTrainingEffect or 
            # approximate from long-term pace_zone_stats monthly rollup.
            pass # already covered by pace_zones detailed breakdown in enriched mode
        except Exception: pass
    
    # Latest VO2Max
    vo2_max_str = ""
    try:
        vo2_resp = supabase.table("activities").select("vO2MaxValue").eq("user_id", req.user_id).order("startTimeLocal", desc=True).limit(1).execute()
        if vo2_resp.data and vo2_resp.data[0].get("vO2MaxValue"):
            vo2_max_str = f"最新の推定VO2Max: {vo2_resp.data[0]['vO2MaxValue']}"
    except Exception:
        pass
    
    metrics_context = ""
    if req.current_atl is not None or req.current_ctl is not None or req.current_tsb is not None:
        metrics_context = f"""【現在のトレーニング指標】
- ATL (疲労/短期負荷): {req.current_atl if req.current_atl is not None else "--"}
- CTL (体力/長期負荷): {req.current_ctl if req.current_ctl is not None else "--"}
- TSB (フォーム/バランス): {req.current_tsb if req.current_tsb is not None else "--"}
"""

    user_content = f"""{metrics_context}
{vo2_max_str}

【現在のユーザープロファイル・目標】
{runner_profile if runner_profile else "記載なし"}
{f"設定最大心拍数: {max_hr} bpm" if max_hr else ""}


{rolling_context if rolling_context else "過去の統計データがまだ十分ではありません。"}

{pace_zones if pace_zones else ""}
{te_context}
{weekly_summary if weekly_summary else ""}

{recent_activities if recent_activities else ""}


【来週の予定練習メニュー】
{req.upcoming_menu if req.upcoming_menu else "未入力"}

上記の情報に基づき、中長期的な分析とアドバイスをお願いします。"""
    return user_content





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
    numeric_cols = ['elevation', 'heartRate', 'cadence', 'power', 
                    'stride_length', 'vertical_oscillation', 'ground_contact_time']
    for col in numeric_cols:
        if col in df_filtered.columns:
            df_filtered[col] = pd.to_numeric(df_filtered[col], errors='coerce').fillna(0)
        
    return df_filtered.to_dict(orient="records")

def _generate_single_activity_analysis(activity_id: str, report_type: str = "long", model: str = "gemini-2.0-flash", regenerate: bool = False):
    # Allowlist to prevent arbitrary model injection
    ALLOWED_MODELS = {"gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"}
    if model not in ALLOWED_MODELS:
        model = "gemini-2.0-flash"
    try:
        supabase = get_supabase_client()
        response = supabase.table("activities").select("*").eq("activityId", activity_id).execute()
    except Exception as e:
        raise Exception(f"Database connection error: {e}")
        
    if not response.data:
        raise Exception("Activity not found")
        
    activity = response.data[0]
    
    # Return cached analysis if it exists and regenerate is not requested
    cache_field = "aiAnalysisShort" if report_type == "short" else "aiAnalysis"
    cached = activity.get(cache_field)
    if cached and not regenerate:
        return {"analysis": cached, "cached": True, "model": model}
    
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
            
            # Calculate distance using Haversine formula only on valid points
            gpx_filtered['lat'] = gpx_filtered['lat'].replace(0, np.nan)
            gpx_filtered['lon'] = gpx_filtered['lon'].replace(0, np.nan)
            valid_idx = gpx_filtered[['lat', 'lon']].dropna().index
            
            gpx_filtered['dist_diff'] = 0.0
            if len(valid_idx) > 0:
                lat1 = np.radians(gpx_filtered.loc[valid_idx, 'lat'].shift())
                lon1 = np.radians(gpx_filtered.loc[valid_idx, 'lon'].shift())
                lat2 = np.radians(gpx_filtered.loc[valid_idx, 'lat'])
                lon2 = np.radians(gpx_filtered.loc[valid_idx, 'lon'])
                dlon = lon2 - lon1
                dlat = lat2 - lat1
                a = np.sin(dlat / 2.0)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2.0)**2
                c = 2 * np.arcsin(np.sqrt(a.clip(0, 1))) # clip to handle precision issues
                km_diff = (6371 * c).fillna(0)
                gpx_filtered.loc[valid_idx, 'dist_diff'] = km_diff
                
            gpx_filtered['dist_km'] = gpx_filtered['dist_diff'].cumsum()
            gpx_filtered['km_bucket'] = np.floor(gpx_filtered['dist_km']).astype(int)
            
            trend_lines = []
            for k, chunk in gpx_filtered.groupby('km_bucket'):
                if chunk.empty: continue
                cum_dist = chunk['dist_km'].iloc[-1]
                avg_hr = chunk['heartRate'].mean()
                std_hr = chunk['heartRate'].std()
                avg_cad = chunk['cadence'].mean()
                avg_ele = chunk['elevation'].mean()
                ele_diff = chunk['elevation'].iloc[-1] - chunk['elevation'].iloc[0]
                
                hr_str = f"{avg_hr:.0f}bpm(σ{std_hr:.1f})" if pd.notna(avg_hr) else "--"
                cad_str = f"{avg_cad*2:.0f}spm" if pd.notna(avg_cad) else "--"
                ele_str = f"平{avg_ele:.0f}m(Δ{ele_diff:+.0f}m)" if pd.notna(avg_ele) else "--"
                
                trend_lines.append(f" - [{k}km~{k+1}km] (累積:{cum_dist:.1f}km) 心拍:{hr_str}, ピッチ:{cad_str}, 標高:{ele_str}")
            
            if trend_lines:
                gpx_summary = "【GPX 1km毎ラップ推移データ (平均値と標準偏差σ、区間内標高変化Δ)】\n" + "\n".join(trend_lines)
                
            try:
                if 'time' in gpx_filtered.columns:
                    gpx_filtered['time_dt'] = pd.to_datetime(gpx_filtered['time'], errors='coerce')
                    gpx_filtered['dt_s'] = gpx_filtered['time_dt'].diff().dt.total_seconds().fillna(0)
                    
                    gpx_filtered['speed_ms'] = np.where(gpx_filtered['dt_s'] > 0, (gpx_filtered['dist_diff'] * 1000) / gpx_filtered['dt_s'], 0)
                    ele_diff_all = gpx_filtered['elevation'].diff().fillna(0)
                    dist_m = gpx_filtered['dist_diff'] * 1000
                    
                    grade_pct = np.zeros(len(gpx_filtered))
                    dist_mask = dist_m > 0
                    grade_pct[dist_mask] = (ele_diff_all[dist_mask] / dist_m[dist_mask] * 100)
                    grade_pct = np.clip(grade_pct, -30.0, 45.0)
                    
                    effort = 1.0 + np.where(grade_pct >= 0, 0.04 * grade_pct, 0.02 * grade_pct)
                    effort = np.clip(effort, 0.6, 3.0)
                    gap_speed = gpx_filtered['speed_ms'] * effort
                    
                    def get_gap_zone(s):
                        if s < 0.8 or s > 8.0: return None
                        pace_s = 1000 / s
                        if pace_s < 300: return "<5:00/km"
                        elif pace_s < 360: return "5:00-6:00/km"
                        elif pace_s < 420: return "6:00-7:00/km"
                        elif pace_s < 480: return "7:00-8:00/km"
                        else: return ">8:00/km"
                    
                    gpx_filtered['gap_zone'] = gap_speed.apply(get_gap_zone)
                    
                    sl = pd.to_numeric(gpx_filtered.get('stride_length', 0), errors='coerce').fillna(0)
                    gpx_filtered['stride_m'] = np.where(sl >= 50, sl / 100.0, sl)
                    
                    vo = pd.to_numeric(gpx_filtered.get('vertical_oscillation', 0), errors='coerce').fillna(0)
                    gpx_filtered['vo_cm'] = np.where(vo > 20, vo / 10.0, vo)
                    
                    gct = pd.to_numeric(gpx_filtered.get('ground_contact_time', 0), errors='coerce').fillna(0)
                    gpx_filtered['gct_ms'] = np.where((gct < 3) & (gct > 0), gct * 1000, gct)
                    
                    gap_lines = []
                    for zone in ["<5:00/km", "5:00-6:00/km", "6:00-7:00/km", "7:00-8:00/km", ">8:00/km"]:
                        grp = gpx_filtered[gpx_filtered['gap_zone'] == zone]
                        if grp.empty: continue
                        dur_m = grp['dt_s'].sum() / 60.0
                        if dur_m < 0.5: continue
                        
                        avg_cad = grp['cadence'].replace(0, np.nan).mean()
                        avg_str = grp['stride_m'].replace(0, np.nan).mean()
                        avg_vo = grp['vo_cm'].replace(0, np.nan).mean()
                        avg_gct = grp['gct_ms'].replace(0, np.nan).mean()
                        
                        parts = [f"時間:{dur_m:.1f}分"]
                        if pd.notna(avg_cad) and avg_cad > 0: parts.append(f"ピッチ:{avg_cad*2:.0f}spm")
                        if pd.notna(avg_str) and avg_str > 0: parts.append(f"歩幅:{avg_str:.2f}m")
                        if pd.notna(avg_vo) and avg_vo > 0: parts.append(f"上下動:{avg_vo:.1f}cm")
                        if pd.notna(avg_gct) and avg_gct > 0: parts.append(f"接地:{avg_gct:.0f}ms")
                        
                        gap_lines.append(f" - [{zone}] " + ", ".join(parts))
                        
                    if gap_lines:
                        gpx_summary += "\n\n【GAP帯（平地換算ペース）別の平均ランニングフォーム・ダイナミクス】\n" + "\n".join(gap_lines)
            except Exception as e:
                print(f"GAP dynamics calculate error: {e}")
                
    except Exception as e:
        print(f"GPX parsing error: {e}")

    # Extract new advanced metrics if they exist
    cadence = activity.get('averageRunningCadenceInStepsPerMinute')
    cadence_str = f"{int(cadence)} spm" if cadence else "データなし"
    
    stride = activity.get('avgStrideLength')
    if stride is not None:
        stride_val = float(stride)
        if stride_val >= 50:
            stride_val /= 100.0
        stride_str = f"{stride_val:.2f} m"
    else:
        stride_str = "データなし"
    
    vert_osc = activity.get('avgVerticalOscillation')
    if vert_osc is not None:
        vo_val = float(vert_osc)
        if vo_val > 20: # Assume it's actually in mm (e.g., 85 mm -> 8.5 cm)
            vo_val /= 10.0
        vert_osc_str = f"{vo_val:.1f} cm"
    else:
        vert_osc_str = "データなし"
    
    gct = activity.get('avgGroundContactTime')
    if gct is not None:
        gct_val = float(gct)
        # Sometimes GCT might be scaled differently, usually it's in ms (e.g. 250)
        if gct_val < 3: # If somehow it's in seconds
            gct_val *= 1000
        gct_str = f"{gct_val:.0f} ms"
    else:
        gct_str = "データなし"
    
    aerobic_te = activity.get('aerobicTrainingEffect')
    anaerobic_te = activity.get('anaerobicTrainingEffect')
    te_str = f"有酸素 {aerobic_te} / 無酸素 {anaerobic_te}" if (aerobic_te or anaerobic_te) else "データなし"
    
    description = activity.get('description', '')
    notes_str = f"\n【ランナー自身のメモ・感想】\n{description.strip()}" if description and description.strip() else ""
    
    # ── Fetch pre-computed rolling stats for AI context ──────────────────── #
    rolling_context = ""
    user_id_for_profile = activity.get("user_id")
    current_date_str    = activity.get("startTimeLocal")
    try:
        if user_id_for_profile:
            rs_resp = supabase.table("activity_rolling_stats").select("*").eq("user_id", user_id_for_profile).execute()
            if rs_resp.data:
                rolling_context = "\n" + _format_rolling_stats_for_prompt(rs_resp.data[0])
            else:
                # On-demand fallback: compute now and cache
                stats_row = _compute_and_save_rolling_stats(supabase, user_id_for_profile, current_date_str)
                rolling_context = "\n" + _format_rolling_stats_for_prompt(stats_row)
    except Exception as rs_err:
        logging.warning(f"Rolling stats fetch failed (non-fatal): {rs_err}")

    past_30_summary = ""
    try:
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

    runner_profile_str = ""
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
{rolling_context}
{f'ユーザーの現状 (AIへの共有事項): {runner_profile_str}' if runner_profile_str else ''}"""

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
        raise Exception("GEMINI_API_KEY not set")
        
    client = genai.Client(api_key=api_key)
    
    # Retry logic for 429
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model if model else "gemini-2.0-flash",
                contents=user_content,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                ),
            )
            analysis_text = response.text
            break
        except Exception as e:
            if "exhausted" in str(e).lower() or "429" in str(e) or attempt < max_retries - 1:
                wait_sec = (attempt + 1) * 2
                logging.warning(f"Gemini API limit hit. Retrying in {wait_sec}s... ({e})")
                time_mod.sleep(wait_sec)
                continue
            raise Exception(f"Gemini API error after {max_retries} attempts: {e}")
        
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

import concurrent.futures

def _auto_generate_recent_reports(user_id: str, count: int = 2):
    """Automatically generate short and long reports for the last N activities in parallel."""
    try:
        supabase = get_supabase_client()
        # Fetch last N activities
        resp = supabase.table("activities").select("activityId,aiAnalysis,aiAnalysisShort").eq("user_id", user_id).order("startTimeLocal", desc=True).limit(count).execute()
        
        if not resp.data:
            return
            
        tasks = []
        for act in resp.data:
            act_id = str(act["activityId"])
            
            # 1. Long report if missing
            if not act.get("aiAnalysis"):
                tasks.append((act_id, "long"))
            
            # 2. Short report if missing
            if not act.get("aiAnalysisShort"):
                tasks.append((act_id, "short"))
        
        if not tasks:
            return

        logging.info(f"Auto-generating {len(tasks)} reports in parallel for user {user_id}...")
        
        # Parallelize Gemini calls
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            fut_to_task = {
                executor.submit(_generate_single_activity_analysis, t[0], report_type=t[1]): t 
                for t in tasks
            }
            for future in concurrent.futures.as_completed(fut_to_task):
                task = fut_to_task[future]
                try:
                    future.result()
                    logging.info(f"Finished auto-generation for {task[0]} ({task[1]})")
                except Exception as e:
                    logging.error(f"Failed to auto-generate {task[1]} for {task[0]}: {e}")
                    
    except Exception as e:
        logging.error(f"Error in _auto_generate_recent_reports: {e}")

@app.get("/api/activities/{activity_id}/analysis")
def get_activity_analysis(activity_id: str, regenerate: bool = False, model: str = "gemini-2.0-flash", report_type: str = "long"):
    try:
        res = _generate_single_activity_analysis(activity_id, report_type, model, regenerate)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@app.post("/api/trends/analysis")
def get_trends_analysis(req: TrendsAnalysisRequest):
    ALLOWED_MODELS = {"gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"}
    model = req.model if req.model in ALLOWED_MODELS else "gemini-2.0-flash"
    
    try:
        supabase = get_supabase_client()
        
        # 1. Fetch Runner Profile
        profile_resp = supabase.table("user_profiles").select("*").eq("user_id", req.user_id).execute()
        profile_data = profile_resp.data[0] if profile_resp.data else {}
        
        # 2. Fetch Rolling Stats
        rs_resp = supabase.table("activity_rolling_stats").select("*").eq("user_id", req.user_id).execute()
        rolling_context = ""
        if rs_resp.data:
            rolling_context = _format_rolling_stats_for_prompt(rs_resp.data[0])
        
        # 4. Read Long Term System Prompt
        base_dir = os.path.dirname(os.path.dirname(__file__))
        system_prompt_path = os.path.join(base_dir, "prompts", "long_term_prompt.txt")
        try:
            with open(system_prompt_path, "r", encoding="utf-8") as f:
                system_instruction = f.read().strip()
        except Exception:
            system_instruction = "You are a running coach analyzing long-term trends."
            
        # 5. Construct User Prompt
        user_content = _build_longterm_user_content(supabase, req, profile_data, rs_resp.data[0] if rs_resp.data else None)

        # 6. Call Gemini
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")
            
        client = genai.Client(api_key=api_key)
        
        # Retry logic for 429
        max_retries = 3
        analysis_text = ""
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=user_content,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                    ),
                )
                analysis_text = response.text
                break
            except Exception as e:
                if "exhausted" in str(e).lower() or "429" in str(e) or attempt < max_retries - 1:
                    wait_sec = (attempt + 1) * 2
                    logging.warning(f"Gemini API limit hit in Trends. Retrying in {wait_sec}s... ({e})")
                    time_mod.sleep(wait_sec)
                    continue
                raise HTTPException(status_code=500, detail=f"Gemini API error in Trends: {e}")
        
        # 7. Persist to User Profile
        try:
            supabase.table("user_profiles").update({
                "last_upcoming_menu": req.upcoming_menu,
                "last_longterm_analysis": analysis_text,
                "last_longterm_model": model
            }).eq("user_id", req.user_id).execute()
        except Exception as save_err:
            logging.warning(f"Failed to save long-term analysis to profile: {save_err}")
            
        return {"analysis": analysis_text, "model": model}
        
    except Exception as e:
        logging.error(f"Trends analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
@app.post("/api/trends/prompt")
def get_trends_prompt_preview(req: TrendsAnalysisRequest):
    try:
        supabase = get_supabase_client()
        # 1. Fetch Runner Profile
        profile_resp = supabase.table("user_profiles").select("*").eq("user_id", req.user_id).execute()
        profile_data = profile_resp.data[0] if profile_resp.data else {}
        # 2. Fetch Rolling Stats
        rs_resp = supabase.table("activity_rolling_stats").select("*").eq("user_id", req.user_id).execute()
        rolling_context = ""
        if rs_resp.data:
            rolling_context = _format_rolling_stats_for_prompt(rs_resp.data[0])
        # 4. Read Long Term System Prompt
        base_dir = os.path.dirname(os.path.dirname(__file__))
        system_prompt_path = os.path.join(base_dir, "prompts", "long_term_prompt.txt")
        try:
            with open(system_prompt_path, "r", encoding="utf-8") as f:
                system_instruction = f.read().strip()
        except Exception:
            system_instruction = "You are a running coach analyzing long-term trends."
        # 5. Construct User Prompt (Enriched for download)
        user_content = _build_longterm_user_content(supabase, req, profile_data, rs_resp.data[0] if rs_resp.data else None, enriched=True)
        full_prompt = f"# SYSTEM PROMPT\n{system_instruction}\n\n# USER PROMPT\n{user_content}"
        return {"prompt": full_prompt}
    except Exception as e:
        logging.error(f"Prompt preview error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/trends/menu")
def save_upcoming_menu(req: MenuRequest):
    try:
        supabase = get_supabase_client()
        supabase.table("user_profiles").update({
            "last_upcoming_menu": req.upcoming_menu
        }).eq("user_id", req.user_id).execute()
        return {"status": "success"}
    except Exception as e:
        logging.error(f"Menu save error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print("Starting Dashboard server at http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
