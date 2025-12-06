import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import bcrypt from "bcryptjs";
import logo from "../assets/EELogo.jpg";
import { db } from "../firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";


function Login({ role: propRole }) {
  const navigate = useNavigate();
  const { role: routeRole } = useParams();
  const role = routeRole || propRole || "Accountant";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  

  // Validation rules
  const usernamePattern = /^[a-z][a-z]+[0-9]{4}$/i;
  const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!username || !password) {
      setError("Both username and password are required.");
      return;
    }

    if (!usernamePattern.test(username)) {
      setError("Invalid username format.");
      return;
    }

    if (!passwordPattern.test(password) || !/^[A-Za-z]/.test(password)) {
      setError("Password must meet complexity rules.");
      return;
    }

    try {
      // Fetch user from Firestore
      const userRef = doc(db, "users", username);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        setError("User not found.");
        return;
      }

      const user = userSnap.data();

      // Normalize role capitalization
      user.role = (user.role || "").trim();
      user.role =
        user.role.charAt(0).toUpperCase() + user.role.slice(1).toLowerCase();

      // Check if user is already inactive/suspended
      if (!user.active) {
        setError("Your account has been suspended. Please contact an administrator.");
        return;
      }

      // Check for date-based suspension
      const today = new Date().toISOString().split("T")[0];
      if (user.suspendStart && user.suspendEnd && 
          today >= user.suspendStart && today <= user.suspendEnd) {
        setError("Your account is temporarily suspended. Please try again later.");
        return;
      }

      // Compare hashed or plain text password
      const passwordMatch =
        user.password.startsWith("$2a$") || user.password.startsWith("$2b$")
          ? await bcrypt.compare(password, user.password)
          : password === user.password;

      if (!passwordMatch) {
        // Increment failed attempts in Firestore (Admins exempt)
        if (user.role !== "Administrator") {
          const currentAttempts = (user.failedLoginAttempts || 0) + 1;
          
          if (currentAttempts >= 3) {
            // Suspend user after 3 failed attempts
            const today = new Date().toISOString().split("T")[0];
            // Set suspension end date far in future (admin must manually clear)
            const farFuture = "2099-12-31";
            
            await updateDoc(userRef, {
              failedLoginAttempts: currentAttempts,
              suspendStart: today,
              suspendEnd: farFuture,
              suspendedReason: "Too many failed login attempts"
            });
            setError("Your account has been suspended due to 3 failed login attempts. Please contact an administrator.");
          } else {
            await updateDoc(userRef, {
              failedLoginAttempts: currentAttempts
            });
            setError(`Incorrect password. ${3 - currentAttempts} attempt(s) remaining.`);
          }
        } else {
          setError("Incorrect password.");
        }
        return;
      }

      // Password correct - reset failed attempts
      if (user.failedLoginAttempts > 0) {
        await updateDoc(userRef, { failedLoginAttempts: 0 });
      }

      // Password expiry check (UTC-normalized) - Admins exempt
      if (user.role !== "Administrator" && user.passwordExpiry) {
        const expiryMillis = user.passwordExpiry?.seconds
          ? user.passwordExpiry.seconds * 1000
          : Number(user.passwordExpiry);

        if (!isNaN(expiryMillis)) {
          const now = new Date();
          const nowUTC = Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate()
          );

          const expiryDate = new Date(expiryMillis);
          const expiryUTC = Date.UTC(
            expiryDate.getUTCFullYear(),
            expiryDate.getUTCMonth(),
            expiryDate.getUTCDate()
          );

          if (nowUTC > expiryUTC) {
            setError("Your password has expired. Please reset your password.");
            return;
          }

          // 3-day warning - send in-app message
          const threeDays = 3 * 24 * 60 * 60 * 1000;
          if (expiryUTC - nowUTC <= threeDays && expiryUTC > nowUTC) {
            // Check if we already sent a warning today to avoid duplicates
            const lastWarning = user.lastExpiryWarning || 0;
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            
            if (lastWarning < oneDayAgo) {
              // Send in-app message
              const { addDoc, collection } = await import("firebase/firestore");
              await addDoc(collection(db, "messages"), {
                from: "System",
                to: username,
                subject: "Password Expiring Soon",
                body: `Your password will expire on ${expiryDate.toLocaleDateString()}. Please reset your password within the next 3 days to avoid losing access to your account.`,
                timestamp: Date.now(),
                type: "system-password-warning"
              });
              
              // Update last warning timestamp
              await updateDoc(userRef, { lastExpiryWarning: Date.now() });
            }
            
            // Also show warning on login
            setError("Warning: Your password will expire in less than 3 days. Please reset it soon.");
            // Don't return - let them continue logging in
          }
        }
      }

      // Save logged in user to localStorage for session use
      localStorage.setItem("loggedInUser", user.username);
      localStorage.setItem("userRole", user.role);

      console.log(`${user.role} login successful:`, user.username);

      // Redirect based on role
      switch (user.role) {
        case "Administrator":
          navigate("/admin-home");
          break;
        case "Manager":
          navigate("/manager-home");
          break;
        case "Accountant":
          navigate("/accountant-home");
          break;
        default:
          navigate("/dashboard");
          break;
      }

    } catch (err) {
      console.error("Login error:", err);
      setError("Something went wrong. Please try again.");
    }
  };
//Display for Login to occure 
  return (
    <div className="auth-container">
      <img src={logo} alt="Equity Experts Logo" className="auth-logo" />
      
      <h2>{role} Login</h2>
      <form onSubmit={handleLogin}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <button type="submit" style={{ width: "250px" }}>Login</button>
      </form>

      {/* Forgot password link */}
      <p
        onClick={() => navigate("/forgot-password")}
        style={{ cursor: "pointer", color: "#4f46e5", marginTop: "0.5rem" }}
      >
        Forgot Password?
      </p>

      {/* Only accountants see signup option */}
      {role === "Accountant" && (
        <p>
          Don’t have an account?{" "}
          <span
            onClick={() => navigate("/signup")}
            style={{ cursor: "pointer", color: "#4f46e5", fontWeight: "500" }}
          >
            Sign up
          </span>
        </p>
      )}

      {/* Dropdown for other logins */}
      <div>
        <p
          onClick={() => setShowDropdown(!showDropdown)}
          style={{
            cursor: "pointer",
            color: "#4f46e5",
            fontWeight: "500",
            marginTop: "1rem",
          }}
        >
          Sign in as a different user {showDropdown ? "▲" : "▼"}
        </p>

        {showDropdown && (
          <div style={{ marginTop: "0.5rem" }}>
            <p
              onClick={() => navigate("/login/Accountant")}
              style={{ cursor: "pointer", color: "#111827" }}
            >
              Accountant Login
            </p>
            <p
              onClick={() => navigate("/login/Manager")}
              style={{ cursor: "pointer", color: "#111827" }}
            >
              Manager Login
            </p>
            <p
              onClick={() => navigate("/login/Administrator")}
              style={{ cursor: "pointer", color: "#111827" }}
            >
              Administrator Login
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;