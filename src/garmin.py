import os
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, date
from garminconnect import Garmin
from supabase import create_client, Client

def get_supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL", "").strip().strip('\ufeff')
    # Use service_role key on backend to bypass RLS; fall back to anon key if not set
    key = (os.environ.get("SUPABASE_SERVICE_KEY", "").strip().strip('\ufeff')
           or os.environ.get("SUPABASE_KEY", "").strip().strip('\ufeff'))
    if not url or not key:
        raise ValueError("Supabase credentials not found. Check SUPABASE_URL and SUPABASE_KEY in .env")
    return create_client(url, key)

import zipfile
import tempfile
from fitparse import FitFile

def parse_fit_to_supabase(zip_path: str, activity_id: str, supabase: Client, user_id: str = 'default_user'):
    """Extract FIT from ZIP and append its track points to Supabase."""
    try:
        with tempfile.TemporaryDirectory() as td:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(td)
            
            fit_file_path = None
            for fname in os.listdir(td):
                if fname.lower().endswith('.fit'):
                    fit_file_path = os.path.join(td, fname)
                    break
            
            if not fit_file_path:
                logging.warning(f"No FIT file found in ZIP for activity {activity_id}")
                return
            
            fitfile = FitFile(fit_file_path)
            points = []
            
            for record in fitfile.get_messages('record'):
                pt = {
                    'activityId': str(activity_id),
                    'user_id': user_id,
                }
                
                lat, lon, ele, hr, cad, pwr, tstamp = None, None, None, None, None, None, None
                stride, vert_osc, ground_contact = None, None, None
                
                for data in record:
                    if data.value is None: continue
                    if data.name == 'timestamp':
                        tstamp = data.value.isoformat()
                    elif data.name == 'position_lat':
                        lat = data.value * (180.0 / (2**31))
                    elif data.name == 'position_long':
                        lon = data.value * (180.0 / (2**31))
                    elif data.name == 'enhanced_altitude':
                        ele = data.value
                    elif data.name == 'heart_rate':
                        hr = data.value
                    elif data.name == 'cadence':
                        cad = data.value
                    elif data.name == 'power':
                        pwr = data.value
                    if getattr(data, 'def_num', None) == 90 or data.name == 'step_length':
                        stride = data.value
                    elif getattr(data, 'def_num', None) == 77 or data.name == 'vertical_oscillation':
                        vert_osc = data.value
                    elif getattr(data, 'def_num', None) == 39 or data.name == 'stance_time':
                        ground_contact = data.value
                
                if tstamp:
                    pt['time'] = tstamp
                    if lat is not None: pt['latitude'] = lat
                    if lon is not None: pt['longitude'] = lon
                    if ele is not None: pt['elevation'] = ele
                    if hr is not None: pt['heartRate'] = hr
                    if cad is not None: pt['cadence'] = cad
                    if pwr is not None: pt['power'] = pwr
                    if stride is not None: pt['stride_length'] = stride
                    if vert_osc is not None: pt['vertical_oscillation'] = vert_osc
                    if ground_contact is not None: pt['ground_contact_time'] = ground_contact
                    points.append(pt)
                    
            if not points:
                return
                
            # Downsample points for multi-user MVP (1/5th to save DB cost)
            points = points[::5]
                
            # Insert in batches to avoid payload size limits
            batch_size = 500
            for i in range(0, len(points), batch_size):
                batch = points[i:i + batch_size]
                try:
                    supabase.table("gpx_points").insert(batch).execute()
                except Exception as e:
                    logging.error(f"Failed to insert FIT batch for activity {activity_id}: {e}")
    except Exception as e:
        logging.warning(f"Failed to process FIT zip {zip_path}: {e}")

def fetch_garmin_data(
    email: str = None, 
    password: str = None, 
    user_id: str = None,
    session_tokens_dict: dict = None
) -> list:
    """Fetch Garmin activities, generate Supabase records and GPX detail points."""
    if not email:
        email = os.environ.get("GARMIN_EMAIL")
    if not password:
        password = os.environ.get("GARMIN_PASSWORD")
    
    if not user_id:
        user_id = email if email else 'default_user'
    
    logging.info("Initializing Garmin client...")
    client = Garmin(email, password)
    
    if session_tokens_dict:
        import tempfile, json, shutil
        temp_dir = tempfile.mkdtemp()
        try:
            if "oauth1_token" in session_tokens_dict:
                with open(os.path.join(temp_dir, "oauth1_token.json"), "w") as f:
                    json.dump(session_tokens_dict["oauth1_token"], f)
            if "oauth2_token" in session_tokens_dict:
                with open(os.path.join(temp_dir, "oauth2_token.json"), "w") as f:
                    json.dump(session_tokens_dict["oauth2_token"], f)
            client.garth.load(temp_dir)
            logging.info(f"Successfully loaded session tokens for {email}")
        except Exception as e:
            logging.error(f"Failed to load session tokens: {str(e)}")
            client.login() # Fallback to password login
        finally:
            shutil.rmtree(temp_dir)
    else:
        client.login()
    
    supabase = get_supabase_client()

    gpx_dir = "data/gpx"
    os.makedirs(gpx_dir, exist_ok=True)
    
    # Read existing records from Supabase (ID + title + notes) to detect updates
    existing_records = {}  # activityId -> {activityName, description}
    try:
        response = supabase.table("activities").select("activityId,activityName,description").eq("user_id", user_id).execute()
        for row in response.data:
            existing_records[str(row['activityId'])] = {
                'activityName': row.get('activityName', ''),
                'description': row.get('description', ''),
            }
    except Exception as e:
        logging.error(f"Failed to fetch existing activity records from Supabase: {e}")
    existing_ids = set(existing_records.keys())

    activities_all = []
    start = 0
    limit = 100
    seven_days_ago = (date.today() - timedelta(days=7)).isoformat()
    
    logging.info("Fetching activities from Garmin...")
    while True:
        logging.info(f"Fetching activities offset {start}...")
        batch = client.get_activities(start, limit)
        if not batch:
            break
            
        activities_all.extend(batch)
        
        # Check if we should stop fetching
        oldest_date = str(batch[-1].get('startTimeLocal', '9999-12-31'))[:10]
        new_in_batch = [a for a in batch if str(a.get('activityId')) not in existing_ids]
        
        # Stop if we are older than 7 days AND there are no new records in this batch
        if oldest_date < seven_days_ago and len(new_in_batch) == 0:
            logging.info("Reached historical data that is already saved. Stopping fetch.")
            break
            
        start += limit

    # Filter for running/trail running and exclude 'MyFitnessPal' activities
    running_activities = [
        a for a in activities_all 
        if a.get('activityType', {}).get('typeKey') in ['running', 'trail_running']
        and "MyFitnessPal" not in str(a.get('activityName', ''))
    ]
    
    keys_to_save = [
        "activityId", "activityName", "startTimeLocal", "distance", 
        "duration", "averageSpeed", "averageHR", "maxHR", "elevationGain",
        "description", "vO2MaxValue", "averageRunningCadenceInStepsPerMinute", 
        "avgStrideLength", "avgVerticalOscillation", "avgGroundContactTime", 
        "aerobicTrainingEffect", "anaerobicTrainingEffect"
    ]
    
    new_records = 0
    updated_records = 0
            
    for activity in running_activities:
        act_id = str(activity.get('activityId'))
        if act_id not in existing_ids:
            # --- 新規アクティビティ: insert + GPXダウンロード ---
            row_data = {}
            for k in keys_to_save:
                val = activity.get(k)
                if val is not None:
                    row_data[k] = val
                    
            try:
                row_data["user_id"] = user_id
                supabase.table("activities").insert(row_data).execute()
                existing_ids.add(act_id)
                new_records += 1
            except Exception as e:
                logging.error(f"Failed to insert activity {act_id} into Supabase: {e}")
                continue  # GPXはinsert成功時のみ
                
            # Download and parse FIT file (ORIGINAL -> zip)
            try:
                zip_data = client.download_activity(int(act_id), dl_fmt=client.ActivityDownloadFormat.ORIGINAL)
                zip_path = os.path.join(gpx_dir, f"{act_id}.zip")
                with open(zip_path, "wb") as zip_file:
                    zip_file.write(zip_data)
                parse_fit_to_supabase(zip_path, act_id, supabase, user_id)
            except Exception as e:
                logging.warning(f"Could not download or parse FIT for activity {act_id}: {e}")

        else:
            # --- 既存アクティビティ: タイトル・ノートの変更のみ反映 ---
            new_name = activity.get('activityName') or ''
            new_desc = activity.get('description') or ''
            old_name = existing_records[act_id].get('activityName') or ''
            old_desc = existing_records[act_id].get('description') or ''

            if new_name != old_name or new_desc != old_desc:
                update_data = {
                    'activityName': new_name,
                    'description': new_desc,
                }
                try:
                    supabase.table("activities").update(update_data).eq("activityId", act_id).execute()
                    updated_records += 1
                    logging.info(f"Updated title/notes for activity {act_id}")
                except Exception as e:
                    logging.error(f"Failed to update activity {act_id}: {e}")
                
    logging.info(f"Saved {new_records} new activities, updated {updated_records} existing activities to Supabase")
    
    # Return ONLY the last 7 days for Gemini to analyze
    recent_activities = [
        a for a in running_activities 
        if str(a.get('startTimeLocal', ''))[:10] >= seven_days_ago
    ]
    
    logging.info(f"Found {len(recent_activities)} recent running activities for the weekly report.")
    return recent_activities
