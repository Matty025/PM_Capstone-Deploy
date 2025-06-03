import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import SignupPersonal from "./pages/SignupPersonal";
import SignupMotorcycle from "./pages/SignupMotorcycle";
import Dashboard from "./pages/Dashboard";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Alerts from "./pages/Alerts";
import PredictiveMaintenance from "./pages/PredictiveMaintenance";
import Profile from "./pages/Profile";
import "./App.css";

function App() {
  return (
    <Router>
      <div className="appContainer">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup-personal" element={<SignupPersonal />} />
          <Route path="/signup-motorcycle" element={<SignupMotorcycle />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/predictivemaintenance" element={<PredictiveMaintenance />} />
          <Route path="/profile" element={<Profile />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
