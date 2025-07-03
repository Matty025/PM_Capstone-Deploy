import obd
import os
import time
import json
import sys
import paho.mqtt.client as mqtt
from influxdb_client import InfluxDBClient, Point, WriteOptions

# Enable debug logging
obd.logger.setLevel(obd.logging.DEBUG)

# MQTT broker settings
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
MQTT_TOPIC = "obd/data"

# InfluxDB settings - update these with your real values
INFLUXDB_URL = os.getenv("INFLUX_URL")
INFLUXDB_TOKEN = os.getenv("INFLUX_TOKEN")
INFLUXDB_ORG = os.getenv("INFLUX_ORG")
INFLUXDB_BUCKET = os.getenv("INFLUX_BUCKET")

# Get motorcycle_id from command line argument (optional)
if len(sys.argv) < 2:
    print("[WARNING] No motorcycle_id provided. Using 'unknown'.")
    MOTORCYCLE_ID = "unknown"
else:
    MOTORCYCLE_ID = sys.argv[1]

# Create MQTT client
mqtt_client = mqtt.Client(protocol=mqtt.MQTTv311)

def on_connect(client, userdata, flags, rc):
    print(f"Connected to MQTT broker with result code {rc}")

mqtt_client.on_connect = on_connect
mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 30)
mqtt_client.loop_start()

# Setup InfluxDB client
influx_client = InfluxDBClient(
    url=INFLUXDB_URL,
    token=INFLUXDB_TOKEN,
    org=INFLUXDB_ORG
)
write_api = influx_client.write_api(write_options=WriteOptions(batch_size=1))

def write_to_influxdb(obd_data, motorcycle_id):
    point = Point("obd_data").tag("motorcycle_id", motorcycle_id)
    for cmd, value in obd_data.items():
        if value is not None:
            try:
                val_float = float(value)
                point = point.field(cmd.lower(), val_float)  # e.g., rpm=1200
            except (ValueError, TypeError):
                print(f"[WARNING] Could not convert value to float for {cmd}: {value}")
                continue
    write_api.write(bucket=INFLUXDB_BUCKET, record=point)
    print(f"[InfluxDB] Wrote: {obd_data}")

port = "COM4"  # Change this as needed
print(f"Attempting to connect to OBD-II device on {port}...")

try:
    connection = obd.OBD(portstr=port, fast=True, timeout=3)

    if connection.is_connected():
        print(f"Successfully connected to vehicle on {port}!")

        # Check LONG_FUEL_TRIM_1 support
        if not connection.supports(obd.commands.LONG_FUEL_TRIM_1):
            print("[WARNING] LONG_FUEL_TRIM_1 PID not supported by this vehicle or adapter.")

        commands = [
            obd.commands.RPM,
            obd.commands.COOLANT_TEMP,
            obd.commands.ENGINE_LOAD,
            obd.commands.ELM_VOLTAGE,
            obd.commands.THROTTLE_POS,
            obd.commands.LONG_FUEL_TRIM_1
        ]

        last_write_time = time.time()

        print("Press Ctrl+C to stop data gathering.")
        try:
            while True:
                # Clear screen each loop for cleaner output
                os.system('cls' if os.name == 'nt' else 'clear')

                obd_data = {}
                for cmd in commands:
                    response = connection.query(cmd)

                    if response.is_null():
                        print(f"[DEBUG] {cmd.name} returned no data (null).")
                        value = None
                    else:
                        value = response.value.magnitude if response.value is not None else None
                        if value is not None:
                            value = round(float(value), 2)
                    obd_data[cmd.name] = value

                # Remove null values from payload to avoid sending them over MQTT
                payload_data = {k: v for k, v in obd_data.items() if v is not None}
                payload = {
                    "motorcycle_id": MOTORCYCLE_ID,
                    "data": payload_data
                }

                mqtt_client.publish(MQTT_TOPIC, json.dumps(payload))
                print(f"Published OBD data: {json.dumps(payload, indent=2)}")

                # Write to InfluxDB every 5 seconds
                current_time = time.time()
                if current_time - last_write_time >= 5:
                    write_to_influxdb(obd_data, MOTORCYCLE_ID)
                    last_write_time = current_time

                time.sleep(0.2)  # 200 ms delay for faster updates

        except KeyboardInterrupt:
            print("\nData gathering stopped by user.")
    else:
        print(f"Failed to connect to OBD-II device on {port}.")

except Exception as e:
    print(f"Error while connecting to {port}: {e}")

finally:
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    if 'connection' in locals() and connection.is_connected():
        connection.close()
    influx_client.close()
