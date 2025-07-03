from influxdb_client import InfluxDBClient
import pandas as pd
import os 
# InfluxDB connection config
INFLUXDB_URL = os.getenv("INFLUX_URL")
INFLUXDB_TOKEN = os.getenv("INFLUX_TOKEN")
INFLUXDB_ORG = os.getenv("INFLUX_ORG")
INFLUXDB_BUCKET = os.getenv("INFLUX_BUCKET")

# Initialize InfluxDB client
client = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
query_api = client.query_api()

def get_recent_data(motorcycle_id, minutes=10):
    """
    Fetch and clean recent data for the given motorcycle ID within the last X minutes.
    Returns a cleaned DataFrame or empty list.
    """
    time_range = f"-{minutes}m"

    query = f'''
    from(bucket: "{INFLUXDB_BUCKET}")
      |> range(start: {time_range})
      |> filter(fn: (r) => r["_measurement"] == "obd_data")
      |> filter(fn: (r) => r["motorcycle_id"] == "{motorcycle_id}")
      |> filter(fn: (r) =>
          r["_field"] == "rpm" or
          r["_field"] == "engine_load" or
          r["_field"] == "throttle_pos" or
          r["_field"] == "long_fuel_trim_1" or
          r["_field"] == "coolant_temp" or
          r["_field"] == "elm_voltage")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> keep(columns: ["_time", "rpm", "engine_load", "throttle_pos", "long_fuel_trim_1", "coolant_temp", "elm_voltage"])
    '''

    # Execute the query
    df = query_api.query_data_frame(org=INFLUXDB_ORG, query=query)

    if df.empty:
        return []

    # Drop internal columns if present
    df = df.drop(columns=["result", "table"], errors="ignore")

    # Clean data: remove rows with missing values
    df.dropna(inplace=True)

    # Optional: remove exact duplicates
    df.drop_duplicates(inplace=True)

    # Sort by time
    df.sort_values(by="_time", inplace=True)

    # Reset index
    df.reset_index(drop=True, inplace=True)

    # Return cleaned data as list of records (for JSON or frontend use)
    return df.to_dict("records")
