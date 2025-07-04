import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "./Profile.css";
import { toast, } from "react-toastify";


function Profile() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [user, setUser] = useState(null);
  const [selectedMotorcycle, setSelectedMotorcycle] = useState(null);

  useEffect(() => {
    const userId = localStorage.getItem("userId");
    const token = localStorage.getItem("token");

    if (!userId || !token) {
      toast.error("❌ You must be logged in.");
      navigate("/login");
      return;
    }

    // Fetch user details
    fetch(`${process.env.REACT_APP_API_URL}/get-user`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.user) {
          setUser(data.user);
        } else {
          throw new Error("User not found");
        }
      })
   .catch((err) => {
  console.error("❌ Error fetching user:", err);
  toast.error("Failed to fetch profile. Please log in again.");
  localStorage.clear();
  navigate("/login");
});


    // Load selected motorcycle from localStorage
    const moto = JSON.parse(localStorage.getItem("selectedMotorcycle"));
    if (moto) {
      setSelectedMotorcycle(moto);
    }
  }, [navigate]);

  const handleLogout = () => {
    localStorage.clear();
    navigate("/login");
  };

  if (!user) {
    return <div className="dashboardContent">Loading profile...</div>;
  }

  return (
    <div className="dashboardContainer">
      {!sidebarOpen && (
        <button className="hamburger" onClick={() => setSidebarOpen(true)}>
          ☰
        </button>
      )}

      <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="closeBtn" onClick={() => setSidebarOpen(false)}>
          ✖
        </button>

        <button className="profileBtn" onClick={() => navigate("/profile")}>
          <img
            src="https://static.vecteezy.com/system/resources/previews/025/267/725/non_2x/portrait-of-a-man-wearing-a-motocross-rider-helmet-and-wearing-a-sweater-side-view-suitable-for-avatar-social-media-profile-print-etc-flat-graphic-vector.jpg   " 
            alt="Profile"
            className="profileImage"
          />
          <h3 className="profileLabel">Profile</h3>
        </button>

        <button onClick={() => navigate("/dashboard")}>Dashboard</button>
        <button onClick={() => navigate("/reports")}>Reports</button>
        <button onClick={() => navigate("/predictivemaintenance")}>Preventive Maintenance</button>
          <button onClick={handleLogout}>Logout</button>
      </div>

      {sidebarOpen && (
        <div className="backdrop" onClick={() => setSidebarOpen(false)}></div>
      )}

      <div className="dashboardContent">
        <h2>My Profile</h2>

        <div className="profileCard">
          <div className="profileImageWrapper">
            <img
              src="https://static.vecteezy.com/system/resources/previews/025/267/725/non_2x/portrait-of-a-man-wearing-a-motocross-rider-helmet-and-wearing-a-sweater-side-view-suitable-for-avatar-social-media-profile-print-etc-flat-graphic-vector.jpg"
              alt="Profile"
              className="profileAvatar"
            />
          </div>

          <div className="profileInfo">
            <p><strong>First Name:</strong> {user.first_name}</p>
            <p><strong>Last Name:</strong> {user.last_name}</p>
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>Phone:</strong> {user.phone}</p>

            {selectedMotorcycle ? (
              <div className="motorcycleDetails">
                <h3>Motorcycle Info</h3>
                <p><strong>Brand:</strong> {selectedMotorcycle.brand}</p>
                <p><strong>Model:</strong> {selectedMotorcycle.model}</p>
                <p><strong>Year:</strong> {selectedMotorcycle.year}</p>
                <p><strong>Plate Number:</strong> {selectedMotorcycle.plate_number}</p>
              </div>
            ) : (
              <p>No motorcycle selected yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Profile;
