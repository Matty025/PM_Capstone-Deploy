from flask import Flask, jsonify, request
from flask_cors import CORS
import paho.mqtt.client as mqtt
import json
import subprocess
import os
import threading
import sys
import psutil
import ssl
import base64
import io
import pandas as pd
import numpy as np

from report_api import get_daily_report, get_weekly_report  # ✅ near the top of server.py

from anomaly_model import detect_anomalies, FEATURES
from influx_query import get_recent_data
from report_api import report_api
from dotenv import load_dotenv
load_dotenv()
load_dotenv()
print(f"📄 .env loaded: MQTT_HOST={os.getenv('MQTT_BROKER_HOST')}, PORT={os.getenv('MQTT_BROKER_PORT')}")

app = Flask(__name__)
CORS(app)
app.register_blueprint(report_api)

# ───── MQTT EMQX Setup ─────
import os
EMQX_HOST = os.getenv("MQTT_BROKER_HOST")
EMQX_PORT = int(os.getenv("MQTT_BROKER_PORT", 1883))  # default to 1883
MQTT_COMMAND_TOPIC = "obd/command"
MQTT_STATUS_TOPIC = "obd/status"

mqtt_client = mqtt.Client()
mqtt_client.username_pw_set(
    os.getenv("MQTT_USERNAME"),
    os.getenv("MQTT_PASSWORD")
)

def publish_status(status):
    mqtt_client.publish(MQTT_STATUS_TOPIC, json.dumps(status))

# ───── MQTT Callback ─────
def on_mqtt_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        command = payload.get("command")
        print(f"[MQTT] Received: {command}")

        if command == "start-obd":
            motorcycle_id = payload.get("motorcycle_id")
            threading.Thread(target=lambda: start_obd_internal(motorcycle_id), daemon=True).start()

        elif command == "stop-obd":
            stop_obd_internal()
            
        elif command == "report-daily":
            motorcycle_id = payload.get("motorcycle_id")
            if not motorcycle_id:
                publish_status({"status": "error", "message": "Missing motorcycle_id for daily report"})
                return
            report = get_daily_report(motorcycle_id)
            publish_status({"type": "report-daily", "rows": report})

        elif command == "report-weekly":
            motorcycle_id = payload.get("motorcycle_id")
            if not motorcycle_id:
                publish_status({"status": "error", "message": "Missing motorcycle_id for weekly report"})
                return
            report = get_weekly_report(motorcycle_id)
            publish_status({"type": "report-weekly", "rows": report})

        elif command == "train-model":
            motorcycle_id = payload.get("motorcycle_id")
            brand = payload.get("brand")
            train_model_internal(motorcycle_id, brand)

        elif command == "predict":
            motorcycle_id = payload.get("motorcycle_id")
            brand = payload.get("brand")
            model = payload.get("model")
            result = predict_internal(motorcycle_id, brand, model)
            publish_status(result)

        elif command == "recent-data":
            motorcycle_id = payload.get("motorcycle_id")
            minutes = payload.get("minutes", 30)
            data = get_recent_data(motorcycle_id, minutes)
            publish_status({"type": "recent-data", "rows": data})

        elif command == "predict-from-csv":
            motorcycle_id = payload.get("motorcycle_id")
            brand = payload.get("brand")
            model = payload.get("model")
            csv_base64 = payload.get("file_base64")

            try:
                if not all([motorcycle_id, brand, model, csv_base64]):
                    raise ValueError("Missing motorcycle_id, brand, model, or file_base64")

                decoded_csv = base64.b64decode(csv_base64).decode('utf-8')
                df = pd.read_csv(io.StringIO(decoded_csv))
                df = df.replace(0, np.nan).dropna()

                for col in FEATURES:
                    df[col] = pd.to_numeric(df[col], errors="coerce")
                df["_time"] = pd.Timestamp.now()

                import anomaly_model
                original_get_window_df = anomaly_model._get_window_df
                anomaly_model._get_window_df = lambda *_, **__: df

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

                publish_status({"type": "predict-from-csv", "result": result})
            except Exception as e:
                publish_status({"status": "error", "message": f"CSV Predict Error: {e}"})

    except Exception as e:
        print(f"❌ MQTT command failed: {e}")
        publish_status({"status": "error", "message": str(e)})

def on_mqtt_connect(client, userdata, flags, rc):
    print("✅ Connected to MQTT broker")
    client.subscribe(MQTT_COMMAND_TOPIC)

def start_mqtt():
    print(f"📡 Connecting to EMQX at {EMQX_HOST}:{EMQX_PORT} with TLS...")
    mqtt_client.on_connect = on_mqtt_connect
    mqtt_client.on_message = on_mqtt_message
    mqtt_client.tls_set(ca_certs="path/to/emqx_ca.crt", tls_version=ssl.PROTOCOL_TLSv1_2)
    mqtt_client.connect(EMQX_HOST, EMQX_PORT)
    mqtt_client.loop_start()

mqtt_thread = threading.Thread(target=start_mqtt, daemon=True)
mqtt_thread.start()

# ───── Internal Process Control ─────
obd_process = None

def start_obd_internal(motorcycle_id=None):
    global obd_process
    if obd_process and obd_process.poll() is None:
        publish_status({"status": "running", "message": "OBD already running"})
        return

    try:
        args = [sys.executable, "obddata.py"]
        if motorcycle_id:
            args.append(str(motorcycle_id))
        print(f"🛠️ Starting subprocess: {' '.join(args)}")  # in start_obd_internal()
        obd_process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        publish_status({"status": "started", "pid": obd_process.pid})
    except Exception as e:
        publish_status({"status": "error", "message": str(e)})

def stop_obd_internal():
    global obd_process
    if obd_process and obd_process.poll() is None:
        obd_process.terminate()
        obd_process = None
        publish_status({"status": "stopped", "message": "OBD stopped"})
    else:
        publish_status({"status": "idle", "message": "No OBD running"})

def train_model_internal(motorcycle_id, brand):
    try:
        brand_folder = brand.strip().replace(" ", "_").lower()
        cmd = [
            sys.executable, "train_idle_model.py",
            "--motorcycle_id", str(motorcycle_id),
            "--brand", brand_folder,
            "--minutes", "43200"
        ]
        print(f"🛠️ Training model with: {' '.join(cmd)}")  # in train_model_internal()
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            publish_status({"status": "success", "message": "Model trained"})
        else:
            publish_status({"status": "error", "message": result.stderr})
    except Exception as e:
        publish_status({"status": "error", "message": str(e)})

def predict_internal(motorcycle_id, brand, model):
    try:
        print(f"🔍 Predicting anomalies for motorcycle {motorcycle_id}, brand={brand}, model={model}")
        return detect_anomalies(
            motorcycle_id=str(motorcycle_id),
            brand=brand,
            model=model,
            mode="idle",
            minutes=30
        )
    except Exception as e:
        return {"status": "error", "message": f"Prediction failed: {str(e)}"}

# ───── Optional HTTP Routes for Testing ─────
@app.route("/start-obd", methods=["POST"])
def start_obd_route():
    motorcycle_id = request.json.get("motorcycle_id")
    threading.Thread(target=lambda: start_obd_internal(motorcycle_id), daemon=True).start()
    return jsonify({"message": "Starting OBD via HTTP"}), 200

@app.route("/stop-obd", methods=["GET"])
def stop_obd_route():
    stop_obd_internal()
    return jsonify({"message": "Stopping OBD via HTTP"}), 200

@app.route("/train_model", methods=["POST"])
def train_model_route():
    data = request.get_json()
    threading.Thread(
        target=lambda: train_model_internal(data["motorcycle_id"], data["brand"]),
        daemon=True
    ).start()
    return jsonify({"message": "Training started"}), 200

@app.route("/predict", methods=["POST"])
def predict_route():
    data = request.get_json()
    return jsonify(predict_internal(data["motorcycle_id"], data["brand"], data["model"]))

@app.route("/recent-data", methods=["POST"])
def recent_data_route():
    data = request.get_json()
    rows = get_recent_data(data["motorcycle_id"], int(data.get("minutes", 30)))
    return jsonify({"rows": rows})

@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(port=5000, debug=True)
