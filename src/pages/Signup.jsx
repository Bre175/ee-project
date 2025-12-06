// src/pages/Signup.jsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import bcrypt from "bcryptjs";
import logo from "../assets/EELogo.jpg";

// Import Firestore
import { db } from "../firebase";
import { doc, setDoc, getDoc, collection, addDoc } from "firebase/firestore";

function Signup() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [address, setAddress] = useState("");
  const [dob, setDob] = useState("");
  const [username, setUsername] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("city");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Auto-generate username
  useEffect(() => {
    if (firstName && lastName && dob) {
      const date = new Date();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = String(date.getFullYear()).slice(-2);
      const uname =
        firstName.charAt(0).toLowerCase() +
        lastName.toLowerCase() +
        month +
        year;
      setUsername(uname);
    } else {
      setUsername("");
    }
  }, [firstName, lastName, dob]);

  // Password validation regex
  const passwordPattern = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

  const handleSignup = async (e) => {
    e.preventDefault();
//test all feilds are filled out
    if (
      !firstName ||
      !lastName ||
      !email ||
      !password ||
      !confirmPassword ||
      !address ||
      !dob ||
      !securityAnswer
    ) {
      setError("All fields are required.");
      return;
    }

    // Email validation
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    // Password validation
    if (!passwordPattern.test(password) || !/^[A-Za-z]/.test(password)) {
      setError(
        "Password must be at least 8 characters, start with a letter, and include a letter, number, and special character."
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!username) {
      setError("Username could not be generated.");
      return;
    }

    try {
      // Check if username already exists in Firestore
      const userRef = doc(db, "users", username);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        setError("Username already exists. Try again.");
        return;
      }

      // Encrypt password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Save to pendingUsers collection
      await setDoc(doc(db, "pendingUsers", username), {
        firstName,
        lastName,
        email,
        username,
        password: hashedPassword,
        address,
        dob,
        role: "Accountant",
        status: "pending",
        securityQuestion,
        securityAnswer,
        timestamp: Date.now()
      });

      // Send message to admin inbox
      await addDoc(collection(db, "messages"), {
        from: "SYSTEM",
        to: "bross0925",
        subject: "New Account Signup Request",
        body: `${firstName} ${lastName} (${username}) has requested a new account.`,
        timestamp: Date.now()
      });

      console.log("Signup successful", { username, email });

      setError("");
      setSubmitted(true);
    } catch (err) {
      console.error("Error signing up:", err);
      setError("Something went wrong. Please try again.");
    }
  };
  //Display page for user to be able to interact and sign up
  return (
    <div className="auth-container signup-container">
      <img src={logo} alt="Equity Experts Logo" className="auth-logo" />

      <h2>Create Account</h2>
      {submitted ? (
        <p style={{ color: "green", fontWeight: "500" }}>
          Your request has been submitted and is under review by the administrator.
        </p>
      ) : (
        <form onSubmit={handleSignup}>
          <input
            type="text"
            placeholder="First Name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Last Name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
          <input
            type="email"
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
          <input
            type="password"
            placeholder="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <input
            type="text"
            placeholder="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
          />
          <input type="text" placeholder="Username" value={username} readOnly />

          {/* Security Question Dropdown */}
          <select
            value={securityQuestion}
            onChange={(e) => setSecurityQuestion(e.target.value)}
            className="auth-input"
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
          />

          {error && <p className="error-text">{error}</p>}
          <button type="submit" style={{ width: "300px" }}>Sign Up</button>
        </form>
      )}
      {!submitted && (
        <p>
          Already have an account?{" "}
          <span
            onClick={() => navigate("/")}
            style={{ cursor: "pointer", color: "#4f46e5", fontWeight: "500" }}
          >
            Log in
          </span>
        </p>
      )}
    </div>
  );
}

export default Signup;