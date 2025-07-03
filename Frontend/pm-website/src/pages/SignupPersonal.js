import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./Signupmotorcycle.module.css";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function SignupMotorcycle() {
  const navigate = useNavigate();
  const [motorcycles, setMotorcycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registerNew, setRegisterNew] = useState(false);

  const [motorcycleData, setMotorcycleData] = useState({
    brand: "",
    model: "",
    year: "",
    plateNumber: "",
    odometer: "",
    lastOilChangeDate: "",
  });

  const brandModels = {
    Yamaha: ["Sniper 155", "Sniper 150", "Aerox 155", "Nmax 155", "Mio i125", "Mio Soul i125"],
    Honda: ["Beat FI", "Sonic RS 150FI", "Click i125", "ADV 160"],
    Suzuki: ["Raider 150FI", "GSX 150", "Smash 115FI", "Skydrive 125 FI"],
    Kawasaki: ["Rouser NS125 FI", "Ninja 250", "Rouser NS200 FI", "Brusky i125"],
  };

  const fetchMotorcycles = () => {
    const userId = localStorage.getItem("userId");
    const token = localStorage.getItem("token");

    fetch(`${process.env.REACT_APP_NODE_SERVER_URL}/get-motorcycles?userId=${userId}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => res.json())
      .then((data) => {
        setMotorcycles(data.motorcycles || []);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Failed to load motorcycles.");
        setLoading(false);
      });
  };

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    const token = localStorage.getItem("token");

    if (!userId || !token) {
      toast.error("Session expired. Please log in again.");
      navigate("/login");
      return;
    }

    fetchMotorcycles();
  }, [navigate]);

  const handleSelectMotorcycle = (motorcycle) => {
    localStorage.setItem("selectedMotorcycle", JSON.stringify(motorcycle));
    navigate("/dashboard");
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setMotorcycleData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const userId = localStorage.getItem("userId");
    if (!userId) {
      toast.error("Session expired. Please log in again.");
      navigate("/login");
      return;
    }

    const { brand, model, year, plateNumber, odometer, lastOilChangeDate } = motorcycleData;

    if (!brand || !model || !year || !plateNumber || odometer === "" || !lastOilChangeDate) {
      toast.warn("⚠️ Please fill in all fields.");
      return;
    }

    try {
      const response = await fetch(`${process.env.REACT_APP_NODE_SERVER_URL}/signup-motorcycle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          brand,
          model,
          year: parseInt(year, 10),
          plateNumber,
          odometer_km: parseInt(odometer, 10),
          last_oil_change: lastOilChangeDate,
          user_id: userId,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(data?.message || "✅ Motorcycle registered!");

        if (data.motorcycle) {
          localStorage.setItem("selectedMotorcycle", JSON.stringify(data.motorcycle));
          setTimeout(() => navigate("/dashboard"), 2000);
        } else {
          fetchMotorcycles();
          setRegisterNew(false);
        }
      } else {
        toast.error(data?.error || "❌ Signup failed. Please try again.");
      }
    } catch (error) {
      toast.error("🚫 Server error. Please try again.");
    }
  };

  const handleCancel = () => {
    if (motorcycles.length > 0) {
      setRegisterNew(false);
    } else {
      toast.info("No motorcycles registered. Returning to login.");
      localStorage.removeItem("userId");
      navigate("/login");
    }
  };

  return (
    <div className={styles.signupContainer}>
      <ToastContainer position="top-center" />
      <div className={styles.signupBox}>
        <h2>{motorcycles.length > 0 && !registerNew ? "Select Your Motorcycle" : "Register a New Motorcycle"}</h2>

        {loading ? (
          <p>Loading...</p>
        ) : motorcycles.length > 0 && !registerNew ? (
          <>
            {motorcycles.map((moto) => (
              <button
                key={moto.id}
                className={styles.motorcycleButton}
                onClick={() => handleSelectMotorcycle(moto)}
              >
                {moto.brand} {moto.model} ({moto.year})
              </button>
            ))}
            <button
              className={styles.registerNewButton}
              onClick={() => setRegisterNew(true)}
            >
              Register New Motorcycle
            </button>
          </>
        ) : (
          <form className={styles.signupForm} onSubmit={handleSubmit}>
            <label>Brand</label>
            <select name="brand" required onChange={handleChange} value={motorcycleData.brand}>
              <option value="">Select a Brand</option>
              {Object.keys(brandModels).map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>

            <label>Model</label>
            <select
              name="model"
              required
              disabled={!motorcycleData.brand}
              value={motorcycleData.model}
              onChange={handleChange}
            >
              <option value="">Select a Model</option>
              {motorcycleData.brand &&
                brandModels[motorcycleData.brand]?.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
            </select>

            <label>Year</label>
            <input
              type="number"
              name="year"
              placeholder="e.g., 2024"
              required
              value={motorcycleData.year}
              onChange={handleChange}
            />

            <label>Plate Number</label>
            <input
              type="text"
              name="plateNumber"
              placeholder="e.g., ABC-1234"
              required
              value={motorcycleData.plateNumber}
              onChange={handleChange}
            />

            <label>Odometer (km)</label>
            <input
              type="number"
              name="odometer"
              placeholder="e.g., 12000"
              required
              value={motorcycleData.odometer}
              onChange={handleChange}
            />

            <label>Date of Last Oil Change</label>
            <input
              type="date"
              name="lastOilChangeDate"
              required
              value={motorcycleData.lastOilChangeDate}
              onChange={handleChange}
            />

            <button className={styles.submitButton} type="submit">
              Submit
            </button>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default SignupMotorcycle;
