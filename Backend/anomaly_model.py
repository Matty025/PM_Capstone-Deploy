import os
import joblib
import numpy as np
import pandas as pd
from functools import lru_cache
from influxdb_client import InfluxDBClient
import json

# ───────────────────────── Load Normal Range JSON ─────────────────────────
with open(os.path.join(os.path.dirname(__file__), "normal_ranges.json")) as f:
    NORMAL_RANGES = json.load(f)

def normalize(text):
    return str(text).strip().lower().replace(" ", "_")

def classify_value(feature, value, brand, model):
    try:
        brand = normalize(brand)
        model = normalize(model)
        ranges = NORMAL_RANGES[brand][model][feature]

        if value <= ranges["critical_min"] or value >= ranges["critical_max"]:
            return "critical"
        elif value <= ranges["warning_min"] or value >= ranges["warning_max"]:
            return "warning"
        else:
            return "normal"
    except Exception as e:
        print(f"[classify_value] ⚠️ Missing reference or error for {brand} → {model} → {feature} → {e}")
        return "unknown"

def compute_severity_score(feature, value, brand, model):
    try:
        brand = normalize(brand)
        model = normalize(model)
        ranges = NORMAL_RANGES[brand][model][feature]

        normal_min = ranges["warning_min"]
        normal_max = ranges["warning_max"]
        critical_min = ranges["critical_min"]
        critical_max = ranges["critical_max"]

        if normal_min <= value <= normal_max:
            return 0

        if value < normal_min:
            score = (normal_min - value) / (normal_min - critical_min)
        elif value > normal_max:
            score = (value - normal_max) / (critical_max - normal_max)
        else:
            score = 0

        return int(min(max(score * 100, 0), 100))

    except Exception as e:
        print(f"[severity_score] ⚠️ Cannot compute severity score for {feature}: {e}")
        return -1

# ───────────────────────── InfluxDB Config ─────────────────────────
# InfluxDB settings - update these with your real values
INFLUXDB_URL = os.getenv("INFLUX_URL")
INFLUXDB_TOKEN = os.getenv("INFLUX_TOKEN")
INFLUXDB_ORG = os.getenv("INFLUX_ORG")
INFLUXDB_BUCKET = os.getenv("INFLUX_BUCKET")

MODEL_BASE_DIR = "models"

FEATURES = [
    "rpm",
    "engine_load",
    "throttle_pos",
    "long_fuel_trim_1",
    "coolant_temp",
    "elm_voltage",
]

SENSOR_SUGGESTIONS = {
    "rpm": ("Engine revolutions per minute.",
            "RPM too high – possible vacuum leak, idle control valve issue, or throttle problem.",
            "RPM too low – possible spark plug, injector, or air intake issue."),
    "engine_load": ("Engine load (how hard the engine is working).",
                    "Engine load high – may indicate restricted air filter, MAF sensor issue, or engine misfire.",
                    "Engine load low – could be sensor error or idle control system fault."),
    "throttle_pos": ("Throttle position sensor (TPS) angle.",
                    "Throttle too open at idle – TPS miscalibration or stuck throttle.",
                    "Throttle stuck closed – TPS issue or throttle body obstruction."),
    "long_fuel_trim_1": ("Long-term fuel trim adjustment by ECU.",
                        "Positive fuel trim – may suggest vacuum leak or fuel pressure too low.",
                        "Negative fuel trim – engine running rich, possibly due to leaky injector or O₂ sensor fault."),
    "coolant_temp": ("Engine coolant temperature in Celsius.",
                    "Coolant temperature too high – potential overheating, low coolant, or stuck thermostat.",
                    "Coolant temperature too low – thermostat may be stuck open or sensor faulty."),
    "elm_voltage": ("Vehicle battery and charging system voltage.",
                    "Voltage too high – possible regulator/rectifier or alternator issue.",
                    "Voltage too low – weak battery, alternator problem, or electrical drain."),
}

@lru_cache(maxsize=None)
def _load_model(brand: str, moto_id: str, mode="idle"):
    brand = normalize(brand)
    path = os.path.join(MODEL_BASE_DIR, brand, f"{mode}_{moto_id}.pkl")
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    bundle = joblib.load(path)
    if not {"model", "scaler"} <= bundle.keys():
        raise ValueError(f"{path} missing model/scaler keys")
    return bundle["model"], bundle["scaler"]

def _get_window_df(motorcycle_id: str, minutes: int = 30) -> pd.DataFrame:
    flux = f"""
    from(bucket: "{INFLUXDB_BUCKET}")
      |> range(start: -{minutes}m)
      |> filter(fn: (r) => r._measurement == "obd_data")
      |> filter(fn: (r) => r.motorcycle_id == "{motorcycle_id}")
      |> filter(fn: (r) => { " or ".join([f'r._field == "{f}"' for f in FEATURES]) })
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> keep(columns: [{', '.join([f'"{f}"' for f in ["_time"] + FEATURES]) }])
    """

    client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
    df = client.query_api().query_data_frame(flux)
    client.close()
    if df.empty:
        return pd.DataFrame()
    df = df.drop(columns=["result", "table"], errors="ignore")

    # Show how many nulls per feature for debugging
    print("[DEBUG] Null count per column:")
    print(df[FEATURES].isnull().sum())

    # Keep rows with at least 4 non-null sensor readings
    df = df[df[FEATURES].notna().sum(axis=1) >= 4]

    df = df.sort_values("_time").reset_index(drop=True)
    return df

def detect_anomalies(motorcycle_id: str, brand: str, model: str, mode="idle", minutes=30):
    try:
        print(f"\n[INFO] Detecting anomalies for Motorcycle ID: {motorcycle_id}, Brand: {brand}, Model: {model}, Mode: {mode}")

        brand = normalize(brand)
        model = normalize(model)

        # Step 1: Fetch data from InfluxDB
        df = _get_window_df(motorcycle_id, minutes)
        print(f"[DEBUG] Raw data rows from InfluxDB: {len(df)}")

        # Step 2: Clean data — remove rows where all feature values are 0
        df = df[(df[FEATURES] != 0).any(axis=1)]
        print(f"[DEBUG] Rows after removing all-zero rows: {len(df)}")

        # Step 3: Check if we have enough data to continue
        if df.empty or len(df) < 30:
            print("[WARN] Not enough data to analyze.")
            return {
                "status": "ok",
                "motorcycle_id": motorcycle_id,
                "message": "Not enough data",
                "explanations": []
            }

        # Step 4: Load model and scale data
        model_obj, scaler = _load_model(brand, motorcycle_id, mode)
        X_scaled = scaler.transform(df[FEATURES].values)
        print(f"[DEBUG] Scaled input shape: {X_scaled.shape}")

        # Step 5: Aggregate features for prediction
        agg_features = np.hstack([
            np.mean(X_scaled, axis=0),
            np.std(X_scaled, axis=0),
            np.max(X_scaled, axis=0),
            np.min(X_scaled, axis=0)
        ]).reshape(1, -1)
        print(f"[DEBUG] Aggregated features shape: {agg_features.shape}")

        # Step 6: Make prediction
        pred = model_obj.predict(agg_features)
        is_anomaly = (pred[0] == -1)
        print(f"[RESULT] Model Prediction: {'Anomaly' if is_anomaly else 'Normal'}")

        # Step 7: Interpret sensor values
        explanations = []
        abnormal_features = []

        for f in FEATURES:
            try:
                mean_value = float(df[f].mean())
            except:
                mean_value = 0.0

            severity = classify_value(f, mean_value, brand, model)
            severity_score = compute_severity_score(f, mean_value, brand, model)
            desc, high_tip, low_tip = SENSOR_SUGGESTIONS.get(f, ("", "", ""))

            try:
                if f == "long_fuel_trim_1":
                    is_high = mean_value > 0
                else:
                    r = NORMAL_RANGES[brand][model][f]
                    midpoint = (r["warning_min"] + r["warning_max"]) / 2
                    is_high = mean_value > midpoint
            except:
                is_high = True

            if severity != "normal":
                abnormal_features.append(f)

            tip_base = high_tip if is_high else low_tip

            if severity == "critical":
                level = "High" if is_high else "Low"
                tip = f"🔴 CRITICAL ({level}): {tip_base} Please consult a mechanic immediately."
            elif severity == "warning":
                level = "High" if is_high else "Low"
                tip = f"🟡 WARNING ({level}): {tip_base} Monitor this and schedule maintenance."
            elif severity == "normal":
                tip = "🟢 Normal: Sensor reading is within expected range."
            else:
                tip = "⚠️ Unknown: No reference range found."

            explanations.append({
                "feature": f,
                "status": severity,
                "value": round(mean_value, 2),
                "severity_score": severity_score,
                "description": desc,
                "tip": tip
            })

        # Step 8: Row-level anomalies
        row_anomalies = []
        for i, row in df.iterrows():
            issues = []
            for f in FEATURES:
                v = row[f]
                sev = classify_value(f, v, brand, model)
                if sev in ["critical", "warning"]:
                    issues.append(f"{f}={v:.2f} → {sev}")
            if issues:
                row_anomalies.append({
                    "row_index": i,
                    "time": row["_time"],
                    "issues": issues,
                    "values": {**{f: row[f] for f in FEATURES}, "_time": row["_time"]},
                    "severity": {f: classify_value(f, row[f], brand, model) for f in FEATURES}
                })

        anomaly_percent = (len(row_anomalies) / len(df)) * 100

        # Step 9: Final message
        if any(e["status"] == "critical" for e in explanations):
            suggestion = "⚠️ Critical values detected. Please see a mechanic immediately."
        elif any(e["status"] == "warning" for e in explanations):
            suggestion = "🛠️ Warning detected. Maintenance check recommended."
        elif is_anomaly:
            suggestion = "⚠️ ML pattern anomaly detected. Observe or consult a mechanic if needed."
        else:
            suggestion = "✅ All systems within normal range."

        print(f"[SUMMARY] {len(row_anomalies)} row anomalies found ({anomaly_percent:.2f}% of data)")
        print(f"[SUMMARY] Abnormal features: {abnormal_features}")
        print(f"[SUGGESTION] {suggestion}")

        return {
            "status": "ok",
            "motorcycle_id": motorcycle_id,
            "anomalies_detected": len(row_anomalies),
            "anomaly_percent": round(anomaly_percent, 2),
            "abnormal_features": abnormal_features,
            "explanations": explanations,
            "row_anomalies": row_anomalies,
            "suggestion": suggestion
        }

    except Exception as e:
        print(f"[ERROR] detect_anomalies failed: {e}")
        return {"status": "error", "motorcycle_id": motorcycle_id, "error": str(e)}

if __name__ == "__main__":
    print(detect_anomalies(
        motorcycle_id="2",
        brand="honda",
        model="click_i125",
        mode="idle",
        minutes=30
    ))