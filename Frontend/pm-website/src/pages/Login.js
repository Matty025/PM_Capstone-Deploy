// pages/Login.js
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Login.css";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    if (!email || !password) {
      toast.warn("⚠️ Please enter your credentials");
      return;
    }

    try {
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }
      );

      const data = await response.json();

      if (response.ok) {
        if (data.userId) {
          localStorage.setItem("userId", data.userId);
          localStorage.setItem("token", data.token);

          toast.success("Login successful!", { autoClose: 2000 });

          setTimeout(() => {
            navigate("/signup-motorcycle");
          }, 2000);
        } else {
          toast.error("Unexpected server response. Please try again.");
        }
      } else {
        toast.error(data.error || data.message || "Login failed. Please try again.");
      }
    } catch (err) {
      toast.error("Error connecting to server. Please try again.");
    }
  };

  return (
    <div className="login-container">
      <ToastContainer position="top-center" />
      <div className="left-section">
        <h1>Welcome to Motorcycle Preventive Maintenance</h1>
        <h3>
          Ensure the longevity and performance of your motorcycle with our
          predictive maintenance system.
        </h3>
      </div>

      <div className="right-section">
        <div className="login-form">
          <h2>Login</h2>

          <input
            type="text"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button onClick={handleLogin}>Login</button>

          <p>
            Don’t have an account?{" "}
            <span
              onClick={() => navigate("/signup-personal")}
              style={{ color: "blue", cursor: "pointer", textDecoration: "underline" }}
            >
              Sign up
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Login;
