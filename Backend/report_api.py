from flask import Blueprint, jsonify, request
from influxdb_client import InfluxDBClient
import os
import pandas as pd
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
    # Convert -24h or -7d to interval for SQL
    interval = {
        "-24h": "1 day",
        "-7d": "7 days"
    }.get(time_range, "1 day")

    # SQL query to fetch recent data with non-null fields
    query = f"""
    SELECT *
    FROM "obd_data"
    WHERE
        time >= now() - interval '{interval}'
        AND "motorcycle_id" = '{motorcycle_id}'
        AND (
            {" OR ".join([f'"{f}" IS NOT NULL' for f in FEATURES])}
        )
    ORDER BY time DESC
    LIMIT 1000
    """

    try:
        df = query_api.query_data_frame_sql(query=query, database=INFLUXDB_BUCKET)
    except Exception as e:
        print(f"[ERROR] SQL query failed: {e}")
        return {f: None for f in FEATURES}

    if df.empty:
        return {f: None for f in FEATURES}

    try:
        means = df[FEATURES].mean(numeric_only=True).round(2).to_dict()
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
