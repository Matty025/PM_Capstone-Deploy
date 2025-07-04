from flask import Flask, jsonify, request
from flask_cors import CORS
import paho.mqtt.client as mqtt
import json
import subprocess
import os
import threading
import sys
import psutil
from anomaly_model import detect_anomalies
import joblib


# ====  ML & DB helpers  ====
from anomaly_model   import detect_anomalies
from influx_query    import get_recent_data   # <-- your cleaned‑data helper

from report_api import report_api  # 👈 import your Blueprint


app = Flask(__name__)
CORS(app)  # Allow CORS for frontend access
app.register_blueprint(report_api)  # 👈 attach /reports/daily and /weekly routes

# MQTT broker settings
MQTT_BROKER = "broker.hivemq.com"
MQTT_PORT = 1883
MQTT_TOPIC = "obd/data"

# Store the latest OBD data
latest_obd_data = {}
obd_process = None  # Single instance tracking

# Kill any running obddata.py process when the server starts
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

# MQTT callback when a message is received
def on_message(client, userdata, msg):
    global latest_obd_data
    try:
        latest_obd_data = json.loads(msg.payload.decode("utf-8"))
        # print(f"📡 MQTT Received: {latest_obd_data}")
    except Exception as e:
        print(f"❌ MQTT message decode error: {e}")

# MQTT logging
def on_log(client, userdata, level, buf):
    print(f"[MQTT LOG] {buf}")

# Start MQTT client in a background thread
def start_mqtt():
    client = mqtt.Client()
    client.on_message = on_message
    client.on_log = on_log
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.subscribe(MQTT_TOPIC)
    client.loop_forever()

mqtt_thread = threading.Thread(target=start_mqtt, daemon=True)
mqtt_thread.start()

# Function to stream subprocess output
def stream_output(pipe, name):
    for line in iter(pipe.readline, ''):  # '' is the sentinel for end of stream
        print(f"[{name}] {line.rstrip()}")

@app.route("/start-obd", methods=["POST"])
def start_obd():
    global obd_process

    if obd_process and obd_process.poll() is None:
        return jsonify({"message": "OBD data collection already running", "pid": obd_process.pid}), 200

    # Read motorcycle_id from JSON
    data = request.get_json() or {}
    motorcycle_id = data.get("motorcycle_id")

    print(f"🟢 Starting OBD data collection for motorcycle_id={motorcycle_id}")

    try:
        # Start subprocess
        args = [sys.executable, "obddata.py"]
        if motorcycle_id:
            args.append(str(motorcycle_id))

        obd_process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True  # Ensures stdout/stderr are text, not bytes
        )

        # Stream output asynchronously
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
# ------------------------------------------------------------
#  this will save the Model of your current motorcycle
# ------------------------------------------------------------

@app.route('/train_model', methods=['POST'])
def train_model():
    try:
        data = request.get_json()
        motorcycle_id = data.get("motorcycle_id")
        brand = data.get("brand")

        if not motorcycle_id or not brand:
            return jsonify({"status": "error", "message": "Missing motorcycle_id or brand"}), 400

        # Normalize brand folder name
        brand_folder = brand.strip().replace(" ", "_").lower()

        # Use Python interpreter from current environment
        python_exe = sys.executable

        # Construct the command
        cmd = [
            python_exe,
            "train_idle_model.py",
            "--motorcycle_id", str(motorcycle_id),
            "--brand", brand_folder,
            "--minutes", "43200"
        ]

        print(f"[DEBUG] Running command: {' '.join(cmd)}")

        # Run the command and capture output
        result = subprocess.run(cmd, capture_output=True, text=True)

        print("[DEBUG] STDOUT:", result.stdout)
        print("[DEBUG] STDERR:", result.stderr)

        if result.returncode != 0:
            return jsonify({
                "status": "error",
                "message": result.stderr or "Training script failed"
            }), 500

        return jsonify({
            "status": "success",
            "message": result.stdout or "Model trained successfully"
        })

    except Exception as e:
        print("[TRAIN_MODEL ERROR]", str(e))
        return jsonify({"status": "error", "message": str(e)}), 500
# ------------------------------------------------------------
#  🔄  NEW: Recent‑data endpoint  (table on the frontend)
# ------------------------------------------------------------
@app.route("/recent-data", methods=["POST"])
def recent_data():
    body          = request.get_json(force=True) or {}
    motorcycle_id = body.get("motorcycle_id")
    minutes       = int(body.get("minutes", 30))
    if not motorcycle_id:
        return jsonify({"status":"error","error_message":"motorcycle_id is required"}), 400
    try:
        rows = get_recent_data(motorcycle_id, minutes)
        return jsonify({"status":"ok","rows":rows}), 200
    except Exception as exc:
        return jsonify({"status":"error","error_message":str(exc)}), 500
# -----------------------------------------------------------
# ------------------------------------------------------------
#  🔮  ML /predict endpoint  (anomaly suggestion)
@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json()
    motorcycle_id = str(data.get('motorcycle_id'))
    brand = data.get('brand')
    model = data.get('model')  # ✅ new

    if not motorcycle_id or not brand or not model:
        return jsonify({"status": "error", "message": "Missing motorcycle_id, brand, or model"}), 400

    brand_folder = brand.strip().replace(" ", "_").lower()
    model_name   = model.strip().replace(" ", "_").lower()

    model_path = os.path.join("models", brand_folder, f"idle_{motorcycle_id}.pkl")

    if not os.path.exists(model_path):
        return jsonify({
            "status": "error",
            "message": f"Model not found for motorcycle_id {motorcycle_id} → {model_path}"
        }), 404

    try:
        result = detect_anomalies(
            motorcycle_id=motorcycle_id,
            brand=brand_folder,
            model=model_name,  # ✅ passed to anomaly_model
            mode="idle",
            minutes=30
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Prediction failed: {str(e)}"
        }), 500

# ----------------------------------this is the CSV routes for manual upload-------------------------
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

        # Optional: clean bad rows
        df = df.replace(0, np.nan).dropna()
        for col in FEATURES:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        df["_time"] = pd.Timestamp.now()  # dummy time column

        # Monkey patch only for this request
        original_get_window_df = anomaly_model._get_window_df  # save original

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
            anomaly_model._get_window_df = original_get_window_df  # restore original

        return jsonify(result)

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500



if __name__ == "__main__":
    app.run(debug=True, port=5000)
