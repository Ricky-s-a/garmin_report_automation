import os
import zipfile
import tempfile
from garminconnect import Garmin
from fitparse import FitFile

# Login
email = os.environ.get("GARMIN_EMAIL", "rikitamago315@gmail.com")
pwd = os.environ.get("GARMIN_PASSWORD", "Musashi118")
client = Garmin(email, pwd)
client.login()

# get last 10 activities
acts = client.get_activities(0, 10)
act_id = None
for a in acts:
    if "ラン" in a['activityName'] or "Run" in a['activityName']:
        act_id = a['activityId']
        print(f"Checking run: {act_id} {a['activityName']}")
        break

if not act_id:
    print("No run found.")
    exit(0)

# Download as ORIGINAL (ZIP)
zip_data = client.download_activity(act_id, dl_fmt=client.ActivityDownloadFormat.ORIGINAL)

with tempfile.TemporaryDirectory() as td:
    zip_path = os.path.join(td, "act.zip")
    with open(zip_path, "wb") as f:
        f.write(zip_data)
        
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(td)
        
    for fname in os.listdir(td):
        if fname.endswith(".fit"):
            fit_path = os.path.join(td, fname)
            print(f"Found fit file: {fname}")
            
            fitfile = FitFile(fit_path)
            
            fitfile = FitFile(fit_path)
            
            mapping = {}
            for record in fitfile.get_messages('record'):
                for data in record:
                    mapping[data.def_num] = data.name
                            
            import pprint
            pprint.pprint(mapping)
            del fitfile
            break
