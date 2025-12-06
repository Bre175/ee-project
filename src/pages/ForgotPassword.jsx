// src/pages/ForgotPassword.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import bcrypt from "bcryptjs";

// Firebase imports
import { db } from "../firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("city");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Password validation rules
  const passwordPattern =
    /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z][A-Za-z\d@$!%*?&]{7,}$/;

  // Username format: first initial + full last name + MMYY
  const usernamePattern = /^[a-z][a-z]+[0-9]{4}$/i;

  const handleReset = async (e) => {
    e.preventDefault();

    if (!email || !username || !securityAnswer || !newPassword) {
      setError("All fields are required.");
      return;
    }

    // Username validation
    if (!usernamePattern.test(username)) {
      setError("Invalid username format. Use first initial + last name + MMYY.");
      return;
    }

    // Password validation
    if (!passwordPattern.test(newPassword)) {
      setError(
        "Password must be at least 8 characters, start with a letter, and include a letter, number, and special character."
      );
      return;
    }

    try {
      // Look up user in Firestore
      const userRef = doc(db, "users", username);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        setError("User not found.");
        return;
      }

      const userData = userSnap.data();

      // Check email matches
      if (userData.email !== email) {
        setError("Email does not match our records.");
        return;
      }

      // Check security question + answer
      if (
        userData.securityQuestion !== securityQuestion ||
        userData.securityAnswer.toLowerCase() !== securityAnswer.toLowerCase()
      ) {
        setError("Security question or answer is incorrect.");
        return;
      }

      // Prevent reusing the old password
      const passwordMatch = await bcrypt.compare(newPassword, userData.password);
      if (passwordMatch) {
        setError("You cannot reuse your previous password.");
        return;
      }

      // Check against ALL passwords in history, not just current
      const passwordHistory = userData.passwordHistory || [];
      for (const oldHash of passwordHistory) {
        const matchesOld = await bcrypt.compare(newPassword, oldHash);
        if (matchesOld) {
          setError("You cannot reuse a previous password.");
          return;
        }
      }

      // Also check current password if not in history
      if (!passwordHistory.includes(userData.password)) {
        const matchesCurrent = await bcrypt.compare(newPassword, userData.password);
        if (matchesCurrent) {
          setError("You cannot reuse your current password.");
          return;
        }
      }

      // Encrypt new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Calculate 90-day expiry (UTC midnight)
      const nowUTC = Date.now();
      const ninetyDays = 90 * 24 * 60 * 60 * 1000;
      const expiryDate = new Date(nowUTC + ninetyDays);
      const expiryUTC = Date.UTC(
        expiryDate.getUTCFullYear(),
        expiryDate.getUTCMonth(),
        expiryDate.getUTCDate()
      );

      // Update password history (keep last 5 passwords)
      const updatedHistory = [hashedPassword, ...passwordHistory].slice(0, 5);

      await updateDoc(userRef, { 
        password: hashedPassword,
        passwordLastChanged: nowUTC,
        passwordExpiry: expiryUTC,
        passwordHistory: updatedHistory
      });

      setError("");
      setSuccess("Your password has been reset successfully.");
    } catch (err) {
      console.error("Error resetting password:", err);
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <div className="auth-container">
      <h2>Reset Password</h2>
      {success ? (
        <p style={{ color: "green", fontWeight: "500" }}>{success}</p>
      ) : (
        <form onSubmit={handleReset}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "80%" }}
          />
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: "80%" }}
          />

          {/* Dropdown styled same as inputs */}
          <select
            value={securityQuestion}
            onChange={(e) => setSecurityQuestion(e.target.value)}
            className="auth-input"
            style={{ width: "80%" }}
          >
            <option value="city">In which city were you born?</option>
            <option value="pet">What is the name of your first pet?</option>
            <option value="school">What was the name of your first school?</option>
            <option value="mother">What is your mother’s maiden name?</option>
          </select>

          <input
            type="text"
            placeholder="Security Answer"
            value={securityAnswer}
            onChange={(e) => setSecurityAnswer(e.target.value)}
            style={{ width: "80%" }}
          />
          <input
            type="password"
            placeholder="NewPassword"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ width: "80%" }}
          />

          {error && <p className="error-text">{error}</p>}
          <button type="submit" style={{ width: "80%" }}>
            Reset Password
          </button>
        </form>
      )}
      <p
        onClick={() => navigate("/")}
        style={{ cursor: "pointer", color: "#4f46e5", marginTop: "1rem" }}
      >
        Back to Login
      </p>
    </div>
  );
}

export default ForgotPassword;