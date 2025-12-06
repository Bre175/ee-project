// src/pages/AdminLogin.jsx
import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(""); 
  const navigate = useNavigate();

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please fill in both email and password.");
      return;
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;
    
      // Get user data from Firestore to check their role
      const userRef = doc(db, "users", user.email);
      const userSnap = await getDoc(userRef);
    
      if (userSnap.exists()) {
        const userData = userSnap.data();
    
        // Store user info in localStorage
        localStorage.setItem("loggedInUser", user.email);
        localStorage.setItem("userRole", userData.role); // "Admin" or "Manager"
    
        // Redirect based on role
        if (userData.role === "Admin") {
          navigate("/admin-home");
        } else if (userData.role === "Manager") {
          navigate("/manager-home");
        } else {
          setError("Unauthorized access.");
        }
      } else {
        setError("User not found in database.");
      }
    } catch (error) {
      console.error("Login error:", error);
      setError("Failed to sign in. Please check credentials.");
    }
  }    

  return (
    <div style={{ maxWidth: "400px", margin: "50px auto" }}>
      <h2>Admin Login</h2>
      <form onSubmit={handleAdminLogin}>
        <input
          type="email"
          placeholder="Admin Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ display: "block", margin: "10px 0", width: "100%" }}
        />
        <input
          type="password"
          placeholder="Admin Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ display: "block", margin: "10px 0", width: "100%" }}
        />
        <button type="submit">Login as Admin</button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

export default AdminLogin;