"""
train_idle_model.py
───────────────────
Train an Isolation‑Forest (or any other) idle model
for a SINGLE motorcycle and save it to:

    models/<brand>/idle_<motorcycle_id>.pkl

Example:
    python train_idle_model.py --motorcycle_id 4 --brand "Yamaha_NMAX" --minutes 43200
"""

import argparse
import os
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from influxdb_client import InfluxDBClient

# ────────────────────────────────────────────────────────────
# 1) CLI arguments
# ────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="Train idle anomaly model")
parser.add_argument("--motorcycle_id", required=True, help="e.g. 4 or moto_004")
parser.add_argument("--brand", required=True, help="e.g. Yamaha_NMAX")
parser.add_argument("--minutes", type=int, default=60 * 24,
                    help="How far back to pull data (default 1 day)")
args = parser.parse_args()

MOTO_ID = str(args.motorcycle_id)
BRAND = args.brand.strip().replace(" ", "_").lower()
MODE = "idle"
MINUTES = args.minutes

# ────────────────────────────────────────────────────────────
# 2) InfluxDB connection
# ────────────────────────────────────────────────────────────
INFLUXDB_URL = os.getenv("INFLUX_URL")
INFLUXDB_TOKEN = os.getenv("INFLUX_TOKEN")
INFLUXDB_ORG = os.getenv("INFLUX_ORG")

client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
query_api = client.query_api()

# ────────────────────────────────────────────────────────────
# 3) Pull & clean idle data (SQL version)
# ────────────────────────────────────────────────────────────
FEATURES = [
    "rpm",
    "engine_load",
    "throttle_pos",
    "long_fuel_trim_1",
    "coolant_temp",
    "elm_voltage",
]

selected_fields = ", ".join(FEATURES)
query = f"""
SELECT
  time,
  {selected_fields}
FROM obd_data
WHERE time >= now() - interval '{MINUTES} minutes'
  AND motorcycle_id = '{MOTO_ID}'
  AND (
    rpm IS NOT NULL OR engine_load IS NOT NULL OR throttle_pos IS NOT NULL OR
    long_fuel_trim_1 IS NOT NULL OR coolant_temp IS NOT NULL OR elm_voltage IS NOT NULL
  )
ORDER BY time ASC
"""

tables = query_api.query_data_frame(query)
client.close()

df = tables if isinstance(tables, pd.DataFrame) else pd.concat(tables, ignore_index=True)

if df.empty or len(df) < 60:
    raise RuntimeError("Not enough idle data to train a model!")

df = df.dropna().sort_values("time").reset_index(drop=True)

# ✅ Filter by coolant temperature
df = df[(df["coolant_temp"] >= 70) & (df["coolant_temp"] <= 105)]
print(f"Filtered to {len(df)} rows where coolant_temp is between 70–105°C")

if df.empty or len(df) < 60:
    raise RuntimeError("Not enough filtered warm-idle data to train the model!")

X_raw = df[FEATURES].values

# ────────────────────────────────────────────────────────────
# 4) Scale → Extract 24-feature vector → Train Isolation Forest
# ────────────────────────────────────────────────────────────
scaler = StandardScaler().fit(X_raw)
X_scaled = scaler.transform(X_raw)

agg_features = np.hstack([
    np.mean(X_scaled, axis=0),
    np.std(X_scaled, axis=0),
    np.max(X_scaled, axis=0),
    np.min(X_scaled, axis=0)
]).reshape(1, -1)  # Shape: (1, 24)

model = IsolationForest(
    n_estimators=200,
    contamination=0.05,
    random_state=42
).fit(agg_features)

# ────────────────────────────────────────────────────────────
# 5) Save model & scaler → models/<brand>/idle_<motorcycle_id>.pkl
# ────────────────────────────────────────────────────────────
out_dir = os.path.join("models", BRAND)
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, f"{MODE}_{MOTO_ID}.pkl")

joblib.dump({"model": model, "scaler": scaler}, out_path, compress=3)

print(f"✅ Trained on {len(df):,} rows for motorcycle {MOTO_ID}")
print(f"📦 Saved model to: {out_path}")
