// src/pages/Dashboard.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";

function Dashboard() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login"); // redirect back to login
    } catch (err) {
      console.error("Logout failed", err.message);
    }
  };
//Home screen after login
  return (
    <div className="Dashboard-container">
      <h2>Welcome to the Dashboard </h2>
      <p>You are successfully logged in!</p>
      <button onClick={handleLogout}>Logout</button>
    </div>
  );
}

export default Dashboard;