import obd
import os
import time
import json
import sys
import paho.mqtt.client as mqtt
from influxdb_client import InfluxDBClient, Point, WriteOptions
from urllib.parse import urlparse
import ssl

# ───── MQTT Setup ─────
mqtt_url = os.getenv("MQTT_BROKER_URL", "mqtts://ha62a160.ala.asia-southeast1.emqxsl.com:8883")
parsed = urlparse(mqtt_url)

MQTT_BROKER = parsed.hostname or "ha62a160.ala.asia-southeast1.emqxsl.com"
MQTT_PORT = parsed.port or 8883
MQTT_TRANSPORT = "tcp"

mqtt_client = mqtt.Client(transport=MQTT_TRANSPORT, protocol=mqtt.MQTTv311)
mqtt_client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
mqtt_client.tls_insecure_set(False)

def on_connect(client, userdata, flags, rc):
    print(f"Connected to MQTT broker with result code {rc}")

mqtt_client.on_connect = on_connect
mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 30)
mqtt_client.loop_start()

# ───── InfluxDB Setup ─────
INFLUXDB_URL = os.getenv("INFLUX_URL")
INFLUXDB_TOKEN = os.getenv("INFLUX_TOKEN")
INFLUXDB_ORG = os.getenv("INFLUX_ORG")
INFLUXDB_BUCKET = os.getenv("INFLUX_BUCKET")

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
                point = point.field(cmd.lower(), float(value))
            except (ValueError, TypeError):
                print(f"[WARNING] Could not convert value to float for {cmd}: {value}")
    write_api.write(bucket=INFLUXDB_BUCKET, record=point)
    print(f"[InfluxDB] Wrote: {obd_data}")

# ───── Motorcycle ID ─────
if len(sys.argv) < 2:
    print("[WARNING] No motorcycle_id provided. Using 'unknown'.")
    MOTORCYCLE_ID = "unknown"
else:
    MOTORCYCLE_ID = sys.argv[1]

MQTT_TOPIC = f"obd/motorcycle/{MOTORCYCLE_ID}/data"

# ───── Connect to OBD ─────
port = "COM4"  # Change this if needed
print(f"Attempting to connect to OBD-II device on {port}...")

try:
    connection = obd.OBD(portstr=port, fast=True, timeout=3)

    if connection.is_connected():
        print(f"✅ Successfully connected to vehicle on {port}.")

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
        print("📡 Starting data collection. Press Ctrl+C to stop.")

        try:
            while True:
                # os.system('cls' if os.name == 'nt' else 'clear')  # Removed to preserve logs

                obd_data = {}
                for cmd in commands:
                    response = connection.query(cmd)

                    if response.is_null():
                        print(f"[DEBUG] {cmd.name} returned no data.")
                        value = None
                    else:
                        value = response.value.magnitude if response.value is not None else None
                        value = round(float(value), 2) if value is not None else None

                    obd_data[cmd.name] = value

                # 🔍 Detect if motorcycle is off
                if all(v is None for v in obd_data.values()):
                    print("⚠️ Motorcycle is turned off. Please turn it on.", file=sys.stderr)

                # Remove null values from payload
                payload_data = {k: v for k, v in obd_data.items() if v is not None}
                payload = {
                    "motorcycle_id": MOTORCYCLE_ID,
                    "data": payload_data
                }

                mqtt_client.publish(MQTT_TOPIC, json.dumps(payload))
                print(f"📤 Published OBD data:\n{json.dumps(payload, indent=2)}")

                # Write to InfluxDB every 5 seconds
                current_time = time.time()
                if current_time - last_write_time >= 5:
                    write_to_influxdb(obd_data, MOTORCYCLE_ID)
                    last_write_time = current_time

                time.sleep(0.2)  # 200 ms delay

        except KeyboardInterrupt:
            print("\n⛔ Data gathering stopped by user.")

    else:
        print("❌ Bluetooth not connected to OBD adapter. Please check the connection.", file=sys.stderr)

except Exception as e:
    print(f"❌ Error while connecting to {port}: {e}", file=sys.stderr)

finally:
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    if 'connection' in locals() and connection.is_connected():
        connection.close()
    influx_client.close()
