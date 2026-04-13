"""
Fetch global solar irradiance from NASA POWER API using parallel requests.
Data: CERES SYN1deg / MERRA-2, 20-year climatology (2001-2020)

Run: python scripts/fetch-solar-data.py
Output: public/solar-data.json
"""

import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

STEP = 5  # degrees
WORKERS = 8  # parallel requests
OUT = Path(__file__).parent.parent / "public" / "solar-data.json"

# Build grid
lats = list(range(-80, 81, STEP))
lons = list(range(-180, 180, STEP))
coords = [(lat, lon) for lat in lats for lon in lons]
total = len(coords)

print(f"\n  NASA POWER Solar Data (parallel)")
print(f"  --------------------------------")
print(f"  Grid: {STEP}deg => {len(lats)}x{len(lons)} = {total} points")
print(f"  Workers: {WORKERS}")
print(f"  Source: CERES/MERRA-2 climatology (2001-2020)\n")


def fetch_point(lat, lon):
    url = (
        f"https://power.larc.nasa.gov/api/temporal/climatology/point?"
        f"parameters=ALLSKY_SFC_SW_DWN&community=RE"
        f"&longitude={lon}&latitude={lat}&format=JSON&start=2001&end=2020"
    )
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "solar-map/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                ann = data.get("properties", {}).get("parameter", {}).get("ALLSKY_SFC_SW_DWN", {}).get("ANN")
                if ann and ann > 0:
                    # kWh/m²/day => approximate sunshine hours/year
                    return (lat, lon, round(ann * 365 * 0.75))
                return (lat, lon, None)
        except Exception:
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
    return (lat, lon, None)


t0 = time.time()
results = []
done = 0

with ThreadPoolExecutor(max_workers=WORKERS) as pool:
    futures = {pool.submit(fetch_point, lat, lon): (lat, lon) for lat, lon in coords}

    for future in as_completed(futures):
        result = future.result()
        results.append(result)
        done += 1

        if done % 50 == 0 or done == total:
            pct = done / total * 100
            elapsed = time.time() - t0
            rate = done / elapsed if elapsed > 0 else 0
            eta = int((total - done) / rate) if rate > 0 else 0
            bar = "#" * int(pct / 100 * 40) + "." * (40 - int(pct / 100 * 40))
            sys.stdout.write(f"\r  {bar} {pct:.1f}% ({done}/{total}) ETA: {eta//60}m{eta%60}s   ")
            sys.stdout.flush()

print("\n")

# Sort by lat, lon for consistency
results.sort(key=lambda r: (r[0], r[1]))

valid = [r for r in results if r[2] is not None]
hours = [r[2] for r in valid]
mn, mx, avg = min(hours), max(hours), round(sum(hours) / len(hours))

output = {
    "step": STEP,
    "year": "2001-2020 climatology",
    "source": "NASA POWER (CERES SYN1deg / MERRA-2)",
    "stats": {"min": mn, "max": mx, "avg": avg, "count": len(valid), "total": len(results)},
    "grid": [[r[0], r[1], r[2]] for r in results],
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(output))

elapsed = (time.time() - t0) / 60
print(f"  OK Done! {len(valid)}/{len(results)} valid points")
print(f"  OK Range: {mn}-{mx} hours/year (avg: {avg})")
print(f"  OK Saved to {OUT}")
print(f"  OK Elapsed: {elapsed:.1f} minutes\n")
