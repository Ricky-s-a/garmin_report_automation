import os
import logging
import requests
import json
import pandas as pd
from datetime import datetime, timedelta, timezone
from supabase import Client
from src.garmin import get_supabase_client

# Strava API Endpoints
STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_API_BASE = "https://api.strava.com/api/v3"

def get_strava_config():
    client_id = os.environ.get("STRAVA_CLIENT_ID")
    client_secret = os.environ.get("STRAVA_CLIENT_SECRET")
    redirect_uri = os.environ.get("STRAVA_REDIRECT_URI", "http://localhost:8080/")
    return client_id, client_secret, redirect_uri

def get_auth_url():
    client_id, _, redirect_uri = get_strava_config()
    if not client_id or client_id == "YOUR_STRAVA_CLIENT_ID":
        raise ValueError("STRAVA_CLIENT_ID is missing or not configured correctly in environment variables.")
    
    # Scope: read_all, activity:read_all (to get private activities and streams)
    scope = "read,activity:read_all"
    return f"{STRAVA_AUTH_URL}?client_id={client_id}&redirect_uri={redirect_uri}&response_type=code&scope={scope}"

def exchange_token(code: str):
    client_id, client_secret, _ = get_strava_config()
    payload = {
        'client_id': client_id,
        'client_secret': client_secret,
        'code': code,
        'grant_type': 'authorization_code'
    }
    r = requests.post(STRAVA_TOKEN_URL, data=payload)
    r.raise_for_status()
    return r.json()

def refresh_token(refresh_token_str: str):
    client_id, client_secret, _ = get_strava_config()
    payload = {
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token_str,
        'grant_type': 'refresh_token'
    }
    r = requests.post(STRAVA_TOKEN_URL, data=payload)
    r.raise_for_status()
    return r.json()

def get_valid_access_token(supabase: Client, user_id: str):
    profile = supabase.table("user_profiles").select("strava_access_token, strava_refresh_token, strava_token_expires_at").eq("user_id", user_id).execute()
    if not profile.data:
        return None
    
    p = profile.data[0]
    access_token = p.get("strava_access_token")
    refresh_tok = p.get("strava_refresh_token")
    expires_at = p.get("strava_token_expires_at") # unix timestamp

    if not access_token or not refresh_tok:
        return None

    # Check expiration (with 5 min margin)
    now = datetime.now(timezone.utc).timestamp()
    if expires_at and now + 300 > expires_at:
        logging.info("Strava access token expired. Refreshing...")
        try:
            new_tokens = refresh_token(refresh_tok)
            access_token = new_tokens['access_token']
            refresh_tok = new_tokens['refresh_token']
            expires_at = new_tokens['expires_at']
            
            # Update DB
            supabase.table("user_profiles").update({
                "strava_access_token": access_token,
                "strava_refresh_token": refresh_tok,
                "strava_token_expires_at": expires_at
            }).eq("user_id", user_id).execute()
        except Exception as e:
            logging.error(f"Failed to refresh Strava token: {e}")
            return None
            
    return access_token

def fetch_strava_activities(access_token: str, days: int = 30):
    after = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp())
    r = requests.get(f"{STRAVA_API_BASE}/athlete/activities", 
                     headers={"Authorization": f"Bearer {access_token}"},
                     params={"after": after, "per_page": 100})
    r.raise_for_status()
    return r.json()

def fetch_strava_streams(activity_id: int, access_token: str):
    keys = "time,latlng,altitude,heartrate,cadence,distance,grade_smooth"
    r = requests.get(f"{STRAVA_API_BASE}/activities/{activity_id}/streams",
                     headers={"Authorization": f"Bearer {access_token}"},
                     params={"keys": keys, "key_by_type": True})
    r.raise_for_status()
    return r.json()

def fetch_strava_data_with_dedup(user_id: str):
    """
    Fetch Strava activities and save those that don't overlap with existing records.
    Deduplication: +/- 2 minutes of startTimeLocal.
    """
    supabase = get_supabase_client()
    access_token = get_valid_access_token(supabase, user_id)
    if not access_token:
        logging.info(f"Strava not connected for user {user_id}")
        return []

    # 1. Get existing activity start times from DB to deduplicate
    existing_q = supabase.table("activities").select("startTimeLocal").eq("user_id", user_id).execute()
    existing_starts = []
    for row in existing_q.data:
        try:
            # Garmin uses 'YYYY-MM-DD HH:MM:SS' format usually
            st = datetime.fromisoformat(row['startTimeLocal'].replace(" ", "T"))
            existing_starts.append(st)
        except:
            pass

    # 2. Fetch Strava activities
    logging.info("Fetching activities from Strava...")
    strava_acts = fetch_strava_activities(access_token, days=14)
    
    new_count = 0
    for s_act in strava_acts:
        # Strava only supports runs/trail runs for this dashboard
        if s_act.get('type') not in ['Run', 'TrailRun']:
            continue
            
        s_id = s_act.get('id')
        s_start_str = s_act.get('start_date_local') # "2023-01-01T12:00:00Z"
        s_start = datetime.fromisoformat(s_start_str.replace("Z", ""))
        
        # Deduplication check: +/- 2 minutes
        is_duplicate = False
        for e_start in existing_starts:
            if abs((s_start - e_start).total_seconds()) < 120:
                is_duplicate = True
                break
        
        if is_duplicate:
            logging.info(f"Skipping Strava activity {s_id} (Duplicate of existing activity)")
            continue

        # 3. Save Strava summary to activities table
        # Map Strava fields to our DB schema
        # activityId in our DB is string. We'll prefix with 'strava_' if needed or just use numeric.
        db_id = f"strava_{s_id}"
        
        activity_data = {
            "activityId": db_id,
            "user_id": user_id,
            "activityName": s_act.get("name"),
            "startTimeLocal": s_start.strftime("%Y-%m-%d %H:%M:%S"),
            "distance": s_act.get("distance"),
            "duration": s_act.get("moving_time"),
            "averageSpeed": s_act.get("average_speed"),
            "averageHR": s_act.get("average_heartrate"),
            "maxHR": s_act.get("max_heartrate"),
            "elevationGain": s_act.get("total_elevation_gain"),
            "description": s_act.get("description", ""),
            "averageRunningCadenceInStepsPerMinute": s_act.get("average_cadence") * 2 if s_act.get("average_cadence") else None,
            "source": "strava"
        }
        
        try:
            supabase.table("activities").insert(activity_data).execute()
            new_count += 1
            logging.info(f"Saved Strava activity {db_id}")
            
            # 4. Fetch streams and save to gpx_points
            try:
                streams = fetch_strava_streams(s_id, access_token)
                points = []
                
                # Zip all available streams
                time_stream = streams.get('time', {}).get('data', [])
                latlng_stream = streams.get('latlng', {}).get('data', [])
                alt_stream = streams.get('altitude', {}).get('data', [])
                hr_stream = streams.get('heartrate', {}).get('data', [])
                cad_stream = streams.get('cadence', {}).get('data', [])
                
                for i in range(len(time_stream)):
                    pt = {
                        "activityId": db_id,
                        "user_id": user_id,
                        "time": (s_start + timedelta(seconds=time_stream[i])).isoformat(),
                        "source": "strava"
                    }
                    if i < len(latlng_stream):
                        pt["latitude"] = latlng_stream[i][0]
                        pt["longitude"] = latlng_stream[i][1]
                    if i < len(alt_stream):
                        pt["elevation"] = alt_stream[i]
                    if i < len(hr_stream):
                        pt["heartRate"] = hr_stream[i]
                    if i < len(cad_stream):
                        pt["cadence"] = cad_stream[i] * 2 # Strava cadence is usually one foot
                        
                    points.append(pt)
                
                # Downsample (1/5th) and Batch Insert
                points = points[::5]
                batch_size = 500
                for j in range(0, len(points), batch_size):
                    supabase.table("gpx_points").insert(points[j:j+batch_size]).execute()
                
                logging.info(f"Saved {len(points)} points for Strava activity {db_id}")
            except Exception as e:
                logging.error(f"Failed to fetch/save streams for Strava activity {s_id}: {e}")
                
        except Exception as e:
            logging.error(f"Failed to insert Strava activity {db_id} summary: {e}")

    return {"new_activities": new_count}
