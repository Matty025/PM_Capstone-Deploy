  import React, { useEffect, useState, useCallback } from "react";
  import mqtt from "mqtt";
  import { useNavigate } from "react-router-dom";
  import { Line } from "react-chartjs-2";
  import axios from "axios";
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
  import "./Dashboard.css";
// 🔁 Place this with other imports
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { PYTHON_SERVER_URL } from "../config";

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

    // Add ENGINE_LOAD and use key names matching MQTT payload exactly
    const [obdData, setObdData] = useState({
      RPM: 0,
      COOLANT_TEMP: 0,
      ELM_VOLTAGE: 0,
      ENGINE_LOAD: 0,
      THROTTLE_POS: 0,
      LONG_TERM_FUEL_TRIM: 0, // <- this is ltfl
    });

    // Include ENGINE_LOAD and THROTTLE_POS keys here as well
    const [chartData, setChartData] = useState({
      RPM: { labels: [], data: [] },
      COOLANT_TEMP: { labels: [], data: [] },
      ELM_VOLTAGE: { labels: [], data: [] },
      ENGINE_LOAD: { labels: [], data: [] },
      THROTTLE_POS: { labels: [], data: [] },
      LONG_TERM_FUEL_TRIM: { labels: [], data: [] }, // <- this is the chart

    });

    useEffect(() => {
      const storedMotorcycle = localStorage.getItem("selectedMotorcycle");
      if (!storedMotorcycle) {
        alert("No motorcycle selected. Redirecting...");
        navigate("/signup-motorcycle");
      } else {
        setMotorcycle(JSON.parse(storedMotorcycle));
      }
    }, [navigate]);

    const updateChartData = useCallback((data) => {
      const newTime = new Date().toLocaleTimeString();

      setChartData((prevData) => ({
        RPM: {
          labels: [...prevData.RPM.labels, newTime].slice(-20),
          data: [...prevData.RPM.data, Number(data.RPM || 0).toFixed(2)].slice(-20),
        },
        COOLANT_TEMP: {
          labels: [...prevData.COOLANT_TEMP.labels, newTime].slice(-20),
          data: [...prevData.COOLANT_TEMP.data, Number(data.COOLANT_TEMP || 0).toFixed(2)].slice(-20),
        },
        ELM_VOLTAGE: {
          labels: [...prevData.ELM_VOLTAGE.labels, newTime].slice(-20),
          data: [...prevData.ELM_VOLTAGE.data, Number(data.ELM_VOLTAGE || 0).toFixed(2)].slice(-20),
        },
        ENGINE_LOAD: {
          labels: [...prevData.ENGINE_LOAD.labels, newTime].slice(-20),
          data: [...prevData.ENGINE_LOAD.data, Number(data.ENGINE_LOAD || 0).toFixed(2)].slice(-20),
        },
        THROTTLE_POS: {
          labels: [...prevData.THROTTLE_POS.labels, newTime].slice(-20),
          data: [...prevData.THROTTLE_POS.data, Number(data.THROTTLE_POS || 0).toFixed(2)].slice(-20),
        },
        LONG_TERM_FUEL_TRIM: {
          labels: [...prevData.LONG_TERM_FUEL_TRIM.labels, newTime].slice(-20),
          data: [...prevData.LONG_TERM_FUEL_TRIM.data, Number(data.LONG_TERM_FUEL_TRIM || 0).toFixed(2)].slice(-20),
        },

      }));
    }, []);


       useEffect(() => {
          const client = mqtt.connect("wss://broker.hivemq.com:8884/mqtt", {
        reconnectPeriod: 5000,
        keepalive: 60,
      });

      client.on("connect", () => {
        console.log("Connected to MQTT broker");
        client.subscribe("obd/data");
      });

      client.on("message", (topic, message) => {
        if (topic === "obd/data") {
          const rawMessage = message.toString();
          console.log("Raw MQTT message:", rawMessage);

          try {
            const payload = JSON.parse(rawMessage);
            console.log("Parsed payload:", payload);

            if (payload.motorcycle_id === String(motorcycle?.id)) {
              const data = payload.data || {};

              // Match exact keys from MQTT data
              const normalizedData = {
            RPM: data.RPM || 0,
            COOLANT_TEMP: data.COOLANT_TEMP || 0,
            ELM_VOLTAGE: data.ELM_VOLTAGE || 0,
            ENGINE_LOAD: data.ENGINE_LOAD || 0,
            THROTTLE_POS: data.THROTTLE_POS ?? 0,
            LONG_TERM_FUEL_TRIM: data.LONG_FUEL_TRIM_1 ?? 0, // <-- map it here
  };


              setObdData(normalizedData);
              updateChartData(normalizedData);
            } else {
              console.log("Received data for another motorcycle:", payload.motorcycle_id);
            }
          } catch (error) {
            console.error("MQTT parse error:", error);
          }
        }
      });

      return () => {
        client.end();
      };
    }, [motorcycle, updateChartData]);

const handleStartOBD = async () => {
  toast.info("🔄 Starting OBD connection...");
 
  
  try {
    const res = await axios.post(`${PYTHON_SERVER_URL}/start-obd`, {
      motorcycle_id: motorcycle?.id,
    }, {
      withCredentials: true, // Add this if your Flask server uses CORS with credentials
    });

    console.log("OBD start response:", res.data);
    toast.success("✅ OBD data collection started.");
    const msg = res.data?.message || "";

    if (res.status === 200) {
      if (msg.includes("already running")) {
        toast.success("✅ OBD is already running.");
      } else if (msg.includes("started")) {
        toast.success("✅ OBD started successfully!");
      } else {
        toast.info("ℹ️ " + msg);
      }
    } else {
      toast.warn("⚠️ Unexpected response. Retrying...");

      // Optional retry logic
      setTimeout(async () => {
        try {
            const retryRes = await axios.post(`${PYTHON_SERVER_URL}/start-obd`, {
            motorcycle_id: motorcycle?.id,
          });
          const retryMsg = retryRes.data?.message || "";
          if (retryRes.status === 200) {
            toast.success("✅ Retry success: " + retryMsg);
          } else {
            toast.error("❌ Retry failed.");
          }
        } catch {
          toast.error("🚫 Retry failed. Backend unreachable.");
        }
      }, 2000);
    }
  } catch (err) {
    console.error("Start OBD error:", err);
    toast.error("❌ Failed to connect to backend.");
  }
};

const handleStopOBD = async () => {
  toast.info("🛑 Stopping OBD connection...");
  try {
    const res = await axios.get(`${PYTHON_SERVER_URL}/stop-obd`);
    const msg = res.data?.message || "";

    if (msg.includes("stopped")) {
      toast.success("✅ OBD stopped successfully.");
    } else {
      toast.info("ℹ️ " + msg); // e.g., "No running OBD data collection process"
    }
  } catch (err) {
    console.error("Stop OBD error:", err);
    toast.error("❌ Could not stop OBD. Backend error.");
  }
};



    const handleLogout = () => {
      localStorage.clear();
      navigate("/");
    };

const renderChart = (label, key) => {
  const colorMap = {
    RPM: "#3b82f6",                  // Blue
    COOLANT_TEMP: "#10b981",         // Green
    ELM_VOLTAGE: "#f59e0b",          // Amber
    THROTTLE_POS: "#6366f1",         // Indigo
    ENGINE_LOAD: "#ec4899",          // Pink
    LONG_TERM_FUEL_TRIM: "#ef4444",  // Red
  };

    const backgroundMap = {
    RPM: "rgba(59, 130, 246, 0.1)",
    COOLANT_TEMP: "rgba(16, 185, 129, 0.1)",
    ELM_VOLTAGE: "rgba(245, 158, 11, 0.1)",
    THROTTLE_POS: "rgba(99, 102, 241, 0.1)",
    ENGINE_LOAD: "rgba(236, 72, 153, 0.1)",
    LONG_TERM_FUEL_TRIM: "rgba(239, 68, 68, 0.1)",
  };
    const borderColor = colorMap[key] || "#007bff";
  const backgroundColor = backgroundMap[key] || "rgba(255, 255, 255, 0.1)";

  return (
    <div className="chartBox" key={key}>
      <h3>{label}</h3>
      <Line
        data={{
          labels: chartData[key].labels,
          datasets: [
            {
              label: label,
              data: chartData[key].data,
              borderColor: borderColor,
              backgroundColor: backgroundColor,
              tension: 0.4,
              fill: true,
            },
          ],
        }}
        options={{
          responsive: true,
          plugins: { legend: { display: true }, title: { display: false } },
          scales: { y: { beginAtZero: true } },
        }}
      />
    </div>
  );
};

return (
  
<div className="dashboardContainer">
<ToastContainer position="top-center" />


        <button
          className={`hamburger ${sidebarOpen ? "hide" : ""}`}
          onClick={() => setSidebarOpen(true)}
        >
          ☰
        </button>

        <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <button className="closeBtn" onClick={() => setSidebarOpen(false)}>
            ✖
          </button>

          <button className="profileBtn" onClick={() => navigate("/profile")}>
            <img
              src="https://static.vecteezy.com/system/resources/previews/025/267/725/non_2x/portrait-of-a-man-wearing-a-motocross-rider-helmet-and-wearing-a-sweater-side-view-suitable-for-avatar-social-media-profile-print-etc-flat-graphic-vector.jpg"
              alt="Profile"
              className="profileImage"
            />
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
            <button onClick={handleStopOBD} style={{ backgroundColor: "red" }}>
              Stop OBD
            </button>
          </div>  
  <div className="currentValues">
    <div className="valueCard">
      <span className="label">RPM</span>
      <span className="value">{Number(obdData.RPM).toFixed(2)}</span>
    </div>
    <div className="valueCard">
      <span className="label">Coolant</span>
      <span className="value">{Number(obdData.COOLANT_TEMP).toFixed(2)} °C</span>
    </div>
    <div className="valueCard">
      <span className="label">Voltage</span>
      <span className="value">{Number(obdData.ELM_VOLTAGE).toFixed(2)} V</span>
    </div>
    <div className="valueCard">
      <span className="label">Throttle Position</span>
      <span className="value">{Number(obdData.THROTTLE_POS).toFixed(2)} %</span>
    </div>
    <div className="valueCard">
      <span className="label">Engine Load</span>
      <span className="value">{Number(obdData.ENGINE_LOAD).toFixed(2)} %</span>
    </div>
    <div className="valueCard">
      <span className="label">Fuel Trim</span>
      <span className="value">{Number(obdData.LONG_TERM_FUEL_TRIM).toFixed(2)} %</span>
    </div>
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
