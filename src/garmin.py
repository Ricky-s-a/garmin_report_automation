import os
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, date
from garminconnect import Garmin
from supabase import create_client, Client

def get_supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise ValueError("Supabase credentials not found. Check SUPABASE_URL and SUPABASE_KEY in .env")
    return create_client(url, key)

def parse_gpx_to_supabase(gpx_path: str, activity_id: str, supabase: Client):
    """Parse a downloaded GPX file and append its track points to Supabase."""
    ns = {
        'default': 'http://www.topografix.com/GPX/1/1',
        'gpxtpx': 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1'
    }
    
    try:
        tree = ET.parse(gpx_path)
        root = tree.getroot()
    except Exception as e:
        logging.warning(f"Failed to parse XML for GPX {gpx_path}: {e}")
        return
    
    points = []
    
    for trk in root.findall('default:trk', ns):
        for trkseg in trk.findall('default:trkseg', ns):
            for trkpt in trkseg.findall('default:trkpt', ns):
                lat_str = trkpt.get('lat', '')
                lon_str = trkpt.get('lon', '')
                
                ele_node = trkpt.find('default:ele', ns)
                ele_str = ele_node.text if ele_node is not None else ''
                
                time_node = trkpt.find('default:time', ns)
                time_str = time_node.text if time_node is not None else ''
                
                hr_str = ''
                cad_str = ''
                
                extensions = trkpt.find('default:extensions', ns)
                if extensions is not None:
                    tpe = extensions.find('gpxtpx:TrackPointExtension', ns)
                    if tpe is not None:
                        hr_node = tpe.find('gpxtpx:hr', ns)
                        if hr_node is not None:
                            hr_str = hr_node.text
                        cad_node = tpe.find('gpxtpx:cad', ns)
                        if cad_node is not None:
                            cad_str = cad_node.text
                
                pt = {
                    'activityId': str(activity_id),
                    'time': time_str,
                }
                if lat_str: pt['latitude'] = float(lat_str)
                if lon_str: pt['longitude'] = float(lon_str)
                if ele_str: pt['elevation'] = float(ele_str)
                if hr_str: pt['heartRate'] = float(hr_str)
                if cad_str: pt['cadence'] = float(cad_str)
                            
                points.append(pt)
                
    if not points:
        return
        
    # Insert in batches to avoid payload size limits
    batch_size = 500
    for i in range(0, len(points), batch_size):
        batch = points[i:i + batch_size]
        try:
            supabase.table("gpx_points").insert(batch).execute()
        except Exception as e:
            logging.error(f"Failed to insert GPX batch for activity {activity_id}: {e}")

def fetch_garmin_data() -> list:
    """Fetch Garmin activities, generate Supabase records and GPX detail points."""
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    
    logging.info("Initializing Garmin client...")
    client = Garmin(email, password)
    client.login()
    
    supabase = get_supabase_client()

    gpx_dir = "data/gpx"
    os.makedirs(gpx_dir, exist_ok=True)
    
    # Read existing IDs from Supabase to avoid duplicates
    existing_ids = set()
    try:
        response = supabase.table("activities").select("activityId").execute()
        existing_ids = {str(row['activityId']) for row in response.data}
    except Exception as e:
        logging.error(f"Failed to fetch existing activity IDs from Supabase: {e}")

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
        "duration", "averageSpeed", "averageHR", "maxHR", "elevationGain"
    ]
    
    new_records = 0
            
    for activity in running_activities:
        act_id = str(activity.get('activityId'))
        if act_id not in existing_ids:
            # Build dict with only keys that are in the table
            row_data = {}
            for k in keys_to_save:
                val = activity.get(k)
                if val is not None:
                    row_data[k] = val
                    
            try:
                supabase.table("activities").insert(row_data).execute()
                existing_ids.add(act_id)
                new_records += 1
            except Exception as e:
                logging.error(f"Failed to insert activity {act_id} into Supabase: {e}")
                continue # Skip GPX if activity insert failed
                
            # Download and parse GPX file
            try:
                gpx_data = client.download_activity(int(act_id), dl_fmt=client.ActivityDownloadFormat.GPX)
                gpx_path = os.path.join(gpx_dir, f"{act_id}.gpx")
                with open(gpx_path, "wb") as gpx_file:
                    gpx_file.write(gpx_data)
                
                # Insert GPX to Supabase
                parse_gpx_to_supabase(gpx_path, act_id, supabase)
            except Exception as e:
                logging.warning(f"Could not download or parse GPX for activity {act_id}: {e}")
                
    logging.info(f"Saved {new_records} new activities to Supabase")
    
    # Return ONLY the last 7 days for Gemini to analyze
    recent_activities = [
        a for a in running_activities 
        if str(a.get('startTimeLocal', ''))[:10] >= seven_days_ago
    ]
    
    logging.info(f"Found {len(recent_activities)} recent running activities for the weekly report.")
    return recent_activities
