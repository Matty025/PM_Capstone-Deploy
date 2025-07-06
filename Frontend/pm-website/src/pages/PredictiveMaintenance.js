  import React, { useState, useEffect, useRef } from "react";
  import { useNavigate } from "react-router-dom";
  import axios from "axios";
  import {
    PieChart,
    Pie,
    Cell,
    Legend,
    ResponsiveContainer,
  } from "recharts";
  import jsPDF from "jspdf";
  import html2canvas from "html2canvas";
  import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    BarChart,   
    Bar,  
  } from "recharts";
  import { toast, ToastContainer } from "react-toastify";
  import "react-toastify/dist/ReactToastify.css";
  import RowAnomalyLineChart from "./RowAnomalyLineChart";
import { mqttClient as client } from "../config"; // ✅ use the exported client
import { BASE_URL } from "../config"; // or wherever your config.js is located


  import "./PredictiveMaintenance.css";

  function PredictiveMaintenance() {
    const navigate = useNavigate();
    const [minutes, setMinutes] = useState(30);
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState([]);
    const [analysis, setAnalysis] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [uploadedFile, setUploadedFile] = useState(null);
    const [useUploadedFile, setUseUploadedFile] = useState(false);
useEffect(() => {
  const selected = JSON.parse(localStorage.getItem("selectedMotorcycle"));
  if (!selected) {
    toast.error("❌ No motorcycle selected.");
    navigate("/signup-motorcycle");
    return;
  }

  fetchRows(selected.motorcycle_id || selected.id, minutes);
}, [minutes, navigate]);
//this is forthe recent data 
const fetchRows = async (motorcycle_id, mins, { silent = false } = {}) => {
  if (!silent) setLoading(true);
  try {
    const { data } = await axios.post(`${BASE_URL}/recent-data`, {
      motorcycle_id,
      minutes: mins,
    });
    if (data.status === "ok") {
      setRows(data.rows);
      setAnalysis(null);
    }
  } catch (err) {
    console.error(err);
    toast.error("❌ Failed to load data.");
  } finally {
    if (!silent) setLoading(false);
  }
};

      
  useEffect(() => {
    if (!useUploadedFile) {
      setAnalysis(null);        // ✅ clear old CSV-based analysis
      setRows([]);              // optional: reset rows
      setUploadedFile(null);    // ✅ clear uploaded file too
    }
  }, [useUploadedFile]);

  // use effect and for run prediction 
useEffect(() => {
  if (!client) return;

  const handleMessage = (topic, message) => {
    try {
      if (topic === "obd/status") {
        const payload = JSON.parse(message.toString());

        if (payload?.status === "error") {
          toast.error(`❌ ${payload.message}`);
          setLoading(false);
          return;
        }

        if (payload.type === "predict-from-csv") {
          setAnalysis(payload.result);
          setRows([]);
          toast.success("✅ Analysis complete using uploaded CSV");
        }

        if (payload.type === "predict") {
          setAnalysis(payload);
          setRows([]);
          toast.success("✅ Analysis complete using live data");
        }

        setLoading(false);
      }
    } catch (err) {
      console.error("❌ MQTT message handling error:", err);
      toast.error("❌ Invalid MQTT response");
      setLoading(false);
    }
  };

  const handleConnect = () => {
    console.log("✅ MQTT connected");
    toast.success("📡 Connected to EMQX MQTT broker");
    client.subscribe("obd/status");
  };

  const handleError = (err) => {
    console.error("❌ MQTT error", err);
    toast.error("MQTT connection error");
  };

  const handleClose = () => {
    toast.warn("⚠️ MQTT disconnected");
  };

  client.on("connect", handleConnect);
  client.on("error", handleError);
  client.on("close", handleClose);
  client.on("message", handleMessage);

  return () => {
    client.off("connect", handleConnect);
    client.off("error", handleError);
    client.off("close", handleClose);
    client.off("message", handleMessage);
  };
}, []);

    const runPrediction = () => {
      if (!client || !client.connected) {
        toast.error("❌ MQTT not connected");
        return;
      }

      const selected = JSON.parse(localStorage.getItem("selectedMotorcycle"));
      const id = selected?.motorcycle_id || selected?.id;
      const brand = selected?.brand?.toLowerCase().replace(/\s+/g, "_");
      const model = selected?.model?.toLowerCase().replace(/\s+/g, "_");

      if (!id || !brand || !model) {
        toast.error("❌ Missing motorcycle info.");
        return;
      }

      setLoading(true);
      setAnalysis(null);
      setRows([]);

      toast.info("🔍 Starting analysis...");

      try {
        if (uploadedFile && useUploadedFile) {
          toast.info("📁 Using uploaded CSV file for analysis.");

const reader = new FileReader();
reader.onload = () => {
  const base64String = reader.result.split(',')[1]; // remove "data:text/csv;base64,"
  client.publish("obd/command", JSON.stringify({
    command: "predict-from-csv",
    motorcycle_id: id,
    brand,
    model,
    file_base64: base64String,
  }));
  toast.info("📤 Sent file for analysis via MQTT.");
};
reader.readAsDataURL(uploadedFile);  // ✅ more robust and compatible

        } else {
          setUploadedFile(null);
          setUseUploadedFile(false);

          toast.info("📡 Using recent sensor data (InfluxDB)...");
          client.publish("obd/command", JSON.stringify({
            command: "predict",
            motorcycle_id: id,
            brand,
            model,
          }));
        }
      } catch (err) {
        console.error("❌ Prediction failed:", err);
        toast.error("❌ Prediction failed. See console for details.");
        setLoading(false);
      }
    };

  const saveRecentDataAsCSV = () => {
    if (!rows.length) {
      toast.warning("⚠️ No data available to export.");
      return;
    }

    const headers = Object.keys(rows[0]);
    const csvRows = [
      headers.join(","), // header row
      ...rows.map(row => headers.map(h => row[h]).join(",")) // data rows
    ];

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "recent_obd_data.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


   const handleTrainModel = async () => {
  const selected = JSON.parse(localStorage.getItem("selectedMotorcycle"));
  const motorcycle_id = selected?.motorcycle_id || selected?.id;
  const brand = selected?.brand;

  if (!motorcycle_id || !brand) {
    toast.warning("⚠️ Missing motorcycle info.");
    return;
  }

  try {
    const res = await axios.post(`${BASE_URL}/train_model`, {
      motorcycle_id,
      brand,
    });

    toast.success("✅ Model trained successfully!");
    console.log(res.data.message);
  } catch (err) {
    console.error(err);
    toast.error("❌ Training failed. Check server logs.");
  }
};


  const exportPDF = () => {
    const input = document.getElementById("analysis-report");
    if (!input) return toast.error("❌ No analysis report found to export.");

    html2canvas(input, { scale: 2 }).then((canvas) => {
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      // First page
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      // Additional pages
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      pdf.save("analysis_report.pdf");
    });
  };

    const statusBreakdown = analysis?.explanations?.reduce(
    (acc, e) => {
      if (e.status) acc[e.status]++;
      return acc;
    },
    { normal: 0, warning: 0, critical: 0 }
  ) ?? { normal: 0, warning: 0, critical: 0 };

  const pieData = [
    { name: "Normal", value: statusBreakdown.normal },
    { name: "Warning", value: statusBreakdown.warning },
    { name: "Critical", value: statusBreakdown.critical },
  ];

  const featureDisplayNames = {
    rpm: "RPM",
    coolant_temp: "Coolant Temperature",
    elm_voltage: "ELM Voltage",
    engine_load: "Engine Load",
    throttle_pos: "Throttle Position",
    long_fuel_trim_1: "Fuel Trim",
  };
  const fileInputRef = useRef(null);
  
  const getFeatureAnomalySummary = (rowAnomalies = []) => {
    const summary = {};
    rowAnomalies.forEach((row) => {
      Object.entries(row.severity || {}).forEach(([feature, status]) => {
        if (status === "normal" || status === "unknown") return;

        if (!summary[feature]) {
          summary[feature] = { warning: 0, critical: 0 };
        }
        summary[feature][status]++;
      });
    });
    return summary;
  };
  const statusEmoji = {
    normal: "🟢",
    warning: "🟡",
    critical: "🔴",
    unknown: "⚪",
  };

  const statusColor = {
    normal: "text-green-600",
    warning: "text-yellow-600",
    critical: "text-red-600",
    unknown: "text-gray-400",
  };

  const progressColor = {
    normal: "#22c55e",   // green
    warning: "#eab308",  // yellow
    critical: "#ef4444", // red
    unknown: "#9ca3af",  // gray (you can pick a hex for gray-400)
  };


  return (
    <div className="dashboardContainer">
      <ToastContainer position="top-right" autoClose={4000} hideProgressBar={false} newestOnTop closeOnClick pauseOnFocusLoss draggable pauseOnHover />

      <button
        className={`hamburger ${sidebarOpen ? "hide" : ""}`}
        onClick={() => setSidebarOpen(true)}
      >
        ☰
      </button>

      <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="closeBtn" onClick={() => setSidebarOpen(false)}>✖</button>
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
        <button onClick={() => {
          localStorage.clear();
          navigate("/");
        }}>Logout</button>
      </div>

      <div className="dashboardContent space-y-6">
        <div className="toolbar">
          <h2 className="toolbar-title">Preventive Maintenance</h2>
          <div className="toolbar-group">
            <label className="toolbar-label">
              Last
              <input
                type="number"
                className="toolbar-input"
                value={minutes}
                min={1}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
              min
            </label>

            <button className="btn" onClick={saveRecentDataAsCSV}>📥 Download CSV</button>
    <button
    className="btn"
    onClick={() => {
      const sel = JSON.parse(localStorage.getItem("selectedMotorcycle"));
      if (sel) fetchRows(sel.motorcycle_id || sel.id, minutes);

      // Clear uploaded file states
      setUploadedFile(null);
      setUseUploadedFile(false);

      // Manually clear the file input field
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      // Also clear analysis result just to be safe
      setAnalysis(null);
    }}
  >
    🔄 Refresh
  </button>


            <button className="btn primary" onClick={handleTrainModel}>💾 Train Idle Model</button>
            <button className="btn analyze" onClick={runPrediction}>🔍 Analyze</button>
          </div>
        </div>

        <div className="csvUploadContainer">
          <input
    type="file"
    accept=".csv"
    ref={fileInputRef}
    onChange={(e) => setUploadedFile(e.target.files[0])}
  />
    
          <label>
            <input
              type="checkbox"
              checked={useUploadedFile}
              onChange={(e) => setUseUploadedFile(e.target.checked)}
            />
            Use uploaded CSV for analysis
          </label>
        </div>

        {rows.length > 0 && !analysis && (
          <div className="mainDashboardGrid">
            <div className="cardPanel">
              <h3 className="sectionTitle">📊 Sensor Trends (Last {minutes} min)</h3>

            <ResponsiveContainer width="100%" height={300}>
    <LineChart data={rows.slice(-50)}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="_time" tickFormatter={(t) => new Date(t).toLocaleTimeString()} />
      <YAxis />
      <Tooltip />
      <Legend />
      <Line type="monotone" dataKey="rpm" stroke="#6366f1" dot={false} name={featureDisplayNames["rpm"]} />
      <Line type="monotone" dataKey="coolant_temp" stroke="#22c55e" dot={false} name={featureDisplayNames["coolant_temp"]} />
      <Line type="monotone" dataKey="elm_voltage" stroke="#f97316" dot={false} name={featureDisplayNames["elm_voltage"]} />
      <Line type="monotone" dataKey="engine_load" stroke="#3b82f6" dot={false} name={featureDisplayNames["engine_load"]} />
      <Line type="monotone" dataKey="throttle_pos" stroke="#ec4899" dot={false} name={featureDisplayNames["throttle_pos"]} />
      <Line type="monotone" dataKey="long_fuel_trim_1" stroke="#10b981" dot={false} name={featureDisplayNames["long_fuel_trim_1"]} />
    </LineChart>
  </ResponsiveContainer>

            </div>

            <div className="cardPanel">
              <h3 className="sectionTitle">🧠 Ready for Analysis</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                This data was recorded from the last <strong>{minutes} minutes</strong>.<br />
                Click <strong>🔍 Analyze</strong> to run machine learning prediction on your motorcycle's behavior.
              </p>
              <div className="mt-4 border-l-4 border-yellow-400 bg-yellow-100 p-3 text-yellow-800 text-sm rounded shadow">
                🛠 Tip: Make sure your motorcycle is in warm idle (70–85°C) for best results.
              </div>
            </div>
          </div>
        )}

      {loading ? (
    <p>Loading…</p>
  ) : analysis ? (
    <>
      {/* ✅ START: Wrap analysis content for PDF export */}
      <div id="analysis-report">
        <div className="sectionWrapper">

          <h3 className="text-xl font-semibold mb-4 text-center">🧠 ML Analysis Summary</h3>
  <p className="text-xs italic text-gray-600 mt-3 text-center">
    📊 <strong>Note:</strong> Bar and pie charts summarize <u>average sensor values</u>.  
    See row-level anomalies below for detailed critical/warning readings.
  </p>

              <div className="flex gap-3 mb-6 justify-center">
                <span className="statusChip normal">✅ Normal: {statusBreakdown?.normal}</span>
                <span className="statusChip warning">⚠️ Warning: {statusBreakdown?.warning}</span>
                <span className="statusChip critical">❗ Critical: {statusBreakdown?.critical}</span>
              </div>

  <ResponsiveContainer width="100%" height={260}>
    <PieChart>
      <Pie
        data={pieData}
        cx="50%"
        cy="50%"
        innerRadius={50}
        outerRadius={90}
        label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(1)}%)`}
        labelLine={false}
        dataKey="value"
      >
        {pieData.map((entry) => (
          <Cell
            key={entry.name}
            fill={
              entry.name === "Normal"
                ? "#10b981" // Green
                : entry.name === "Warning"
                ? "#facc15" // Yellow
                : "#ef4444" // Red
            }
          />
        ))}
      </Pie>
      <Legend verticalAlign="bottom" iconType="circle" />
    </PieChart>
  </ResponsiveContainer>

  <ResponsiveContainer width="100%" height={300} className="mt-6">
    <BarChart
      data={analysis.explanations?.map((item) => ({
        name: featureDisplayNames[item.feature] || item.feature,
        status: item.status === "critical" ? 3 : item.status === "warning" ? 2 : 1,
        severity: item.status
      }))}
    >
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" />
      <YAxis
        ticks={[1, 2, 3]}
        domain={[0, 3]}
        tickFormatter={(val) =>
          val === 1 ? "Normal" : val === 2 ? "Warning" : "Critical"
        }
      />
      <Tooltip
        formatter={(value, name, props) => {
          const statusMap = { 1: "Normal", 2: "Warning", 3: "Critical" };
          return statusMap[value];
        }}
      />
      <Bar dataKey="status">
        {analysis.explanations?.map((entry, index) => {
          const fillColor =
            entry.status === "critical"
              ? "#ef4444"
              : entry.status === "warning"
              ? "#facc15"
              : "#10b981";
          return <Cell key={`bar-${index}`} fill={fillColor} />;
        })}
      </Bar>
    </BarChart>
    
  </ResponsiveContainer>

    <h4 className="text-lg font-semibold mt-6 mb-2 text-center">
      🔧 Feature Health Check
    </h4>

    <p className="text-sm text-gray-600 text-center mb-4 max-w-xl mx-auto">
      Each component's severity score is based on anomalies detected during analysis.
      <br />
      <strong>💡 The lower the score, the healthier the component.</strong>
    </p>

  <div className="feature-health-check-container">
    {analysis?.explanations?.map((item, i) => {
      const emoji = statusEmoji[item.status] || "⚪";
      const textColor = statusColor[item.status];
      const barColor = progressColor[item.status];
      const displayName = featureDisplayNames[item.feature] || item.feature;

      return (
        <div
          key={i}
          className={`feature-card ${textColor}`}
          style={{ minHeight: "110px" }}
        >
          <h4 className="feature-title">
            {emoji} {displayName}
          </h4>
          <p className="feature-score">
            Score: <strong>{item.severity_score}%</strong>
          </p>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{ width: `${item.severity_score}%`, backgroundColor: barColor }}
            />
          </div>
          <p className="feature-tip">{item.tip}</p>
        </div>
      );
    })}
  </div>


  {analysis?.row_anomalies?.length > 0 && (
    <>
  <div className="centered-anomaly-summary">
    <h4>🧪 Rows Anomaly Summary</h4>
    <ul>
      {Object.entries(getFeatureAnomalySummary(analysis.row_anomalies)).map(([feature, counts]) => (
        <li key={feature}>
          <strong>{featureDisplayNames[feature] || feature}:</strong>{" "}
          {counts.warning} warning, {counts.critical} critical anomalies
        </li>
      ))}
    </ul>
    <p>
      From {analysis.row_anomalies.length} anomalous rows analyzed
    </p>
  </div>



      {/* Grid container for charts */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <RowAnomalyLineChart rowAnomalies={analysis.row_anomalies} feature="rpm" />
        <RowAnomalyLineChart rowAnomalies={analysis.row_anomalies} feature="elm_voltage" />
        <RowAnomalyLineChart rowAnomalies={analysis.row_anomalies} feature="coolant_temp" />
        <RowAnomalyLineChart rowAnomalies={analysis.row_anomalies} feature="engine_load" />
        <RowAnomalyLineChart rowAnomalies={analysis.row_anomalies} feature="long_fuel_trim_1" />
        <RowAnomalyLineChart rowAnomalies={analysis.row_anomalies} feature="throttle_pos" />
      </div>
    </>
  )}

            </div>

                  </div> {/* ✅ Close analysis-report */}
          <button onClick={exportPDF} className="download-pdf-btn">
    🧾 Download PDF Report
  </button>

          </>
        ) : rows.length ? (
          <div className="cardPanel tablePanel">
            <h3 className="sectionTitle">🧾 Recent Sensor Data</h3>
            <div className="overflow-x-auto">
              <table className="recentTable">
              <thead>
                <tr>
                {Object.keys(rows[0]).map((h) => (
                <th key={h}>{featureDisplayNames[h] || h}</th>
                    ))}
              </tr>
                </thead>

                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {Object.values(r).map((v, j) => (
                        <td key={j}>
                          {j === 0 ? new Date(v).toLocaleString() : v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p>No data in selected window.</p>
        )}
      </div>
    </div>
  );


  }

  export default PredictiveMaintenance;
