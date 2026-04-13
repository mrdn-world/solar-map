"""
Fetch monthly solar irradiance + temperature from NASA POWER API.
Data: CERES SYN1deg / MERRA-2, 20-year climatology (2001-2020)

Parameters:
  ALLSKY_SFC_SW_DWN  - Global Horizontal Irradiance (kWh/m2/day) per month
  T2M                - Air temperature at 2m (C) per month - for PV temp derating

Run: python scripts/fetch-solar-data-v2.py
Output: public/solar-data.json
"""

import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

STEP = 5
WORKERS = 4
OUT = Path(__file__).parent.parent / "public" / "solar-data.json"

MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]

lats = list(range(-80, 81, STEP))
lons = list(range(-180, 180, STEP))
coords = [(lat, lon) for lat in lats for lon in lons]
total = len(coords)

print("")
print("  NASA POWER Solar Data v2 (monthly + temperature)")
print("  -------------------------------------------------")
print("  Grid: %ddeg => %dx%d = %d points" % (STEP, len(lats), len(lons), total))
print("  Workers: %d" % WORKERS)
print("  Params: ALLSKY_SFC_SW_DWN, T2M (monthly + annual)")
print("")


def fetch_point(lat, lon):
    url = (
        "https://power.larc.nasa.gov/api/temporal/climatology/point?"
        "parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE"
        "&longitude=%s&latitude=%s&format=JSON&start=2001&end=2020"
        % (lon, lat)
    )
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "solar-map/2.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
                params = data.get("properties", {}).get("parameter", {})
                ghi = params.get("ALLSKY_SFC_SW_DWN", {})
                t2m = params.get("T2M", {})

                if not ghi.get("ANN") or ghi["ANN"] <= 0:
                    return (lat, lon, None)

                # Monthly GHI (kWh/m2/day) and temperature (C)
                monthly_ghi = [ghi.get(m, 0) for m in MONTHS]
                monthly_t2m = [t2m.get(m, 20) for m in MONTHS]
                ann_ghi = ghi.get("ANN", 0)
                ann_t2m = t2m.get("ANN", 20)

                return (lat, lon, {
                    "ghi": monthly_ghi,       # 12 monthly kWh/m2/day
                    "ghi_ann": round(ann_ghi, 2),
                    "temp": monthly_t2m,      # 12 monthly deg C
                    "temp_ann": round(ann_t2m, 1),
                })
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
            sys.stdout.write(
                "\r  %s %.1f%% (%d/%d) ETA: %dm%ds   "
                % (bar, pct, done, total, eta // 60, eta % 60)
            )
            sys.stdout.flush()

print("\n")

results.sort(key=lambda r: (r[0], r[1]))

valid = [r for r in results if r[2] is not None]

# Compute stats from annual GHI
ghi_vals = [r[2]["ghi_ann"] for r in valid]
ghi_min, ghi_max = min(ghi_vals), max(ghi_vals)
ghi_avg = round(sum(ghi_vals) / len(ghi_vals), 2)

# Build compact grid: [lat, lon, [12 monthly ghi], ghi_ann, [12 monthly temp], temp_ann]
grid = []
for lat, lon, data in results:
    if data is None:
        grid.append([lat, lon, None])
    else:
        grid.append([
            lat, lon,
            [round(v, 2) for v in data["ghi"]],
            data["ghi_ann"],
            [round(v, 1) for v in data["temp"]],
            data["temp_ann"],
        ])

output = {
    "step": STEP,
    "year": "2001-2020 climatology",
    "source": "NASA POWER (CERES SYN1deg / MERRA-2)",
    "months": MONTHS,
    "stats": {
        "ghi_min": ghi_min,
        "ghi_max": ghi_max,
        "ghi_avg": ghi_avg,
        "count": len(valid),
        "total": len(results),
    },
    "grid": grid,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(output))

elapsed = (time.time() - t0) / 60
print("  OK Done! %d/%d valid points" % (len(valid), len(results)))
print("  OK GHI range: %.1f-%.1f kWh/m2/day (avg: %.1f)" % (ghi_min, ghi_max, ghi_avg))
print("  OK Saved to %s" % OUT)
print("  OK Elapsed: %.1f minutes" % elapsed)
print("")
