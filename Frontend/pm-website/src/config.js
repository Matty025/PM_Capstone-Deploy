// config.js
import mqtt from "mqtt";

// Backend base URL (used for axios requests)
export const BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

// MQTT options
const options = {
  username: process.env.REACT_APP_MQTT_USERNAME,
  password: process.env.REACT_APP_MQTT_PASSWORD,
  reconnectPeriod: 5000,
  keepalive: 60,
  clean: true,
};

// Connect to EMQX over secure WebSocket (wss)
export const mqttClient = mqtt.connect(process.env.REACT_APP_MQTT_BROKER_URL, options);
