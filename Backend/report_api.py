# report_api.py
from flask import Blueprint, jsonify, request
from influxdb_client import InfluxDBClient
import os
from dotenv import load_dotenv
load_dotenv()

report_api = Blueprint("report_api", __name__)

# InfluxDB configuration
INFLUXDB_URL = os.getenv("INFLUX_URL")
INFLUXDB_TOKEN = os.getenv("INFLUX_TOKEN")
INFLUXDB_ORG = os.getenv("INFLUX_ORG")
INFLUXDB_BUCKET = os.getenv("INFLUX_BUCKET")

client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
query_api = client.query_api()

FEATURES = [
    "rpm",
    "engine_load",
    "throttle_pos",
    "long_fuel_trim_1",
    "coolant_temp",
    "elm_voltage"
]

def query_aggregated_report(time_range, motorcycle_id):
    fields_filter = " or ".join([f'r["_field"] == "{f}"' for f in FEATURES])
    keep_columns = ', '.join([f'"{f}"' for f in ["_time"] + FEATURES])

    query = f'''
    from(bucket: "{INFLUXDB_BUCKET}")
      |> range(start: {time_range})
      |> filter(fn: (r) => r["_measurement"] == "obd_data")
      |> filter(fn: (r) => r["motorcycle_id"] == "{motorcycle_id}")
      |> filter(fn: (r) => {fields_filter})
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> keep(columns: [{keep_columns}])
    '''

    result = query_api.query_data_frame(query)

    # If empty, return None for each field
    if result.empty:
        return {f: None for f in FEATURES}

    # Drop metadata columns and calculate mean per feature
    try:
        means = result[FEATURES].mean(numeric_only=True).round(2).to_dict()
        return means
    except Exception as e:
        print(f"[ERROR] Failed to compute means: {e}")
        return {f: None for f in FEATURES}

@report_api.route("/reports/daily", methods=["GET"])
def daily_report():
    motorcycle_id = request.args.get("motorcycle_id", "unknown")
    if motorcycle_id == "unknown":
        return jsonify({"error": "Missing motorcycle_id"}), 400
    report = query_aggregated_report("-24h", motorcycle_id)
    return jsonify(report)

@report_api.route("/reports/weekly", methods=["GET"])
def weekly_report():
    motorcycle_id = request.args.get("motorcycle_id", "unknown")
    if motorcycle_id == "unknown":
        return jsonify({"error": "Missing motorcycle_id"}), 400
    report = query_aggregated_report("-7d", motorcycle_id)
    return jsonify(report)
# ─── Exported for MQTT use ───

def get_daily_report(motorcycle_id):
    return query_aggregated_report("-24h", motorcycle_id)

def get_weekly_report(motorcycle_id):
    return query_aggregated_report("-7d", motorcycle_id)
