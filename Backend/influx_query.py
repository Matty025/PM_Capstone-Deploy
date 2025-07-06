from influxdb_client import InfluxDBClient
import pandas as pd
import os

from dotenv import load_dotenv
load_dotenv()

# InfluxDB connection config
INFLUXDB_URL = os.getenv("INFLUX_URL")
INFLUXDB_TOKEN = os.getenv("INFLUX_TOKEN")
INFLUXDB_ORG = os.getenv("INFLUX_ORG")
INFLUXDB_BUCKET = os.getenv("INFLUX_BUCKET")  # This is also used as the database name in SQL

# Initialize InfluxDB client
client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
query_api = client.query_api()

def get_recent_data(motorcycle_id, minutes=10):
    """
    Fetch and clean recent data for the given motorcycle ID within the last X minutes using SQL.
    Returns a cleaned DataFrame or empty list.
    """
    sql = f"""
    SELECT *
    FROM "obd_data"
    WHERE
        time >= now() - interval '{minutes} minutes'
        AND "motorcycle_id" = '{motorcycle_id}'
        AND (
            "rpm" IS NOT NULL OR
            "engine_load" IS NOT NULL OR
            "throttle_pos" IS NOT NULL OR
            "long_fuel_trim_1" IS NOT NULL OR
            "coolant_temp" IS NOT NULL OR
            "elm_voltage" IS NOT NULL
        )
    ORDER BY time DESC
    LIMIT 100
    """

    try:
        df = query_api.query_data_frame_sql(query=sql, database=INFLUXDB_BUCKET)
    except Exception as e:
        print(f"[ERROR] SQL query failed: {e}")
        return []

    if df.empty:
        return []

    # Clean and format
    df.dropna(inplace=True)
    df.drop_duplicates(inplace=True)
    df.sort_values(by="time", inplace=True)
    df.reset_index(drop=True, inplace=True)

    return df.to_dict("records")
