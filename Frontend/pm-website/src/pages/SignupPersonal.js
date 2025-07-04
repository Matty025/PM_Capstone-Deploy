import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import styles from "./Signup.module.css"; 

function SignupPersonal() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSignup = async () => {
    const { firstName, lastName, email, phone, password, confirmPassword } = formData;

    if (!firstName || !lastName || !email || !phone || !password || !confirmPassword) {
      toast.warn("⚠️ All fields are required.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("❌ Passwords do not match.");
      return;
    }
    

    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/signup-personal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: `${firstName} ${lastName}`,
          email,
          phone,
          password,
        }),
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
    <div className={styles.signupContainer}>
      <ToastContainer position="top-center" />
      <div className={styles.signupBox}>
        <h2>Sign Up</h2>
        <form onSubmit={(e) => e.preventDefault()}>
          <input
            className={styles.input}
            type="text"
            name="firstName"
            placeholder="First Name"
            required
            onChange={handleChange}
          />
          <input
            className={styles.input}
            type="text"
            name="lastName"
            placeholder="Last Name"
            required
            onChange={handleChange}
          />
          <input
            className={styles.input}
            type="email"
            name="email"
            placeholder="Email (e.g., example@gmail.com)"
            required
            onChange={handleChange}
          />
          <input
            className={styles.input}
            type="tel"
            name="phone"
            placeholder="Phone Number (e.g., 09xxxxxxxxx)"
            required
            onChange={handleChange}
          />
          <input
            className={styles.input}
            type="password"
            name="password"
            placeholder="Password"
            required
            onChange={handleChange}
          />
          <input
            className={styles.input}
            type="password"
            name="confirmPassword"
            placeholder="Confirm Password"
            required
            onChange={handleChange}
          />
          <button
            className={styles.button}
            type="button"
            onClick={handleSignup}
          >
            Sign Up
          </button>
          <button
            className={styles.cancelButton}
            type="button"
            onClick={() => navigate("/login")}
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}

export default SignupPersonal;
