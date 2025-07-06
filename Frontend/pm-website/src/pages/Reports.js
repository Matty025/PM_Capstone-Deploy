import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import "react-toastify/dist/ReactToastify.css";
import "./Reports.css";
import normalRangesData from "./normal_ranges.json";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer, LabelList } from "recharts";
import { mqttClient } from "../config";

const Reports = () => {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [oilHistory, setOilHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [odoInput, setOdoInput] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [dailyReport, setDailyReport] = useState(null);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [reportType, setReportType] = useState("daily");
  const [nextDue, setNextDue] = useState({ date: "", km: 0 });

  const motorcycleRef = useRef(JSON.parse(localStorage.getItem("selectedMotorcycle")) || {});

  const closeSidebar = () => setSidebarOpen(false);
  const handleLogout = () => {
    localStorage.clear();
    navigate("/");
  };

  const calculateNextDue = (history) => {
    if (history.length === 0) return setNextDue({ date: "", km: 0 });
    const last = history[0];
    const lastDate = new Date(last.date_of_oil_change);
    const nextDate = new Date(lastDate);
    nextDate.setDate(lastDate.getDate() + 30);
    setNextDue({
      date: nextDate.toLocaleDateString(),
      km: last.odometer_at_change + 1000,
    });
  };

  const fetchOilHistory = useCallback(async () => {
    const motorcycle = motorcycleRef.current;
    if (!motorcycle?.id) {
      toast.error("No motorcycle selected.");
      navigate("/signup-motorcycle");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.get(
        `${process.env.REACT_APP_API_URL}/oil-history?motorcycle_id=${motorcycle.id}`
      );
      const data = res.data;
      setOilHistory(data);
      setErrorMsg("");
      calculateNextDue(data);
    } catch (err) {
      console.error(err);
      setErrorMsg("Could not fetch oil change history.");
      toast.error("Failed to fetch oil change history.");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const fetchReports = useCallback(() => {
    const motorcycle = motorcycleRef.current;
    if (!motorcycle?.id) return;

    const requestReport = (command) =>
      new Promise((resolve) => {
        const timeout = setTimeout(() => {
          mqttClient.removeListener("message", handler);
          resolve(null);
        }, 5000);

        const handler = (topic, message) => {
          try {
            const data = JSON.parse(message.toString());
            if (data.type === command) {
              mqttClient.removeListener("message", handler);
              clearTimeout(timeout);
              resolve(data.rows);
            }
          } catch (e) {
            console.error("Error parsing MQTT message", e);
          }
        };

        mqttClient.on("message", handler);
        mqttClient.subscribe("obd/status");
        mqttClient.publish("obd/command", JSON.stringify({
          command,
          motorcycle_id: motorcycle.id,
        }));
      });

    Promise.all([
      requestReport("report-daily"),
      requestReport("report-weekly"),
    ]).then(([daily, weekly]) => {
      if (!daily || !weekly) {
        toast.error("Failed to fetch engine reports.");
        return;
      }
      setDailyReport(daily);
      setWeeklyReport(weekly);
    });
  }, []);

  useEffect(() => {
    fetchOilHistory();
    fetchReports();

    return () => {
      mqttClient.unsubscribe("obd/status");
    };
  }, [fetchOilHistory, fetchReports]);

  const openModal = () => {
    setOdoInput("");
    setDateInput("");
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const motorcycle = motorcycleRef.current;
    if (!motorcycle?.id) return;

    const odometer_km = parseInt(odoInput, 10);
    if (isNaN(odometer_km)) {
      toast.warn("Enter a valid odometer number.");
      return;
    }

    const lastOdo = oilHistory[0]?.odometer_at_change || 0;
    if (odometer_km <= lastOdo) {
      toast.warn(`Odometer must be > ${lastOdo} km.`);
      return;
    }

    try {
      await axios.post(`${process.env.REACT_APP_API_URL}/oil-change`, {
        motorcycle_id: motorcycle.id,
        odometer_km,
        date_of_oil_change: dateInput || new Date().toISOString().split("T")[0],
      });

      toast.success("Oil change logged!");
      setModalOpen(false);
      fetchOilHistory();

      calculateNextDue([
        {
          date_of_oil_change: dateInput || new Date().toISOString().split("T")[0],
          odometer_at_change: odometer_km,
        },
        ...oilHistory,
      ]);

      const diff = odometer_km - lastOdo;
      if (diff >= 1000) toast.info("⛽ Time to change your oil (1000 km reached).");
    } catch (err) {
      console.error(err);
      toast.error("Failed to log oil change.");
    }
  };

  const handleExportPDF = () => {
    const reportSection = document.getElementById("report-content");
    if (!reportSection) return;
    html2canvas(reportSection).then((canvas) => {
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save("engine-report.pdf");
    });
  };

  const selectedReport = reportType === "daily" ? dailyReport : weeklyReport;
  const reportLabel = reportType === "daily" ? "Daily" : "Weekly";

  const reportData = selectedReport
    ? [
        { name: "RPM", value: selectedReport.rpm ?? 0, unit: " RPM" },
        { name: "Voltage", value: selectedReport.elm_voltage ?? 0, unit: " V" },
        { name: "Coolant Temp", value: selectedReport.coolant_temp ?? 0, unit: " °C" },
        { name: "Throttle Pos", value: selectedReport.throttle_pos ?? 0, unit: " %" },
        { name: "Engine Load", value: selectedReport.engine_load ?? 0, unit: " %" },
        { name: "Fuel Trim", value: selectedReport.long_fuel_trim_1 ?? 0, unit: " %" },
      ]
    : [];

  const motorcycle = motorcycleRef.current;
  const normalizedBrand = motorcycle.brand?.toLowerCase()?.replace(/\s+/g, "_");
  const normalizedModel = motorcycle.model?.toLowerCase()?.replace(/\s+/g, "_");
  const normalValues = normalRangesData?.[normalizedBrand]?.[normalizedModel] || {};

  const METRIC_LABELS = {
    rpm: "RPM",
    coolant_temp: "Coolant Temp",
    elm_voltage: "Voltage",
    throttle_pos: "Throttle Position",
    engine_load: "Engine Load",
    long_fuel_trim_1: "Long Fuel Trim",
  };

  return (
    <div className="dashboardContainers">
  <button
      className={`hamburger ${sidebarOpen ? "hide" : ""}`}
      onClick={() => setSidebarOpen(true)}
    >
      ☰
    </button>

    <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <button className="closeBtn" onClick={closeSidebar}>✖</button>
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
        <h2 className="reportTitle">Motorcycle Engine Reports</h2>

        <div className="reportSections" id="report-content">
          
          {/* 🔧 Oil History */}
          <div className="reportItem oilCard">
            <h3>Oil Change History</h3>
            {errorMsg && <p className="error">{errorMsg}</p>}
            {loading ? (
              <p>Loading oil change history...</p>
            ) : oilHistory.length === 0 ? (
              <p>No oil change history available.</p>
            ) : (
              <table className="oilTable">
                <thead>
                  <tr><th>Date of oil change</th><th>Odometer (km)</th></tr>
                </thead>
                <tbody>
                  {oilHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.date_of_oil_change).toLocaleDateString()}</td>
                      <td>{entry.odometer_at_change}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="logBtn" onClick={openModal}>
              Insert current Odometer and last oil change
            </button>

            {/* ⚠️ Maintenance Reminder */}
            {nextDue.km > 0 && (
              <div className="reminderCard">
                <strong>Next Oil Change Due:</strong><br />
                📅 {nextDue.date} or  {nextDue.km} km
              </div>
            )}
          </div>
{/* 📊 Engine Bar Chart */}
<div className="reportItem chartCard">
  <div style={{ display: "flex", justifyContent: "space-between" }}>
    <h3>Engine Averages ({reportLabel})</h3>
    <select
      value={reportType}
      onChange={(e) => setReportType(e.target.value)}
      style={{ padding: "6px", borderRadius: "6px" }}
    >
      <option value="daily">Daily</option>
      <option value="weekly">Weekly</option>
    </select>
  </div>
{reportData.length > 0 ? (
  <ResponsiveContainer width="100%" height={300}>
    <BarChart data={reportData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" />
      <YAxis
        domain={[0, (dataMax) => {
          if (dataMax > 1000) return dataMax + 500;
          else if (dataMax > 100) return dataMax + 50;
          else return dataMax + 10;
        }]}
      />
      <Tooltip
        formatter={(value, name, props) => {
          const unit = props.payload.unit || "";
          return [`${value}${unit}`, name];
        }}
      />
      <Legend />
      <Bar dataKey="value" fill="#4a90e2">
        <LabelList
          dataKey="value"
          position="top"
          formatter={(value, entry, index) => {
            const unit = reportData[index]?.unit || "";
            return `${value}${unit}`;
          }}
        />
      </Bar>
    </BarChart>
  </ResponsiveContainer>
) : (
  <p>Loading {reportLabel.toLowerCase()} report...</p>
)}
</div>

          {/* ✅ Maintenance Tips */}
          <div className="reportItem tipsCard">
            <h3>Maintenance Tips</h3>
           <ul>
  <li>Change oil every 1000–1500 km or once a month, whichever comes first.</li>
  <li>Let the engine warm up for 2–3 minutes before riding to avoid sudden wear.</li>
  <li>Check coolant levels weekly to prevent overheating and engine damage.</li>
  <li>Observe throttle response and engine load for signs of irregular performance.</li>
  <li>Maintain battery voltage around 14V when running; recharge if below 12V.</li>
  <li>Inspect air filter monthly; clean or replace if dusty or clogged.</li>
  <li>Check tire pressure regularly and adjust based on load and road conditions.</li>
  <li> For Manual Lubricate and clean the chain every 500–700 km to extend lifespan.</li>
  <li>Inspect brake pads and fluid levels to ensure safe stopping distance.</li>
  <li>Listen for unusual engine noises; they can indicate internal issues.</li>
</ul>

          </div>
{/* 📈 Normal Range Table */}
<div className="reportItem normalRangeCard">
  <h3>📈 Normal Operating Ranges</h3>
  {Object.keys(normalValues).length > 0 ? (
    <table className="normalTable">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Expected Range</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(normalValues).map(([key, val]) => {
          let unit = "";

          if (key.includes("temp")) unit = "°C";
          else if (key.includes("voltage")) unit = "V";
          else if (key.includes("rpm")) unit = " RPM";
          else if (key.includes("throttle")) unit = "%";
          else if (key.includes("engine_load")) unit = "%";
          else if (key.includes("fuel_trim")) unit = "%";
          else if (key.includes("odometer")) unit = " km";

          const label = METRIC_LABELS[key] || key.replace(/_/g, " ");

          return (
            <tr key={key}>
              <td>{label}</td>
              <td>
                {val.warning_min ?? "-"}
                {unit} - {val.warning_max ?? "-"}
                {unit}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  ) : (
    <p>No normal range data found for this motorcycle.</p>
  )}
</div>

        </div>
      </div>

      <button className="exportBtn" onClick={handleExportPDF}>
        Export PDF
      </button>

      {/* Modal */}
      {modalOpen && (
        <div className="modalOverlay">
          <div className="modalContent">
            <h3>Log Oil Change</h3>
            <label>Current Odometer (km)</label>
            <input type="number" value={odoInput} onChange={(e) => setOdoInput(e.target.value)} />
            <label>Date of Oil Change</label>
            <input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} />
            <div className="modalButtons">
              <button onClick={handleSubmit} style={{ backgroundColor: "green", color: "white" }}>
                Submit
              </button>
              <button className="cancelBtn" onClick={() => setModalOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer position="top-right" autoClose={3000} hideProgressBar />
    </div>
  );
};

export default Reports;
