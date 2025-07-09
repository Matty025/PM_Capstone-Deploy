from influxdb_client import InfluxDBClient
import pandas as pd
import os
from dotenv import load_dotenv
import json

# ───── Load Environment Variables ─────
load_dotenv()

# ───── InfluxDB Configuration ─────
INFLUXDB_URL = os.getenv("INFLUX_URL")
INFLUXDB_TOKEN = os.getenv("INFLUX_TOKEN")
INFLUXDB_ORG = os.getenv("INFLUX_ORG")
INFLUXDB_BUCKET = os.getenv("INFLUX_BUCKET")

# ───── Initialize InfluxDB Client ─────
client = InfluxDBClient(
    url=INFLUXDB_URL,
    token=INFLUXDB_TOKEN,
    org=INFLUXDB_ORG
)
query_api = client.query_api()

def get_recent_data(motorcycle_id, minutes=30):
    """
    Fetch recent OBD-II data for a specific motorcycle using Flux query.
    Cleans up Influx system columns and formats time for frontend use.
    """

    flux_query = f'''
    from(bucket: "{INFLUXDB_BUCKET}")
      |> range(start: -{minutes}m)
      |> filter(fn: (r) => r["_measurement"] == "obd_data")
      |> filter(fn: (r) => r["motorcycle_id"] == "{motorcycle_id}")
      |> filter(fn: (r) =>
        r["_field"] == "coolant_temp" or
        r["_field"] == "elm_voltage" or
        r["_field"] == "engine_load" or
        r["_field"] == "long_fuel_trim_1" or
        r["_field"] == "rpm" or
        r["_field"] == "throttle_pos"
      )
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"])
    '''

    try:
        df = query_api.query_data_frame(flux_query)
        if isinstance(df, list):
            df = pd.concat(df, ignore_index=True)

        if df.empty:
            return []

        # ───── Drop system columns that you don't want in the table ─────
        drop_cols = ["result", "table", "_start", "_stop", "_measurement"]
        df.drop(columns=[col for col in drop_cols if col in df.columns], inplace=True)

        # ───── Clean Data ─────
        df.dropna(inplace=True)
        df.drop_duplicates(inplace=True)
        df.reset_index(drop=True, inplace=True)

        # ───── Format Timestamp ─────
        if "_time" in df.columns:
            df["_time"] = pd.to_datetime(df["_time"], errors="coerce")
            df = df[df["_time"].notna()]
            df["_time"] = df["_time"].dt.strftime('%B %d, %Y %H:%M:%S')  # Ex: July 06, 2025 13:02:30

        # ───── Rename Columns for Readability (optional) ─────
        column_map = {
            "_time": "Timestamp",
            "coolant_temp": "Coolant Temperature (°C)",
            "elm_voltage": "ELM Voltage (V)",
            "engine_load": "Engine Load (%)",
            "long_fuel_trim_1": "Fuel Trim (%)",
            "rpm": "RPM",
            "throttle_pos": "Throttle Position (%)"
        }
        df.rename(columns=column_map, inplace=True)

        return json.loads(df.to_json(orient="records"))

    except Exception as e:
        print(f"[ERROR] Flux query failed: {e}")
        return []
