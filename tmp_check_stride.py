import os, zipfile, shutil
from fitparse import FitFile

td = r"C:\Users\Lenovo\AppData\Local\Temp\fit_check_tmp3"
os.makedirs(td, exist_ok=True)

zip_path = 'multi.zip'
with zipfile.ZipFile(zip_path, 'r') as zr:
    zr.extractall(td)

fit_files = [f for f in os.listdir(td) if f.endswith('.fit')]
fit_path = os.path.join(td, fit_files[0])

fitfile = FitFile(fit_path)

# Deeper analysis: find records during running phase and check unknown fields
running_records = []
for rec in fitfile.get_messages('record'):
    vals = {}
    for d in rec:
        vals[d.name] = (d.value, getattr(d, 'def_num', None), getattr(d, 'units', None))
    ts = vals.get('timestamp', (None,))[0]
    spd = vals.get('enhanced_speed', (0,))[0] or 0
    cad = vals.get('cadence', (0,))[0] or 0
    # During running, speed > 1.5 m/s (about 5:30/km pace), cadence > 50
    if spd > 1.5 and cad > 50:
        running_records.append(vals)

print(f"Found {len(running_records)} running records")
if running_records:
    # Print first record, focus on unknowns that have values
    r = running_records[0]
    print("Key fields in a running record:")
    for k, (v, dn, u) in r.items():
        if v is not None and v != 0:
            print(f"  {k} (def_num={dn}): {v} {u}")

shutil.rmtree(td, ignore_errors=True)
