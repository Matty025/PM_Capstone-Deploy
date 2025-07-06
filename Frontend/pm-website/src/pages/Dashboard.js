import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { mqttClient as client } from "../config";
import "./Dashboard.css";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const Dashboard = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [motorcycle, setMotorcycle] = useState(null);

  const [obdData, setObdData] = useState({
    RPM: 0,
    COOLANT_TEMP: 0,
    ELM_VOLTAGE: 0,
    ENGINE_LOAD: 0,
    THROTTLE_POS: 0,
    LONG_TERM_FUEL_TRIM: 0,
  });

  const [chartData, setChartData] = useState({
    RPM: { labels: [], data: [] },
    COOLANT_TEMP: { labels: [], data: [] },
    ELM_VOLTAGE: { labels: [], data: [] },
    ENGINE_LOAD: { labels: [], data: [] },
    THROTTLE_POS: { labels: [], data: [] },
    LONG_TERM_FUEL_TRIM: { labels: [], data: [] },
  });

  useEffect(() => {
    const storedMotorcycle = localStorage.getItem("selectedMotorcycle");
    if (!storedMotorcycle) {
      toast.warning("⚠️ No motorcycle selected. Redirecting...");
      navigate("/signup-motorcycle");
    } else {
      setMotorcycle(JSON.parse(storedMotorcycle));
    }
  }, [navigate]);

  const updateChartData = useCallback((data) => {
    const newTime = new Date().toLocaleTimeString();

    setChartData((prevData) => {
      const update = {};
      for (let key in prevData) {
        update[key] = {
          labels: [...prevData[key].labels, newTime].slice(-20),
          data: [...prevData[key].data, Number(data[key] || 0).toFixed(2)].slice(-20),
        };
      }
      return update;
    });
  }, []);

  useEffect(() => {
    if (!client) return;

    const handleConnect = () => {
      console.log("✅ Connected to MQTT broker");
      client.subscribe("obd/data");
      client.subscribe("obd/status");
    };

    const handleMessage = (topic, message) => {
      const rawMessage = message.toString();

      if (topic === "obd/status") {
        try {
          const statusPayload = JSON.parse(rawMessage);
          const status = statusPayload.status || "";
          const msg = statusPayload.message || "";

          if (status === "started") toast.success("✅ OBD started successfully.");
          else if (status === "stopped") toast.success("🛑 OBD stopped successfully.");
          else if (status === "error") toast.error("❌ " + msg);
          else toast.info("ℹ️ " + msg);
        } catch (err) {
          console.error("Failed to parse obd/status message:", err);
        }
        return;
      }

      if (topic === "obd/data") {
        try {
          const payload = JSON.parse(rawMessage);
          if (payload.motorcycle_id === String(motorcycle?.id)) {
            const data = payload.data || {};
            const normalized = {
              RPM: data.RPM || 0,
              COOLANT_TEMP: data.COOLANT_TEMP || 0,
              ELM_VOLTAGE: data.ELM_VOLTAGE || 0,
              ENGINE_LOAD: data.ENGINE_LOAD || 0,
              THROTTLE_POS: data.THROTTLE_POS ?? 0,
              LONG_TERM_FUEL_TRIM: data.LONG_FUEL_TRIM_1 ?? 0,
            };
            setObdData(normalized);
            updateChartData(normalized);
          }
        } catch (err) {
          console.error("Failed to parse obd/data message:", err);
        }
      }
    };

    client.on("connect", handleConnect);
    client.on("message", handleMessage);

    return () => {
      client.off("connect", handleConnect);
      client.off("message", handleMessage);
    };
  }, [motorcycle, updateChartData]);

  const handleStartOBD = () => {
    if (!motorcycle?.id) return toast.warning("⚠️ No motorcycle selected.");
    if (!client?.connected) return toast.error("❌ MQTT not connected.");

    toast.info("🔄 Sending start-obd command...");
    client.publish("obd/command", JSON.stringify({
      command: "start-obd",
      motorcycle_id: motorcycle.id,
    }), (err) => {
      if (err) toast.error("❌ Failed to send command.");
      else toast.success("📡 Start command sent.");
    });
  };

  const handleStopOBD = () => {
    if (!client?.connected) return toast.error("❌ MQTT not connected.");

    toast.info("🛑 Sending stop-obd command...");
    client.publish("obd/command", JSON.stringify({ command: "stop-obd" }), (err) => {
      if (err) toast.error("❌ Failed to send stop command.");
      else toast.success("📡 Stop command sent.");
    });
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate("/");
  };

  const renderChart = (label, key) => {
    const colors = {
      RPM: "#3b82f6",
      COOLANT_TEMP: "#10b981",
      ELM_VOLTAGE: "#f59e0b",
      ENGINE_LOAD: "#ec4899",
      THROTTLE_POS: "#6366f1",
      LONG_TERM_FUEL_TRIM: "#ef4444",
    };

    const bgColors = {
      RPM: "rgba(59,130,246,0.1)",
      COOLANT_TEMP: "rgba(16,185,129,0.1)",
      ELM_VOLTAGE: "rgba(245,158,11,0.1)",
      ENGINE_LOAD: "rgba(236,72,153,0.1)",
      THROTTLE_POS: "rgba(99,102,241,0.1)",
      LONG_TERM_FUEL_TRIM: "rgba(239,68,68,0.1)",
    };

    return (
      <div className="chartBox" key={key}>
        <h3>{label}</h3>
        <Line
          data={{
            labels: chartData[key].labels,
            datasets: [{
              label,
              data: chartData[key].data,
              borderColor: colors[key],
              backgroundColor: bgColors[key],
              tension: 0.4,
              fill: true,
            }],
          }}
          options={{
            responsive: true,
            plugins: { legend: { display: true } },
            scales: { y: { beginAtZero: true } },
          }}
        />
      </div>
    );
  };

  return (
    <div className="dashboardContainer">
      <ToastContainer position="top-center" />
      <button className={`hamburger ${sidebarOpen ? "hide" : ""}`} onClick={() => setSidebarOpen(true)}>☰</button>

      <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="closeBtn" onClick={() => setSidebarOpen(false)}>✖</button>
        <button className="profileBtn" onClick={() => navigate("/profile")}>
          <img src="https://static.vecteezy.com/system/resources/previews/025/267/725/non_2x/portrait-of-a-man-wearing-a-motocross-rider-helmet-and-wearing-a-sweater-side-view-suitable-for-avatar-social-media-profile-print-etc-flat-graphic-vector.jpg" alt="Profile" className="profileImage" />
          <h3 className="profileLabel">Profile</h3>
        </button>
        <button onClick={() => navigate("/dashboard")}>Dashboard</button>
        <button onClick={() => navigate("/Reports")}>Reports</button>
        <button onClick={() => navigate("/predictivemaintenance")}>Preventive Maintenance</button>
        <button onClick={handleLogout}>Logout</button>
      </div>

      <div className="dashboardContent">
        <h1>OBD Real-Time Dashboard</h1>
        <div className="buttonGroup">
          <button onClick={handleStartOBD}>Start OBD</button>
          <button onClick={handleStopOBD} style={{ backgroundColor: "red" }}>Stop OBD</button>
        </div>

        <div className="currentValues">
          {Object.entries(obdData).map(([key, value]) => (
            <div className="valueCard" key={key}>
              <span className="label">{key.replace(/_/g, " ")}</span>
              <span className="value">{Number(value).toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div className="chartGrid">
          {renderChart("RPM", "RPM")}
          {renderChart("Coolant Temp", "COOLANT_TEMP")}
          {renderChart("Voltage", "ELM_VOLTAGE")}
          {renderChart("Throttle Position", "THROTTLE_POS")}
          {renderChart("Engine Load", "ENGINE_LOAD")}
          {renderChart("Long Term Fuel Trim", "LONG_TERM_FUEL_TRIM")}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
