import sys
import os

# ─────────────── Load .env Variables ───────────────
from dotenv import load_dotenv
load_dotenv()

# Allow importing sibling files like anomaly_model.py
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, jsonify, request
from flask_cors import CORS
import paho.mqtt.client as mqttP
import json
import subprocess
import threading
import psutil
from anomaly_model import detect_anomalies
import joblib

from influx_query import get_recent_data
from report_api import report_api  # Blueprint for /oil-history, /daily, /weekly

app = Flask(__name__)

CORS(app, resources={r"/*": {"origins": "https://preventive-maintenance-ml.onrender.com"}}, supports_credentials=True)
app.register_blueprint(report_api)
@app.after_request
def after_request(response):
    response.headers["Access-Control-Allow-Origin"] = "https://preventive-maintenance-ml.onrender.com"
    response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response

# Optional but useful: Add CORS headers to all responses
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', 'https://preventive-maintenance-ml.onrender.com')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    return response

print("✅ Server is starting...")
print(f"📂 Current working dir: {os.getcwd()}")
print(f"📄 Files: {os.listdir(os.path.dirname(__file__))}")

# ─────────────── MQTT CONFIG ───────────────
from urllib.parse import urlparse

mqtt_url = os.getenv("MQTT_BROKER_URL", "mqtt://broker.hivemq.com:1883")
parsed = urlparse(mqtt_url)

MQTT_BROKER = parsed.hostname or "test.mosquitto.org"
MQTT_PORT = parsed.port or 8081
MQTT_TRANSPORT = "websockets" if parsed.scheme in ["ws", "wss"] else "tcp"
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "obd/data")

latest_obd_data = {}
obd_process = None

def kill_existing_obd_process():
    for proc in psutil.process_iter(attrs=['pid', 'name', 'cmdline']):
        try:
            if proc.info['name'] == "python.exe" and proc.info['cmdline'] and any("obddata.py" in arg for arg in proc.info['cmdline']):
                print(f"🔴 Killing existing `obddata.py` process (PID: {proc.pid})...")
                proc.terminate()
                proc.wait(timeout=5)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

kill_existing_obd_process()

# ─────────────── MQTT HANDLERS ───────────────
def on_message(client, userdata, msg):
    global latest_obd_data
    try:
        latest_obd_data = json.loads(msg.payload.decode("utf-8"))
    except Exception as e:
        print(f"❌ MQTT message decode error: {e}")

def on_log(client, userdata, level, buf):
    print(f"[MQTT LOG] {buf}")

def start_mqtt():
    print(f"[MQTT] Connecting to {MQTT_BROKER}:{MQTT_PORT} using {MQTT_TRANSPORT}")
    client = mqttP.Client(transport=MQTT_TRANSPORT)
    client.on_message = on_message
    client.on_log = on_log
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        client.subscribe(MQTT_TOPIC)
        client.loop_start()
    except Exception as e:
        print(f"❌ MQTT Connection error: {e}")

mqtt_thread = threading.Thread(target=start_mqtt, daemon=True)
mqtt_thread.start()

def stream_output(pipe, name):
    for line in iter(pipe.readline, ''):
        print(f"[{name}] {line.rstrip()}")

@app.route("/start-obd", methods=["POST", "OPTIONS"])
def start_obd():
    global obd_process

    if request.method == "OPTIONS":
        return '', 204

    if obd_process and obd_process.poll() is None:
        return jsonify({"message": "OBD data collection already running", "pid": obd_process.pid}), 200

    data = request.get_json() or {}
    motorcycle_id = data.get("motorcycle_id")

    print(f"🟢 Starting OBD data collection for motorcycle_id={motorcycle_id}")

    try:
        args = [sys.executable, "obddata.py"]
        if motorcycle_id:
            args.append(str(motorcycle_id))

        obd_process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )

        threading.Thread(target=stream_output, args=(obd_process.stdout, "STDOUT"), daemon=True).start()
        threading.Thread(target=stream_output, args=(obd_process.stderr, "STDERR"), daemon=True).start()

        return jsonify({"message": "OBD data collection started", "pid": obd_process.pid}), 200

    except Exception as e:
        return jsonify({"error": f"Failed to start obddata.py: {e}"}), 500

@app.route("/stop-obd", methods=["GET", "OPTIONS"])
def stop_obd():
    global obd_process

    if request.method == "OPTIONS":
        return '', 204

    if obd_process and obd_process.poll() is None:
        print(f"🛑 Stopping OBD process (PID: {obd_process.pid})...")
        obd_process.terminate()
        try:
            obd_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            obd_process.kill()
        obd_process = None
        return jsonify({"message": "OBD data collection stopped"}), 200

    return jsonify({"message": "No running OBD data collection process"}), 200

@app.route("/obd-data", methods=["GET"])
def get_obd_data():
    return jsonify(latest_obd_data)

# Keep the rest of the training and prediction routes unchanged...
# (They remain as you pasted earlier.)

@app.route("/")
def index():
    return jsonify({"status": "ok", "message": "Server running."}), 200

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
