import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import bcrypt from "bcryptjs";

function ResetPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const { username } = location.state || {};

  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");

  const validatePassword = (pwd) => {
    const regex =
      /^(?=[A-Za-z])(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return regex.test(pwd);
  };

  const handleReset = async () => {
    if (!validatePassword(newPassword)) {
      setError(
        "Password must be at least 8 characters, start with a letter, and include a letter, number, and special character."
      );
      return;
    }

    try {
      // Fetch user to check password history
      const userRef = doc(db, "users", username);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        setError("User not found.");
        return;
      }

      const userData = userSnap.data();
      const passwordHistory = userData.passwordHistory || [];

      // Check against ALL passwords in history
      for (const oldHash of passwordHistory) {
        // Handle both hashed and plain text passwords
        const isHashed = oldHash.startsWith("$2a$") || oldHash.startsWith("$2b$");
        const matchesOld = isHashed 
          ? await bcrypt.compare(newPassword, oldHash)
          : newPassword === oldHash;
        
        if (matchesOld) {
          setError("You cannot reuse a previous password.");
          return;
        }
      }

      // Also check current password if not already in history
      if (!passwordHistory.includes(userData.password)) {
        const isHashed = userData.password.startsWith("$2a$") || userData.password.startsWith("$2b$");
        const matchesCurrent = isHashed
          ? await bcrypt.compare(newPassword, userData.password)
          : newPassword === userData.password;
        
        if (matchesCurrent) {
          setError("You cannot reuse your current password.");
          return;
        }
      }

      // Hash the new password
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
    
      alert("Password reset successfully. Please log in.");
      navigate("/");
    } catch (err) {
      console.error("Error resetting password:", err);
      setError("Error resetting password.");
    }
  };
//Display for user to reset password
  return (
    <div>
      <h2>Reset Password for {username}</h2>
      <input
        type="password"
        placeholder="New Password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <button onClick={handleReset}>Reset</button>
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

export default ResetPassword;