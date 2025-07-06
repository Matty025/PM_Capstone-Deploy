// src/config.js
export const BASE_URL = process.env.REACT_APP_API_URL;
// src/config.js
import mqtt from "mqtt";

const brokerUrl = process.env.REACT_APP_MQTT_BROKER_URL;

const mqttClient = mqtt.connect(brokerUrl, {
  clientId: "react-" + Math.random().toString(16).substr(2, 8),
  clean: true,
  reconnectPeriod: 1000,
  connectTimeout: 30 * 1000,
});

mqttClient.on("connect", () => {
  console.log("✅ MQTT connected");
});

mqttClient.on("error", (err) => {
  console.error("❌ MQTT connection error:", err);
});

export { mqttClient };
