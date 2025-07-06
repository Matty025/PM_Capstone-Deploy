// All imports at the top
import mqtt from "mqtt";

// Constants
export const BASE_URL = process.env.REACT_APP_API_URL;
const brokerUrl = process.env.REACT_APP_MQTT_BROKER_URL;

// MQTT Client setup
const mqttClient = mqtt.connect(brokerUrl, {
  clientId: "react-" + Math.random().toString(16).substr(2, 8),
  protocol: "wss",            // 🔒 Force secure WebSocket
  reconnectPeriod: 1000,
  connectTimeout: 30 * 1000,
  clean: true,
});

mqttClient.on("connect", () => {
  console.log("✅ MQTT connected");
});

mqttClient.on("error", (err) => {
  console.error("❌ MQTT connection error:", err);
});

// Exports
export { mqttClient };
