import os
import json
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

def parse_fit_to_supabase(zip_path: str, activity_id: str, supabase: Client, user_id: str = 'default_user',
                          running_start_time=None, running_end_time=None):
    """Extract FIT from ZIP and append its track points to Supabase.
    running_start_time / running_end_time: optional datetime objects to filter only the
    running segment from a multi_sport FIT file.
    """
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
                    # Skip points outside the running segment for multi_sport FITs
                    if running_start_time and running_end_time:
                        try:
                            ts_dt = datetime.fromisoformat(tstamp.replace('Z', '+00:00'))
                            if not (running_start_time <= ts_dt <= running_end_time):
                                continue
                        except Exception:
                            pass
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

    # Also extract running child activities from multi_sport activities
    multi_sport_activities = [
        a for a in activities_all
        if a.get('activityType', {}).get('typeKey') == 'multi_sport'
        and a.get('parent') is True
    ]
    for ms_act in multi_sport_activities:
        ms_id = ms_act.get('activityId')
        try:
            detail = json.loads(client.garth.download(f'/activity-service/activity/{ms_id}').decode('utf-8'))
            child_ids = detail.get('metadataDTO', {}).get('childIds') or []
            for child_id in child_ids:
                try:
                    child_detail = json.loads(client.garth.download(f'/activity-service/activity/{child_id}').decode('utf-8'))
                    child_type = (child_detail.get('activityTypeDTO') or {}).get('typeKey', '')
                    if child_type in ['running', 'trail_running']:
                        # Build a flat activity dict compatible with keys_to_save
                        s = child_detail.get('summaryDTO', {})
                        child_flat = {
                            'activityId': child_id,
                            'activityName': child_detail.get('activityName', ms_act.get('activityName', '')),
                            'startTimeLocal': s.get('startTimeLocal', '').replace('T', ' ').split('.')[0],
                            'distance': s.get('distance'),
                            'duration': s.get('duration'),
                            'averageSpeed': s.get('averageSpeed'),
                            'averageHR': s.get('averageHR'),
                            'maxHR': s.get('maxHR'),
                            'elevationGain': s.get('elevationGain'),
                            'vO2MaxValue': s.get('vO2MaxValue'),
                            'aerobicTrainingEffect': s.get('aerobicTrainingEffect'),
                            'anaerobicTrainingEffect': s.get('anaerobicTrainingEffect'),
                            'averageRunningCadenceInStepsPerMinute': s.get('averageRunningCadenceInStepsPerMinute'),
                            'avgStrideLength': s.get('avgStrideLength'),
                            'avgVerticalOscillation': s.get('avgVerticalOscillation'),
                            'avgGroundContactTime': s.get('avgGroundContactTime'),
                            '_is_multisport_child': True,
                            '_parent_id': ms_id,
                        }
                        running_activities.append(child_flat)
                        logging.info(f"Added multi_sport child running activity {child_id} from parent {ms_id}")
                except Exception as e:
                    logging.warning(f"Could not fetch multi_sport child {child_id}: {e}")
        except Exception as e:
            logging.warning(f"Could not fetch multi_sport details for {ms_id}: {e}")
    
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
            # multi_sport child activities: download parent FIT which contains all segments
            try:
                fit_download_id = activity.get('_parent_id') or int(act_id)
                zip_data = client.download_activity(int(fit_download_id), dl_fmt=client.ActivityDownloadFormat.ORIGINAL)
                zip_path = os.path.join(gpx_dir, f"{fit_download_id}.zip")
                with open(zip_path, "wb") as zip_file:
                    zip_file.write(zip_data)
                
                # For multi_sport children, filter FIT points to running segment only
                run_start = None
                run_end = None
                if activity.get('_is_multisport_child'):
                    try:
                        from datetime import timezone
                        start_str = activity.get('startTimeLocal', '')
                        dur_s = float(activity.get('duration') or 0)
                        if start_str:
                            # startTimeLocal is in local time - add UTC offset assumed as +0 for FIT timestamps
                            run_start = datetime.fromisoformat(start_str).replace(tzinfo=timezone.utc)
                            run_end = run_start + timedelta(seconds=dur_s + 5)  # +5s margin
                    except Exception as te:
                        logging.warning(f"Could not parse time range for multi_sport child {act_id}: {te}")
                
                parse_fit_to_supabase(zip_path, act_id, supabase, user_id,
                                      running_start_time=run_start, running_end_time=run_end)
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
