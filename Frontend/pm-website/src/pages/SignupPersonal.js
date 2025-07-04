// pages/SignupPersonal.js
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function SignupPersonal() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { fullName, email, password } = formData;

    if (!fullName || !email || !password) {
      toast.warn("⚠️ All fields are required.");
      return;
    }

    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/signup-personal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success("✅ Signup successful!");
        setTimeout(() => navigate("/login"), 2000);
      } else {
        toast.error(data.error || "Signup failed. Try again.");
      }
    } catch (error) {
      toast.error("🚫 Server error. Please try again later.");
    }
  };

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <ToastContainer position="top-center" />
      <h2>Sign Up - Personal Info</h2>
      <form onSubmit={handleSubmit} style={{ maxWidth: "400px", margin: "0 auto" }}>
        <input
          type="text"
          name="fullName"
          placeholder="Full Name"
          value={formData.fullName}
          onChange={handleChange}
          required
        /><br /><br />
        <input
          type="email"
          name="email"
          placeholder="Email Address"
          value={formData.email}
          onChange={handleChange}
          required
        /><br /><br />
        <input
          type="password"
          name="password"
          placeholder="Password"
          value={formData.password}
          onChange={handleChange}
          required
        /><br /><br />
        <button type="submit">Sign Up</button>
      </form>
    </div>
  );
}

export default SignupPersonal;
