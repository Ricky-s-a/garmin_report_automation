import os
import csv
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, date
from garminconnect import Garmin

def parse_gpx_to_csv(gpx_path: str, activity_id: str, csv_path: str):
    """Parse a downloaded GPX file and append its track points to a CSV."""
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
    
    # Traverse GPX structure: trk -> trkseg -> trkpt
    for trk in root.findall('default:trk', ns):
        for trkseg in trk.findall('default:trkseg', ns):
            for trkpt in trkseg.findall('default:trkpt', ns):
                lat = trkpt.get('lat', '')
                lon = trkpt.get('lon', '')
                
                ele_node = trkpt.find('default:ele', ns)
                ele = ele_node.text if ele_node is not None else ''
                
                time_node = trkpt.find('default:time', ns)
                time_str = time_node.text if time_node is not None else ''
                
                hr = ''
                cad = ''
                
                # Garmin extensions hold HR and Cadence
                extensions = trkpt.find('default:extensions', ns)
                if extensions is not None:
                    tpe = extensions.find('gpxtpx:TrackPointExtension', ns)
                    if tpe is not None:
                        hr_node = tpe.find('gpxtpx:hr', ns)
                        if hr_node is not None:
                            hr = hr_node.text
                        cad_node = tpe.find('gpxtpx:cad', ns)
                        if cad_node is not None:
                            cad = cad_node.text
                            
                points.append({
                    'activityId': activity_id,
                    'time': time_str,
                    'latitude': lat,
                    'longitude': lon,
                    'elevation': ele,
                    'heartRate': hr,
                    'cadence': cad
                })
                
    if not points:
        return
        
    file_exists = os.path.exists(csv_path) and os.path.getsize(csv_path) > 0
    fieldnames = ['activityId', 'time', 'latitude', 'longitude', 'elevation', 'heartRate', 'cadence']
    
    with open(csv_path, 'a', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerows(points)

def fetch_garmin_data() -> list:
    """Fetch Garmin activities, generate CSV records and GPX detail points."""
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    
    logging.info("Initializing Garmin client...")
    client = Garmin(email, password)
    client.login()

    raw_dir = "data/raw"
    os.makedirs(raw_dir, exist_ok=True)
    csv_file = os.path.join(raw_dir, "all_activities.csv")
    gpx_csv_file = os.path.join(raw_dir, "all_gpx_points.csv")
    gpx_dir = "data/gpx"
    os.makedirs(gpx_dir, exist_ok=True)
    
    # Read existing IDs to avoid duplicates
    existing_ids = set()
    file_exists = os.path.exists(csv_file) and os.path.getsize(csv_file) > 0
    if file_exists:
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            header = next(reader, None)
            if header:
                for row in reader:
                    if row:
                        existing_ids.add(str(row[0])) # activityId is the first column

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
    
    # Define comprehensive columns to extract for detailed performance analysis
    fieldnames = [
        "activityId", "activityName", "startTimeLocal", "startTimeGMT", "distance", 
        "duration", "elapsedDuration", "movingDuration", "elevationGain", "elevationLoss", 
        "averageSpeed", "maxSpeed", "avgGradeAdjustedSpeed", "calories", "bmrCalories", 
        "averageHR", "maxHR", "averageRunningCadenceInStepsPerMinute", "maxRunningCadenceInStepsPerMinute", 
        "steps", "avgStrideLength", "vO2MaxValue", "avgPower", "maxPower", "normPower",
        "aerobicTrainingEffect", "anaerobicTrainingEffect", "trainingEffectLabel",
        "activityTrainingLoad", "aerobicTrainingEffectMessage", "anaerobicTrainingEffectMessage",
        "minTemperature", "maxTemperature", "minElevation", "maxElevation", "avgElevation",
        "maxVerticalSpeed", "waterEstimated", "lapCount", "moderateIntensityMinutes", "vigorousIntensityMinutes",
        "fastestSplit_1000", "fastestSplit_1609", "fastestSplit_5000",
        "hrTimeInZone_1", "hrTimeInZone_2", "hrTimeInZone_3", "hrTimeInZone_4", "hrTimeInZone_5",
        "powerTimeInZone_1", "powerTimeInZone_2", "powerTimeInZone_3", "powerTimeInZone_4", "powerTimeInZone_5",
        "startLatitude", "startLongitude", "endLatitude", "endLongitude", "locationName", "manufacturer", "description",
        "avgVerticalOscillation", "avgVerticalRatio", "avgGroundContactTime", "avgGroundContactBalance"
    ]
    
    new_records = 0
    with open(csv_file, 'a', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        if not file_exists:
            writer.writeheader()
            
        for activity in running_activities:
            act_id = str(activity.get('activityId'))
            if act_id not in existing_ids:
                writer.writerow(activity)
                existing_ids.add(act_id)
                new_records += 1
                
                # Download and parse GPX file
                try:
                    gpx_data = client.download_activity(int(act_id), dl_fmt=client.ActivityDownloadFormat.GPX)
                    gpx_path = os.path.join(gpx_dir, f"{act_id}.gpx")
                    with open(gpx_path, "wb") as gpx_file:
                        gpx_file.write(gpx_data)
                    
                    # Convert GPX to CSV rows
                    parse_gpx_to_csv(gpx_path, act_id, gpx_csv_file)
                except Exception as e:
                    logging.warning(f"Could not download or parse GPX for activity {act_id}: {e}")
                
    logging.info(f"Saved {new_records} new activities to {csv_file}")
    
    # Return ONLY the last 7 days for Gemini to analyze
    recent_activities = [
        a for a in running_activities 
        if str(a.get('startTimeLocal', ''))[:10] >= seven_days_ago
    ]
    
    logging.info(f"Found {len(recent_activities)} recent running activities for the weekly report.")
    return recent_activities
