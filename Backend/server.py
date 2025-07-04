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

# Store latest OBD data
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

@app.route("/start-obd", methods=["POST"])
def start_obd():
    global obd_process

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

@app.route("/stop-obd", methods=["GET"])
def stop_obd():
    global obd_process

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

@app.route('/train_model', methods=['POST'])
def train_model():
    try:
        data = request.get_json()
        motorcycle_id = data.get("motorcycle_id")
        brand = data.get("brand")

        if not motorcycle_id or not brand:
            return jsonify({"status": "error", "message": "Missing motorcycle_id or brand"}), 400

        brand_folder = brand.strip().replace(" ", "_").lower()
        python_exe = sys.executable

        cmd = [
            python_exe,
            "train_idle_model.py",
            "--motorcycle_id", str(motorcycle_id),
            "--brand", brand_folder,
            "--minutes", "43200"
        ]

        print(f"[DEBUG] Running command: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)

        print("[DEBUG] STDOUT:", result.stdout)
        print("[DEBUG] STDERR:", result.stderr)

        if result.returncode != 0:
            return jsonify({"status": "error", "message": result.stderr or "Training script failed"}), 500

        return jsonify({"status": "success", "message": result.stdout or "Model trained successfully"})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/recent-data", methods=["POST"])
def recent_data():
    body = request.get_json(force=True) or {}
    motorcycle_id = body.get("motorcycle_id")
    minutes = int(body.get("minutes", 30))

    if not motorcycle_id:
        return jsonify({"status": "error", "error_message": "motorcycle_id is required"}), 400
    try:
        rows = get_recent_data(motorcycle_id, minutes)
        return jsonify({"status": "ok", "rows": rows}), 200
    except Exception as exc:
        return jsonify({"status": "error", "error_message": str(exc)}), 500

@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json()
    motorcycle_id = str(data.get('motorcycle_id'))
    brand = data.get('brand')
    model = data.get('model')

    if not motorcycle_id or not brand or not model:
        return jsonify({"status": "error", "message": "Missing motorcycle_id, brand, or model"}), 400

    brand_folder = brand.strip().replace(" ", "_").lower()
    model_name = model.strip().replace(" ", "_").lower()

    model_path = os.path.join("models", brand_folder, f"idle_{motorcycle_id}.pkl")

    if not os.path.exists(model_path):
        return jsonify({"status": "error", "message": f"Model not found → {model_path}"}), 404

    try:
        result = detect_anomalies(
            motorcycle_id=motorcycle_id,
            brand=brand_folder,
            model=model_name,
            mode="idle",
            minutes=30
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"status": "error", "message": f"Prediction failed: {str(e)}"}), 500

@app.route('/predict-from-csv', methods=['POST'])
def predict_from_csv():
    try:
        file = request.files["file"]
        brand = request.form["brand"]
        model = request.form["model"]
        motorcycle_id = request.form["motorcycle_id"]

        if not file:
            return jsonify({"status": "error", "message": "No file provided"}), 400

        import pandas as pd
        import numpy as np
        import anomaly_model
        from anomaly_model import detect_anomalies, FEATURES

        df = pd.read_csv(file)
        df = df.replace(0, np.nan).dropna()
        for col in FEATURES:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df["_time"] = pd.Timestamp.now()

        original_get_window_df = anomaly_model._get_window_df

        def patched_get_window_df(*_, **__):
            return df

        anomaly_model._get_window_df = patched_get_window_df

        try:
            result = detect_anomalies(
                motorcycle_id=motorcycle_id,
                brand=brand,
                model=model,
                mode="idle",
                minutes=30
            )
        finally:
            anomaly_model._get_window_df = original_get_window_df

        return jsonify(result)

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route("/")
def index():
    return jsonify({"status": "ok", "message": "Server running."}), 200

# ─────────────── App Run Entry Point ───────────────
if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.getenv("PORT", 5000)))
