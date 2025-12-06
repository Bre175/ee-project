/* src/pages/AdminHome.jsx
*
* Main dashboard page for users with the "Administrator" role. Provides functionality for:
*   - Financial Ratios Dashboard: View key financial metrics
*   - User Management: Create, edit, activate/deactivate, and suspend users
*   - Pending User Approvals: Approve or reject new signup requests
*   - Chart of Accounts: Create, edit, deactivate, and view accounts
*   - In-app Messaging: Send/receive messages to/from users
*   - Viewing event logs
*   - Viewing expiration reports
*/


// IMPORTS................................................................................................................................................................................................
 
// React core hooks
import React, { useState, useEffect } from "react";

// Custom components
import Header from "../components/Header";

// Firebase Firestore database instance
import { db } from "../firebase";

// Firestore functions for CRUD operations and real-time subscriptions
import {
  collection,       // Reference to a Firestore collection
  onSnapshot,       // Real-time listener for data changes
  setDoc,           // Set document data (with custom ID)
  updateDoc,        // Update existing document
  doc,              // Reference to a specific document
  getDoc,           // Fetch single document
  addDoc,           // Create new document with auto-generated ID
  deleteDoc,        // Delete a document
} from "firebase/firestore";

// Default profile picture asset
import profilePic from "../assets/ProfilePic.jpg";

// React Router hooks for navigation and URL state
import { Link } from "react-router-dom";
import { useLocation } from "react-router-dom";


// HELPER FUNCTIONS (Outside Component)....................................................................................................................................................................

// Generate username: firstInitial + lastName + MMYY
const generateUsername = (firstName, lastName) => {
  if (!firstName || !lastName) return "";
  const now = new Date(); 
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  return `${firstName[0].toLowerCase()}${lastName.toLowerCase()}${mm}${yy}`;
};

// Extract username from system signup body,
// e.g. "alyssa yen (ayen1125) has requested a new account."
const extractUsernameFromBody = (body = "") => {
  const start = body.indexOf("(");
  const end = body.indexOf(")");
  if (start === -1 || end === -1 || end <= start + 1) return "";
  return body.slice(start + 1, end).trim();
};


// FINANCIAL RATIO HELPERS.................................................................................

// Sum accounts by category/subcategory/statement type
const sumBy = (accounts, filterFn) => {
  return accounts
    .filter(filterFn)
    .reduce((sum, acc) => sum + Number(acc.balance || 0), 0);
};

// Color coding based on thresholds
const getColor = (value, good, warn) => {
  if (value >= good) return "ratio-green";
  if (value >= warn) return "ratio-yellow";
  return "ratio-red";
};

// Tooltip wrapper- wraps child elements with a hover tooltip for additional context
const Tooltip = ({ text, children }) => (
  <div className="tooltip-container">
    {children}
    <div className="tooltip-box">{text}</div>
  </div>
);

// PASSWORD SECURITY........................................................................................

// Hashes a password using SHA-256
async function hashPassword(pw) {
  const enc = new TextEncoder().encode(pw);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}


// MAIN COMPONENT: AdminHome................................................................................................................................................................................

function AdminHome() {

  // STATE VARIABLES - User & Navigation...................................................................

  // Current logged-in accountant's information; loaded from Firestore on component mount based on localStorage
  const [adminUser, setAdminUser] = useState({
    username: "Admin", // default until Firestore loads
    profilePic: profilePic,
  });


  // STATE VARIABLES - User Management......................................................................

  //User information setup on page
  const [users, setUsers] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [newUser, setNewUser] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    address: "",
    dob: "",
    username: "",
    role: "Accountant",
  });

  // Validation errors for the Create User form 
  const [errors, setErrors] = useState({});

  // Success/status message for user operations 
  const [message, setMessage] = useState("");

  // Currently active navigation tab; persisted to localStorage so it survives page refreshes
  const [activeTab, setActiveTab] = useState(() => {
    const savedTab = localStorage.getItem("adminActiveTab");
    return savedTab || "Dashboard";
  });  
  
  // User currently being edited in the modal; null when no user is being edited
  const [editingUser, setEditingUser] = useState(null);


  // STATE VARIABLES - Messages.............................................................................

  // All messages from the messages collection 
  const [messages, setMessages] = useState([]);

  // Currently selected message for detailed view
  const [selectedMessage, setSelectedMessage] = useState(null); 

  // Controls visibility of compose message modal
  const [composeMode, setComposeMode] = useState(false);
  
  // Track which message IDs have been approved/rejected
  const [processedMessages, setProcessedMessages] = useState({});

  // Current sub-tab in Messages: "Inbox" or "Sent" 
  const [activeSubTab, setActiveSubTab] = useState("Inbox");

  // Controls visibility of the compose message modal
  const [showCompose, setShowCompose] = useState(false);

  // Compose form state: recipient, subject, and body
  const [compose, setCompose] = useState({ to: "", subject: "", body: "" });

  // Error message for compose form validation
  const [errorMessage, setErrorMessage] = useState("");


  // CHART OF ACCOUNTS STATE - Account data for financial operations........................................

  // Controls visibility of account creation form 
  const [showAccountForm, setShowAccountForm] = useState(false);

  // Form state for account creation
  const [accountform, setAccountForm] = useState({
    accountName: "",
    accountNumber: "",
    accountDescription: "",
  });

  // All accounts from the Chart of Accounts
  const [accounts, setAccounts] = useState([]);


  // DERIVED FINANCIAL VALUES - Calculated from accounts for dashboard ratios................................

  // Sum of all Current Assets (used for Current Ratio and Quick Ratio)
  const currentAssets = sumBy(accounts, acc =>
    acc.accountSubcategory === "Current Assets"
  );

  // Sum of all Current Liabilities (used for ratio calculations)
  const currentLiabilities = sumBy(accounts, acc =>
    acc.accountSubcategory === "Current Liabilities"
  );

  // Quick assets (most liquid assets for Quick Ratio calculation)
  const cash = sumBy(accounts, acc => acc.accountName === "Cash");
  const shortTermInvestments = sumBy(accounts, acc => acc.accountNumber === "170");
  const accountsReceivable = sumBy(accounts, acc => acc.accountName === "Accounts Receivable");

  // Total revenue from Income Statement accounts (Credit normal side)
  const revenue = sumBy(accounts, acc =>
    acc.statementType === "IS" && acc.normalSide === "Credit"
  );

  // Total expenses from Income Statement accounts (Debit normal side)
  const expenses = sumBy(accounts, acc =>
    acc.statementType === "IS" && acc.normalSide === "Debit"
  );

  // Net Income = Revenue - Expenses 
  const netIncome = revenue - expenses;

  // Total Assets from Balance Sheet (Debit normal side accounts)
  const totalAssets = sumBy(accounts, acc =>
    acc.statementType === "BS" && acc.normalSide === "Debit"
  );

  // Total Liabilities from Balance Sheet 
  const totalLiabilities = sumBy(accounts, acc =>
    acc.statementType === "BS" && acc.accountCategory === "Liability"
  );

  // Specific expense accounts for Times Interest Earned (TIE) ratio
  const interestExpense = sumBy(accounts, acc => acc.accountNumber === "505");
  const taxExpense = sumBy(accounts, acc => acc.accountNumber === "506");


  // FINANCIAL RATIO CALCULATIONS - Displayed on Dashboard.................................................

  // Liquidity Ratios 
  const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : 0;

  const quickRatio = currentLiabilities > 0
    ? (cash + shortTermInvestments + accountsReceivable) / currentLiabilities
    : 0;

  // Profitability Ratios 
  const profitMargin = revenue > 0 ? (netIncome / revenue) * 100 : 0;

  const assetTurnover = totalAssets > 0 ? revenue / totalAssets : 0;

  // Solvency Ratios 
  const debtToAssets = totalAssets > 0 ? totalLiabilities / totalAssets : 0;

  const timesInterestEarned = interestExpense > 0
    ? (netIncome + interestExpense + taxExpense) / interestExpense
    : 0;


  // STATE VARIABLES - UI Controls.........................................................................

  // Controls edit mode for various forms
  const [editing, setEditing] = useState(false);

  // Search term for filtering accounts in Chart of Accounts
  const [searchTerm, setSearchTerm] = useState("");

  // Controls visibility of date picker 
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Date range filter for Chart of Accounts 
  const [coaDateRange, setCoaDateRange] = useState({ from: "", to: "" });

  // Controls visibility of date range picker dropdown 
  const [coaDateOpen, setCoaDateOpen] = useState(false);

  // Helper: check if an account's dateAdded is inside the selected range
  const isWithinCoaRange = (dateStr) => {
    if (!coaDateRange.from && !coaDateRange.to) return true;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (coaDateRange.from && d < new Date(coaDateRange.from)) return false;
    if (coaDateRange.to && d > new Date(coaDateRange.to)) return false;
    return true;
  };
  
  // Signup-style inline error for the modal
  const [accountError, setAccountError] = useState("");

  // Filter Popover State
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState({
    name: "",
    number: "",
    category: "",
    subcategory: "",
    minAmount: "",
    maxAmount: "",
  });

  // React Router hook for accessing URL state
  const location = useLocation();


  // USE EFFECT HOOKS - Tab Persistence....................................................................

  // Handle navigation-triggered tab changes and localStorage persistence
  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    } else {
      const savedTab = localStorage.getItem("adminActiveTab");
      if (!savedTab) {
        setActiveTab("Dashboard");
      }
    }
  }, [location.state]);
  
  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("adminActiveTab", activeTab);
  }, [activeTab]);


  // USE EFFECT HOOKS - Data Subscriptions..................................................................

  // Real-time subscription to accounts collection; updates automatically when accounts are added/modified/deleted
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "accounts"), (snapshot) => {
      setAccounts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
  }, []);

  // Firestore real-time listener for messages
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "messages"), (snapshot) => {
      const messagesData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setMessages(messagesData);
    });
    return () => unsub();
  }, []);

  // Real-time subscription to pending user requests
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "pendingUsers"), (snapshot) => {
      setPendingRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsub();
  }, []);

  // Load logged-in user from Firestore
  useEffect(() => {
    const fetchAdminUser = async () => {
      const storedUsername = localStorage.getItem("loggedInUser");
      if (storedUsername) {
        const userRef = doc(db, "users", storedUsername);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          setAdminUser({
            username: userSnap.data().username,
            profilePic: profilePic,
          });
        }
      }
    };
    fetchAdminUser();
  }, []);

  // Load users from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      const usersData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setUsers(usersData);
    });
    return () => unsub();
  }, []);


  // USER MANAGEMENT FUNCTIONS..............................................................................

  // Creates a new user in the system
  const handleCreateUser = async () => {
    try {
      const now = Date.now();
      const expiry = now + 90 * 24 * 60 * 60 * 1000; // 90 days
  
      const hashedPw = await hashPassword(newUser.password);
  
      await setDoc(doc(db, "users", newUser.username), {
        ...newUser,
        password: hashedPw,
        passwordHistory: [hashedPw],    // Sprint 11 requirement
        active: true,
        passwordLastChanged: now,
        passwordExpiry:
          newUser.role === "Administrator" ? null : expiry,
      });
  
      setNewUser({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        address: "",
        dob: "",
        username: "",
        role: "Accountant",
      });
  
      setErrors({});
      setMessage("User has been successfully created.");
    } catch (err) {
      console.error("Error creating user:", err);
    }
  };
  
  // Validation checks
  const validateForm = async () => {
    const newErrors = {};
    setMessage("");

    if (!newUser.firstName.trim())
      newErrors.firstName = "First name is required.";
    if (!newUser.lastName.trim()) newErrors.lastName = "Last name is required.";
    if (!/\S+@\S+\.\S+/.test(newUser.email))
      newErrors.email = "Enter a valid email.";

    const passwordRegex =
      /^(?=[A-Za-z])(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newUser.password)) {
      newErrors.password =
        "Password must be at least 8 characters, start with a letter, and include a letter, number, and special character.";
    }

    if (!newUser.address.trim()) newErrors.address = "Address is required.";
    if (!newUser.dob) {
      newErrors.dob = "Date of birth is required.";
    } else {
      const dob = new Date(newUser.dob);
      const ageDiff = Date.now() - dob.getTime();
      const ageDate = new Date(ageDiff);
      const age = Math.abs(ageDate.getUTCFullYear() - 1970);
      if (age < 18) newErrors.dob = "User must be at least 18 years old.";
    }

    // Auto-generate username format
    const expectedUsername = generateUsername(newUser.firstName, newUser.lastName);

    if (newUser.username !== expectedUsername) {
      newErrors.username =
        `Username must be: ${expectedUsername}`;
    } else {
      const userRef = doc(db, "users", expectedUsername);
      const existingDoc = await getDoc(userRef);
      if (existingDoc.exists()) {
        newErrors.username = "Username already exists.";
      }
    }

    if (!newUser.role) newErrors.role = "Role is required.";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const toggleUserStatus = async (id, currentStatus) => {
    try {
      const updateData = { active: !currentStatus };
      
      // If reactivating, reset failed login attempts
      if (!currentStatus === true) {
        updateData.failedLoginAttempts = 0;
        updateData.suspendedReason = null;
      }
      
      await updateDoc(doc(db, "users", id), updateData);
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };


  // SIGNUP REQUEST MANAGEMENT...............................................................................

  // Approve a pending user request
  const approveRequest = async (req) => {
    try {
      // Create user in users/
      await setDoc(doc(db, "users", req.username), {
        firstName: req.firstName,
        lastName: req.lastName,
        email: req.email,
        username: req.username,
        password: req.password,
        address: req.address,
        dob: req.dob,
        role: "Accountant",
        active: true,
        securityQuestion: req.securityQuestion,
        securityAnswer: req.securityAnswer,
        passwordLastChanged: Date.now(),
        passwordExpiry: Date.now() + 90 * 24 * 60 * 60 * 1000
      });

      // Remove request
      await deleteDoc(doc(db, "pendingUsers", req.username));


      // Send internal message to user
      await setDoc(doc(collection(db, "messages")), {
        from: "Admin",
        to: req.username,
        subject: "Account Approved",
        body: "Your account has been approved. You may now log in.",
        timestamp: Date.now()
      });

      alert("User approved.");
    } catch (err) {
      console.error("Error approving request:", err);
      alert("Error approving request.");
    }
  };


  // Reject a pending user request
  const rejectRequest = async (req) => {
    try {
      await deleteDoc(doc(db, "pendingUsers", req.username));

      // Send rejection message
      await setDoc(doc(collection(db, "messages")), {
        from: "Admin",
        to: req.username,
        subject: "Account Request Rejected",
        body: "Your signup request was not approved.",
        timestamp: Date.now()
      });

      alert("Request rejected.");
    } catch (err) {
      console.error("Error rejecting request:", err);
      alert("Error rejecting request.");
    }
  };


  // RENDER..........................................................................................................................................

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "90vh",
        marginTop: "0.8rem",
      }}
    >


      {/* HEADER */}
      <div style={{ width: "95vw", margin: "0 auto", maxWidth: 1400 }}>
      <Header
        username={adminUser.username}
        profilePic={adminUser.profilePic}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
      </div>


      {/* MAIN CONTENT AREA */}
      <div
        style={{
          width: "95vw",
          margin: "0 auto",
          maxWidth: 1400,
          flex: 1,
        }}
      >
        

        {/* MAIN CONTENT AREA CONTAINER */}
        <main
          style={{
            flex: 1,
            padding: "2.5rem",
            backgroundColor: "#ffffff",
          }}
        >


          {/* DASHBOARD.............................................................................................................................. */} 
          {activeTab === "Dashboard" && (
            <>
              <h2 style={{ color: "#111827", fontSize: "1.5rem" }}>
                Administrator Dashboard
              </h2>
              <p
                style={{
                  marginTop: "0.75rem",
                  color: "#374151",
                  fontSize: "1rem",
                }}
              >
                Welcome! Use the top navigation to manage users, accounts, and system settings.
              </p>

              {/* Financial Ratios Section */}
              <div style={{ marginTop: "32px" }}>
                <h3>Financial Ratios</h3>

                <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", marginTop: "10px" }}>

                  {/* Current Ratio */}
                  <Tooltip text="Measures ability to pay short-term debt using current assets. Higher is better.">
                    <div className={`ratio-card ${getColor(currentRatio, 2.0, 1.0)}`}>
                      <span className="ratio-name">Current Ratio:</span>
                      <span className="ratio-value">{currentRatio.toFixed(2)}</span>
                    </div>
                  </Tooltip>

                  {/* Quick Ratio */}
                  <Tooltip text="Measures immediate liquidity by excluding inventory. Shows ability to pay debts quickly.">
                    <div className={`ratio-card ${getColor(quickRatio, 1.0, 0.8)}`}>
                      <span className="ratio-name">Quick Ratio:</span>
                      <span className="ratio-value">{quickRatio.toFixed(2)}</span>
                    </div>
                  </Tooltip>

                  {/* Profit Margin */}
                  <Tooltip text="Shows what percent of each sales dollar becomes net income. Profitability indicator.">
                    <div className={`ratio-card ${getColor(profitMargin, 20, 10)}`}>
                      <span className="ratio-name">Profit Margin:</span>
                      <span className="ratio-value">{profitMargin.toFixed(2)}%</span>
                    </div>
                  </Tooltip>

                  {/* Asset Turnover */}
                  <Tooltip text="Measures how efficiently assets generate revenue. Higher means better asset use.">
                    <div className={`ratio-card ${getColor(assetTurnover, 1.0, 0.5)}`}>
                      <span className="ratio-name">Asset Turnover:</span>
                      <span className="ratio-value">{assetTurnover.toFixed(2)}</span>
                    </div>
                  </Tooltip>

                  {/* Debt to Assets */}
                  <Tooltip text="Shows how much of assets are financed with debt. Lower values indicate stronger solvency.">
                    <div className={`ratio-card ${getColor(debtToAssets, 0.40, 0.60)}`}>
                      <span className="ratio-name">Debt to Assets:</span>
                      <span className="ratio-value">{debtToAssets.toFixed(2)}</span>
                    </div>
                  </Tooltip>

                  {/* Times Interest Earned (TIE) */}
                  <Tooltip text="Measures ability to meet interest obligations. Higher values mean lower financial risk.">
                    <div className={`ratio-card ${getColor(timesInterestEarned, 5, 2)}`}>
                      <span className="ratio-name">Times Interest Earned (TIE):</span>
                      <span className="ratio-value">{timesInterestEarned.toFixed(2)}</span>
                    </div>
                  </Tooltip>

                </div>
              </div>
            </>
          )}

          {/* CREATE USER TAB........................................................................................................................ */}

          {/* Form for administrators to create new user accounts directly */}
          {activeTab === "Create User" && (
            <>
              <h2>Create User</h2>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  width: "355px",
                }}
              >
                {/* First Name Input - auto-generates username */}
                <Tooltip text="Enter the user's legal first name.">
                <input
                  type="text"
                  placeholder="First Name"
                  value={newUser.firstName}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewUser({
                      ...newUser,
                      firstName: value,
                      username: generateUsername(value, newUser.lastName)
                    });
                  }}
                  style={{
                    width: "325px",
                    padding: "0.75rem",
                    border: "1px solid #ccc",
                    borderRadius: "6px",
                    fontSize: "1rem",
                    backgroundColor: "#fff",
                    marginTop: "0.5rem",
                    boxSizing: "border-box",
                  }}
                />
                  <div
                    style={{
                      width: "525px",
                    }}
                  ></div>
                </Tooltip>

                {errors.firstName && (
                  <span style={{ color: "red" }}>{errors.firstName}</span>
                )}

                <Tooltip text="Enter the user's legal last name.">
                <input
                  type="text"
                  placeholder="Last Name"
                  value={newUser.lastName}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewUser({
                      ...newUser,
                      lastName: value,
                      username: generateUsername(newUser.firstName, value)
                    });
                  }}
                  style={{
                    width: "325px",
                    padding: "0.75rem",
                    border: "1px solid #ccc",
                    borderRadius: "6px",
                    fontSize: "1rem",
                    backgroundColor: "#fff",
                    marginTop: "0.5rem",
                    boxSizing: "border-box",
                  }}
                />
                  <div
                    style={{
                      width: "325px",
                    }}
                  ></div>
                </Tooltip>

                {errors.lastName && (
                  <span style={{ color: "red" }}>{errors.lastName}</span>
                )}

                <Tooltip text="Official email for password resets and system notifications.">
                  <input
                    type="email"
                    placeholder="Email"
                    value={newUser.email}
                    onChange={(e) =>
                      setNewUser({ ...newUser, email: e.target.value })
                    }
                    style={{
                      width: "325px",
                      padding: "0.75rem",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      fontSize: "1rem",
                      backgroundColor: "#fff",
                      marginTop: "0.5rem",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      width: "325px",
                    }}
                  ></div>
                </Tooltip>

                {errors.email && (
                  <span style={{ color: "red" }}>{errors.email}</span>
                )}

                <Tooltip text="Password must start with a letter, contain at least 1 number and 1 special character, and be 8+ characters long.">
                  <input
                    type="password"
                    placeholder="Password"
                    value={newUser.password}
                    onChange={(e) =>
                      setNewUser({ ...newUser, password: e.target.value })
                    }
                    style={{
                      width: "325px",
                      padding: "0.75rem",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      fontSize: "1rem",
                      backgroundColor: "#fff",
                      marginTop: "0.5rem",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      width: "325px",
                    }}
                  ></div>
                </Tooltip>

                {errors.password && (
                  <span style={{ color: "red" }}>{errors.password}</span>
                )}

                <Tooltip text="Full residential address.">
                  <input
                    type="text"
                    placeholder="Address"
                    value={newUser.address}
                    onChange={(e) =>
                      setNewUser({ ...newUser, address: e.target.value })
                    }
                    style={{
                      width: "325px",
                      padding: "0.75rem",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      fontSize: "1rem",
                      backgroundColor: "#fff",
                      marginTop: "0.5rem",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      width: "325px",
                    }}
                  ></div>
                </Tooltip>

                {errors.address && (
                  <span style={{ color: "red" }}>{errors.address}</span>
                )}

                <Tooltip text="User must be at least 18 years old to meet system access requirements.">
                  <input
                    type="date"
                    value={newUser.dob}
                    onChange={(e) =>
                      setNewUser({ ...newUser, dob: e.target.value })
                    }
                    style={{
                      width: "325px",
                      padding: "0.75rem",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      fontSize: "1rem",
                      backgroundColor: "#fff",
                      marginTop: "0.5rem",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      width: "325px",
                    }}
                  ></div>
                </Tooltip>

                {errors.dob && <span style={{ color: "red" }}>{errors.dob}</span>}

                <Tooltip text="Username must be the first name initial, the full last name, and a four digit (two-digit month and two digit year) of when the account is created.">
                  <input
                    type="text"
                    placeholder="Username"
                    value={newUser.username}
                    onChange={(e) =>
                      setNewUser({ ...newUser, username: e.target.value })
                    }
                    style={{
                      width: "325px",
                      padding: "0.75rem",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      fontSize: "1rem",
                      backgroundColor: "#fff",
                      marginTop: "0.5rem",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      width: "325px",
                    }}
                  ></div>
                </Tooltip>

                {errors.username && (
                  <span style={{ color: "red" }}>{errors.username}</span>
                )}

                <Tooltip text="Select the user's access level.">
                  <select
                    value={newUser.role}
                    onChange={(e) =>
                      setNewUser({ ...newUser, role: e.target.value })
                    }
                    style={{
                      width: "325px",
                      padding: "0.75rem",
                      border: "1px solid #ccc",
                      borderRadius: "6px",
                      fontSize: "1rem",
                      backgroundColor: "#fff",
                      marginTop: "0.5rem",
                      boxSizing: "border-box",
                    }}
                  >
                    <option>Accountant</option>
                    <option>Manager</option>
                    <option>Administrator</option>
                  </select>
                </Tooltip>

                {errors.role && (
                  <span style={{ color: "red" }}>{errors.role}</span>
                )}

                <Tooltip text="Creates a new user after all required fields pass validation.">
                  <button
                    onClick={async () => {
                      const valid = await validateForm();
                      if (!valid) {
                        alert("Please correct the highlighted fields before continuing.");
                        return;
                      }
                      handleCreateUser();
                    }}
                    style={{
                      background: "#4f46e5",
                      color: "white",
                      padding: "0.5rem 1rem",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      marginTop: "1.5rem",
                      marginLeft: "0.5rem",
                      width: "125px",
                    }}
                  >
                    Create
                  </button>
                </Tooltip>

                {message && (
                  <p
                    style={{
                      color: "green",
                      marginTop: "1rem",
                      marginLeft: "0.5rem",
                    }}
                  >
                    {message}
                  </p>
                )}
              </div>
            </>
          )}

          {/* MANAGE USERS TAB.................................................................................................................... */}

          {/* Table of all users with actions: role change, suspend, view/edit, activate/deactivate */}
          {activeTab === "Manage Users" && (
            <>
              <h2>Manage Users</h2>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  marginTop: "1rem",
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: "#f9fafb" }}>
                    <th style={{ color: "#111827", padding: "0.75rem", textAlign: "left" }}>
                      Username
                    </th>
                    <th style={{ color: "#111827", padding: "0.75rem", textAlign: "left" }}>
                      Role
                    </th>
                    <th style={{ color: "#111827", padding: "0.75rem", textAlign: "left" }}>
                      Status
                    </th>
                    <th style={{ color: "#111827", padding: "0.75rem", textAlign: "left" }}>
                      Suspension
                    </th>
                    <th style={{ color: "#111827", padding: "0.75rem", textAlign: "left" }}>
                      Personal Info
                    </th>
                    <th style={{ color: "#111827", padding: "0.75rem", textAlign: "left" }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Map through all users and display their info with action buttons */}
                  {users.map((u) => {
                    // Check if user is currently in a suspension period
                    const today = new Date().toISOString().split("T")[0];
                    const isSuspended =
                      u.suspendStart &&
                      u.suspendEnd &&
                      today >= u.suspendStart &&
                      today <= u.suspendEnd;

                    return (
                      <tr key={u.id}>
                        <td style={{ color: "#111827", padding: "0.75rem" }}>{u.username}</td>
                        {/* Role dropdown - allows changing user's role */}
                        <td style={{ color: "#111827", padding: "0.75rem" }}>
                          <Tooltip text="Change this user's system access level.">
                            <select
                              value={u.role}
                              onChange={(e) =>
                                updateDoc(doc(db, "users", u.id), {
                                  role: e.target.value,
                                })
                              }
                              style={{
                                padding: "0.3rem",
                                border: "1px solid #ccc",
                                borderRadius: "6px",
                              }}
                            >
                              <option>Accountant</option>
                              <option>Manager</option>
                              <option>Administrator</option>
                            </select>
                          </Tooltip>
                        </td>

                        <td
                          style={{
                            color: u.active ? "green" : "red",
                            padding: "0.75rem",
                          }}
                        >
                          {u.active ? "Active" : "Inactive"}
                        </td>

                        {/* Suspension column */}
                        <td style={{ padding: "0.75rem" }}>
                          {isSuspended ? (
                            <div>
                              <Tooltip text="This user is currently suspended. Click to edit suspension dates.">
                                <button
                                  onClick={() =>
                                    setEditingUser({ ...u, suspendMode: true })
                                  }
                                  style={{
                                    background: "#9ca3af",
                                    color: "white",
                                    padding: "0.3rem 0.75rem",
                                    border: "none",
                                    borderRadius: "6px",
                                    cursor: "pointer",
                                    width: "120px",
                                  }}
                                >
                                  Suspended
                                </button>
                              </Tooltip>

                              <div
                                style={{
                                  fontSize: "0.8rem",
                                  color: "#111827",
                                  marginTop: "0.25rem",
                                }}
                              >
                                Until {new Date(u.suspendEnd).toLocaleDateString()}
                              </div>
                            </div>
                          ) : (
                            <Tooltip text="Temporarily disable user login during a specified date range.">
                              <button
                                onClick={() =>
                                  setEditingUser({ ...u, suspendMode: true })
                                }
                                style={{
                                  background: "#3b82f6",
                                  color: "white",
                                  padding: "0.3rem 0.75rem",
                                  border: "none",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  width: "120px",
                                }}
                              >
                                Suspend
                              </button>
                            </Tooltip>

                          )}
                        </td>

                        {/* View/Edit Info column */}
                        <td style={{ padding: "0.75rem" }}>
                        <Tooltip text="Open this user's full profile to view or update personal information.">
                          <button
                            onClick={() =>
                              setEditingUser({ ...u, suspendMode: false })
                            }
                            style={{
                              background: "#3b82f6",
                              color: "white",
                              padding: "0.3rem 0.75rem",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              width: "150px",
                            }}
                          >
                            View / Edit Info
                          </button>
                        </Tooltip>
                        </td>

                        {/* Activate/Deactivate column */}
                        <td style={{ padding: "0.75rem" }}>
                        <Tooltip
                          text={
                            u.active
                              ? "Deactivate this user. Disabled users cannot log in."
                              : "Reactivate this user and restore login access."
                          }
                        >
                          <button
                            onClick={() => toggleUserStatus(u.id, u.active)}
                            style={{
                              background: u.active ? "#ef4444" : "#22c55e",
                              color: "white",
                              padding: "0.3rem 0.75rem",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              width: "100px",
                            }}
                          >
                            {u.active ? "Deactivate" : "Activate"}
                          </button>
                        </Tooltip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          
          {/* CHART OF ACCOUNTS TAB.................................................................................................................. */}
          {activeTab === "Chart of Accounts" && (
            <div className="chart-of-accounts" style={{ position: "relative" }}>
              <h2 style={{ color: "#111827" }}>Chart of Accounts</h2>

              {/* Control bar: Date Range + Search + Add Account */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "1rem",
                  width: "100%",
                  marginBottom: "1rem",
                }}
              >
                {/* Date Range + Search */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    flexShrink: 0,
                  }}
                >
                  {/* Date Range */}
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setCoaDateOpen((v) => !v)}
                      title="Filter accounts by date range"
                      style={{
                        background: "#f3f4f6",
                        border: "1px solid #d1d5db",
                        borderRadius: "6px",
                        padding: "0.4rem 0.75rem",
                        cursor: "pointer",
                        fontWeight: 600,
                        color: "#111827",
                      }}
                    >
                      📅 Date Range
                    </button>

                    {(coaDateRange?.from || coaDateRange?.to) && (
                      <span
                        style={{
                          color: "#374151",
                          fontSize: "0.9rem",
                          marginLeft: "0.75rem",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {coaDateRange?.from ? `From: ${coaDateRange.from}` : "From: —"}{" "}
                        &nbsp;|&nbsp; {coaDateRange?.to ? `To: ${coaDateRange.to}` : "To: —"}
                      </span>
                    )}

                    {/* Pop-up calendar */}
                    {coaDateOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "2.5rem",
                          left: 0,
                          background: "#fff",
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
                          padding: "0.75rem",
                          zIndex: 1000,
                          width: "280px",
                        }}
                      >
                        <div style={{ display: "grid", gap: "0.5rem" }}>
                          <label style={{ color: "#111827", fontWeight: 600 }}>
                            From
                            <input
                              type="date"
                              value={coaDateRange?.from || ""}
                              onChange={(e) =>
                                setCoaDateRange((prev) => ({
                                  ...prev,
                                  from: e.target.value,
                                }))
                              }
                              style={{
                                width: "100%",
                                marginTop: "0.25rem",
                                padding: "0.5rem",
                                borderRadius: "6px",
                                border: "1px solid #ccc",
                              }}
                            />
                          </label>

                          <label style={{ color: "#111827", fontWeight: 600 }}>
                            To
                            <input
                              type="date"
                              value={coaDateRange?.to || ""}
                              onChange={(e) =>
                                setCoaDateRange((prev) => ({
                                  ...prev,
                                  to: e.target.value,
                                }))
                              }
                              style={{
                                width: "100%",
                                marginTop: "0.25rem",
                                padding: "0.5rem",
                                borderRadius: "6px",
                                border: "1px solid #ccc",
                              }}
                            />
                          </label>

                          <div
                            style={{
                              display: "flex",
                              gap: "0.5rem",
                              marginTop: "0.25rem",
                            }}
                          >
                            <button
                              onClick={() => setCoaDateOpen(false)}
                              style={{
                                background: "#3b82f6",
                                color: "white",
                                border: "none",
                                borderRadius: "6px",
                                padding: "0.4rem 0.75rem",
                                cursor: "pointer",
                                flex: 1,
                              }}
                            >
                              Apply
                            </button>
                            <button
                              onClick={() => {
                                setCoaDateRange({ from: "", to: "" });
                                setCoaDateOpen(false);
                              }}
                              style={{
                                background: "#ef4444",
                                color: "white",
                                border: "none",
                                borderRadius: "6px",
                                padding: "0.4rem 0.75rem",
                                cursor: "pointer",
                                flex: 1,
                              }}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Filter Button + Popover */}
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setFilterOpen((prev) => !prev)}
                      title="Filter accounts by criteria"
                      style={{
                        background: "#f3f4f6",
                        border: "1px solid #d1d5db",
                        borderRadius: "6px",
                        padding: "0.45rem 0.75rem",
                        cursor: "pointer",
                        fontWeight: 600,
                        color: "#111827",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                      }}
                    >
                      ⚙️ Filter
                    </button>

                    {filterOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "2.5rem",
                          left: 0,
                          background: "#fff",
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
                          padding: "0.75rem",
                          zIndex: 1000,
                          width: "300px",
                        }}
                      >
                        {/* Filter Fields */}
                        <div style={{ display: "grid", gap: "0.5rem" }}>
                          <input
                            type="text"
                            placeholder="Account Name"
                            value={filters.name}
                            onChange={(e) =>
                              setFilters((f) => ({ ...f, name: e.target.value }))
                            }
                            style={{
                              padding: "0.4rem",
                              borderRadius: "6px",
                              border: "1px solid #ccc",
                            }}
                          />
                          <input
                            type="text"
                            placeholder="Account Number"
                            value={filters.number}
                            onChange={(e) =>
                              setFilters((f) => ({ ...f, number: e.target.value }))
                            }
                            style={{
                              padding: "0.4rem",
                              borderRadius: "6px",
                              border: "1px solid #ccc",
                            }}
                          />
                          <input
                            type="text"
                            placeholder="Category"
                            value={filters.category}
                            onChange={(e) =>
                              setFilters((f) => ({ ...f, category: e.target.value }))
                            }
                            style={{
                              padding: "0.4rem",
                              borderRadius: "6px",
                              border: "1px solid #ccc",
                            }}
                          />
                          <input
                            type="text"
                            placeholder="Subcategory"
                            value={filters.subcategory}
                            onChange={(e) =>
                              setFilters((f) => ({ ...f, subcategory: e.target.value }))
                            }
                            style={{
                              padding: "0.4rem",
                              borderRadius: "6px",
                              border: "1px solid #ccc",
                            }}
                          />
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <input
                              type="number"
                              placeholder="Min Amt"
                              value={filters.minAmount}
                              onChange={(e) =>
                                setFilters((f) => ({ ...f, minAmount: e.target.value }))
                              }
                              style={{
                                padding: "0.4rem",
                                borderRadius: "6px",
                                border: "1px solid #ccc",
                                width: "100%",
                              }}
                            />
                            <input
                              type="number"
                              placeholder="Max Amt"
                              value={filters.maxAmount}
                              onChange={(e) =>
                                setFilters((f) => ({ ...f, maxAmount: e.target.value }))
                              }
                              style={{
                                padding: "0.4rem",
                                borderRadius: "6px",
                                border: "1px solid #ccc",
                                width: "100%",
                              }}
                            />
                          </div>

                          {/* Apply & Clear */}
                          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                            <button
                              onClick={() => setFilterOpen(false)}
                              style={{
                                background: "#3b82f6",
                                color: "white",
                                border: "none",
                                borderRadius: "6px",
                                padding: "0.4rem 0.75rem",
                                cursor: "pointer",
                                flex: 1,
                              }}
                            >
                              Apply
                            </button>
                            <button
                              onClick={() => {
                                setFilters({
                                  name: "",
                                  number: "",
                                  category: "",
                                  subcategory: "",
                                  minAmount: "",
                                  maxAmount: "",
                                });
                                setFilterOpen(false);
                              }}
                              style={{
                                background: "#ef4444",
                                color: "white",
                                border: "none",
                                borderRadius: "6px",
                                padding: "0.4rem 0.75rem",
                                cursor: "pointer",
                                flex: 1,
                              }}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Search Bar*/}
                  <div
                    style={{
                      width: "55%",
                      marginTop: "1rem",
                      display: "flex",
                      justifyContent: "flex-start",
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Search by name, number, or category..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{
                        width: "320px",
                        height: "17px",
                        padding: "0.58rem 1rem",
                        borderRadius: "6px",
                        border: "1px solid #ccc",
                      }}
                    />
                  </div>
              </div>


                {/* Add Account */}
                <div style={{ marginBottom: "1.5rem" }}>
                <button
                  style={{
                    backgroundColor: "#22c55e",
                    color: "#fff",
                    fontWeight: "600",
                    padding: "0.5rem 1rem",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                  title="Add a new account to the Chart of Accounts"
                  onClick={() => {
                    setAccountForm({
                      accountName: "",
                      accountNumber: "",
                      accountDescription: "",
                      accountCategory: "",
                      accountSubcategory: "",
                      normalSide: "",
                      statementType: "",
                      comment: "",
                      initialBalance: 0,
                      debit: 0,
                      credit: 0,
                      balance: 0,
                      order: "",
                      dateAdded: new Date().toISOString().split("T")[0],
                      userId: adminUser.username,
                      active: true,
                    });
                    setEditing(false);
                    setShowAccountForm(true);
                    setAccountError("");
                  }}
                >
                  Add Account
                </button>
              </div>
            </div>


              {/* ACCOUNT FORM MODAL */}
              {showAccountForm && (
                <div
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    background: "rgba(0,0,0,0.5)",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    zIndex: 999,
                  }}
                >
                  <div
                    style={{
                      background: "#fff",
                      padding: "2rem",
                      borderRadius: "8px",
                      width: "480px",
                      maxHeight: "80vh",
                      overflowY: "auto",
                    }}
                  >
                    <h3 style={{ color: "#111827", textAlign: "center" }}>
                      {editing ? "Edit Account" : "Add New Account"}
                    </h3>

                    {/* Input fields */}
                    {[
                      { label: "Account Name", key: "accountName" },
                      { label: "Account Number (3 digits, e.g. 101)", key: "accountNumber" },
                      { label: "Description", key: "accountDescription" },
                      { label: "Category (e.g. Asset)", key: "accountCategory" },
                      { label: "Subcategory", key: "accountSubcategory" },
                      { label: "Normal Side (Debit/Credit)", key: "normalSide" },
                      { label: "Statement Type (IS, BS, RE)", key: "statementType" },
                      { label: "Comment", key: "comment" },
                      { label: "Order (e.g. 001, 002)", key: "order" },
                    ].map((field) => (
                      <div key={field.key} style={{ marginBottom: "0.75rem" }}>
                        <label style={{ color: "#111827", fontWeight: 600 }}>
                          {field.label}
                        </label>
                        <input
                          type="text"
                          value={accountform[field.key] || ""}
                          onChange={(e) =>
                            setAccountForm({
                              ...accountform,
                              [field.key]: e.target.value,
                            })
                          }
                          style={{
                            width: "100%",
                            marginTop: "0.25rem",
                            padding: "0.5rem",
                            borderRadius: "6px",
                            border: "1px solid #ccc",
                          }}
                        />
                      </div>
                    ))}

                    {/* Date Added (read-only) */}
                    <div style={{ marginBottom: "0.75rem" }}>
                      <label style={{ color: "#111827", fontWeight: 600 }}>Date Added</label>
                      <input
                        type="date"
                        value={accountform.dateAdded}
                        readOnly
                        style={{
                          width: "100%",
                          marginTop: "0.25rem",
                          padding: "0.5rem",
                          borderRadius: "6px",
                          border: "1px solid #ccc",
                          backgroundColor: "#f9fafb",
                        }}
                      />
                    </div>

                    {/* User ID */}
                    <div style={{ marginBottom: "0.75rem" }}>
                      <label style={{ color: "#111827", fontWeight: 600 }}>User ID</label>
                      <input
                        type="text"
                        value={accountform.userId}
                        readOnly
                        style={{
                          width: "100%",
                          marginTop: "0.25rem",
                          padding: "0.5rem",
                          borderRadius: "6px",
                          border: "1px solid #ccc",
                          backgroundColor: "#f9fafb",
                        }}
                      />
                    </div>

                    {/* Numeric fields */}
                    {[
                      { label: "Initial Balance", key: "initialBalance" },
                      { label: "Debit", key: "debit" },
                      { label: "Credit", key: "credit" },
                      { label: "Balance", key: "balance" },
                    ].map((field) => (
                      <div key={field.key} style={{ marginBottom: "0.75rem" }}>
                        <label style={{ color: "#111827", fontWeight: 600 }}>
                          {field.label}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={accountform[field.key] || 0}
                          onChange={(e) =>
                            setAccountForm({
                              ...accountform,
                              [field.key]: parseFloat(e.target.value) || 0,
                            })
                          }
                          style={{
                            width: "100%",
                            marginTop: "0.25rem",
                            padding: "0.5rem",
                            borderRadius: "6px",
                            border: "1px solid #ccc",
                          }}
                        />
                      </div>
                    ))}

                    {/* Buttons */}
                    <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
                      <button
                        style={{
                          background: "#22c55e",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          padding: "0.5rem 1rem",
                          cursor: "pointer",
                        }}
                        onClick={async () => {
                          try {
                            const {
                              accountName,
                              accountNumber,
                              order,
                              initialBalance,
                              debit,
                              credit,
                              balance,
                            } = accountform;

                            // Validations
                            if (!accountName || !accountNumber)
                              return alert("⚠️ Account name and number are required.");
                            if (!/^\d{3}$/.test(accountNumber))
                              return alert("❌ Account number must be exactly 3 digits (e.g. 101).");
                            const firstDigit = accountNumber[0];
                            if (!["1", "2", "3", "4", "5"].includes(firstDigit))
                              return alert(
                                "❌ The first digit must be between 1–5 to represent asset/liability/equity/revenue/expense."
                              );
                            if (/\s/.test(order) || !/^\d{2,3}$/.test(order))
                              return alert("❌ Order must be 2–3 digits, e.g. 01 or 001.");

                            const targetId =
                              editing && accountform.id
                                ? accountform.id
                                : accountNumber;

                            const dupSnap = await getDoc(doc(db, "accounts", targetId));
                            if (dupSnap.exists() && !editing)
                              return alert("⚠️ Account number already exists!");

                            const dataToSave = {
                              ...accountform,
                              balance: parseFloat(balance).toFixed(2),
                              initialBalance: parseFloat(initialBalance).toFixed(2),
                              debit: parseFloat(debit).toFixed(2),
                              credit: parseFloat(credit).toFixed(2),
                            };

                            if (editing) {
                              await updateDoc(doc(db, "accounts", targetId), dataToSave);
                              await addDoc(collection(db, "accountEventLogs"), {
                                accountId: targetId,
                                userId: adminUser.username,
                                action: "Modified",
                                oldData: {},
                                newData: dataToSave,
                                timestamp: new Date(),
                              });
                              alert("✅ Account updated successfully!");
                            } else {
                              await setDoc(doc(db, "accounts", targetId), dataToSave);
                              await addDoc(collection(db, "accountEventLogs"), {
                                accountId: targetId,
                                userId: adminUser.username,
                                action: "Added",
                                oldData: {},
                                newData: dataToSave,
                                timestamp: new Date(),
                              });
                              alert("✅ Account added successfully!");
                            }

                            setShowAccountForm(false);
                          } catch (error) {
                            console.error("SAVE ERROR:", error);
                            alert("❌ Error saving account: " + error.message);
                          }
                        }}
                      >
                        Save
                      </button>

                      <button
                        style={{
                          background: "#ef4444",
                          color: "white",
                          border: "none",
                          borderRadius: "6px",
                          padding: "0.5rem 1rem",
                          cursor: "pointer",
                        }}
                        onClick={() => setShowAccountForm(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ACCOUNTS TABLE */}
              <h3 style={{ color: "#111827", marginTop: "2rem" }}>Accounts List</h3>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  marginTop: "1rem",
                }}
              >
                <colgroup>
                  <col />
                  <col />
                  <col />
                  <col />
                  <col />
                  <col style={{ width: 260 }} />
                </colgroup>
                <thead>
                  <tr style={{ backgroundColor: "#f9fafb" }}>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Account Name</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Account Number</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Category</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Balance</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Status</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts
                    .filter((a) => {
                      const matchesSearch =
                        a.accountName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        a.accountNumber?.includes(searchTerm) ||
                        a.accountCategory?.toLowerCase().includes(searchTerm.toLowerCase());

                      const matchesFilters =
                        (!filters.name ||
                          a.accountName?.toLowerCase().includes(filters.name.toLowerCase())) &&
                        (!filters.number ||
                          a.accountNumber?.toString().includes(filters.number)) &&
                        (!filters.category ||
                          a.accountCategory?.toLowerCase().includes(
                            filters.category.toLowerCase()
                          )) &&
                        (!filters.subcategory ||
                          a.accountSubcategory?.toLowerCase().includes(
                            filters.subcategory.toLowerCase()
                          )) &&
                        (!filters.minAmount || parseFloat(a.balance) >= parseFloat(filters.minAmount)) &&
                        (!filters.maxAmount || parseFloat(a.balance) <= parseFloat(filters.maxAmount));

                      const fromOK =
                        !coaDateRange?.from ||
                        (a.dateAdded && new Date(a.dateAdded) >= new Date(coaDateRange.from));
                      const toOK =
                        !coaDateRange?.to ||
                        (a.dateAdded && new Date(a.dateAdded) <= new Date(coaDateRange.to));

                      return matchesSearch && matchesFilters && fromOK && toOK;
                    })
                    .sort((a, b) => Number(a.accountNumber) - Number(b.accountNumber)) 
                    .map((a) => (
                      <tr key={a.id}>
                        <td style={{ padding: "0.75rem" }}>
                          <Link
                            to={`/ledger/${a.id}`}
                            title={`View ledger for ${a.accountName}`}  
                            style={{
                              color: "#2563eb",
                              textDecoration: "none",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.textDecoration = "underline")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.textDecoration = "none")
                            }
                          >
                            {a.accountName}
                          </Link>
                        </td>

                        <td style={{ padding: "0.75rem", color: "#111827" }}>
                          {a.accountNumber}
                        </td>
                        <td style={{ padding: "0.75rem", color: "#111827" }}>
                          {a.accountCategory}
                        </td>
                        <td style={{ padding: "0.75rem", color: "#111827" }}>
                          {parseFloat(a.balance).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td style={{ padding: "0.75rem", color: a.active ? "green" : "red" }}>
                          {a.active ? "Active" : "Inactive"}
                        </td>
                        <td style={{ padding: "0.75rem", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "nowrap" }}>
                            {/* Edit Account Button */}
                            <button
                              title="Edit this account’s details"  
                              style={{
                                background: "#3b82f6",
                                color: "white",
                                border: "none",
                                borderRadius: "6px",
                                padding: "0.3rem 0.75rem",
                                cursor: "pointer",
                                minWidth: 120,
                              }}
                              onClick={() => {
                                setAccountForm(a);
                                setEditing(true);
                                setShowAccountForm(true);
                                setAccountError("");
                              }}
                            >
                              Edit Account
                            </button>

                            {/* Activate/Deactivate Button */}
                            <button
                              title={
                                a.active
                                  ? "Deactivate this account (only if balance is 0)"
                                  : "Reactivate this account"
                              }  
                              style={{
                                background: a.active ? "#ef4444" : "#22c55e",
                                color: "white",
                                border: "none",
                                borderRadius: "6px",
                                padding: "0.3rem 0.75rem",
                                cursor: a.balance > 0 ? "not-allowed" : "pointer",
                                opacity: a.balance > 0 ? 0.6 : 1,
                                minWidth: 120,
                              }}
                              disabled={a.balance > 0}
                              onClick={async () => {
                                const oldData = { ...a };
                                await updateDoc(doc(db, "accounts", a.id), {
                                  active: !a.active,
                                });
                                await addDoc(collection(db, "accountEventLogs"), {
                                  accountId: a.id,
                                  userId: adminUser.username,
                                  action: a.active ? "Deactivated" : "Reactivated",
                                  oldData,
                                  newData: { ...a, active: !a.active },
                                  timestamp: new Date(),
                                });
                              }}
                            >
                              {a.active ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}


          {/* Modal for editing user info OR suspension */}
          {editingUser && (
            <div
              style={{
                position: "fixed",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  background: "white",
                  padding: "2rem",
                  borderRadius: "8px",
                  width: "400px",
                }}
              >
                {editingUser.suspendMode ? (
                  <>
                    <h3>Suspend User</h3>
                    <label style={{ color: "#111827", fontWeight: "600" }}>Start Date</label>
                    <input
                      type="date"
                      value={editingUser.suspendStart || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, suspendStart: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />
                    <label style={{ color: "#111827", fontWeight: "600" }}>End Date</label>
                    <input
                      type="date"
                      value={editingUser.suspendEnd || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, suspendEnd: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />
                    <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
                      <button
                        onClick={async () => {
                          try {
                            await updateDoc(doc(db, "users", editingUser.id), {
                              suspendStart: editingUser.suspendStart || null,
                              suspendEnd: editingUser.suspendEnd || null,
                            });
                            setEditingUser(null);
                          } catch (err) {
                            console.error("Error suspending user:", err);
                          }
                        }}
                        style={{
                          background: "#22c55e",
                          color: "white",
                          padding: "0.5rem 1rem",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingUser(null)}
                        style={{
                          background: "#ef4444",
                          color: "white",
                          padding: "0.5rem 1rem",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>Edit User Info</h3>
                    <input
                      type="text"
                      placeholder="Username"
                      value={editingUser.username || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, username: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />
                    <input
                      type="text"
                      placeholder="First Name"
                      value={editingUser.firstName || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, firstName: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />
                    <input
                      type="text"
                      placeholder="Last Name"
                      value={editingUser.lastName || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, lastName: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={editingUser.email || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, email: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />
                    <input
                      type="text"
                      placeholder="Address"
                      value={editingUser.address || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, address: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />
                    <input
                      type="date"
                      value={editingUser.dob || ""}
                      onChange={(e) =>
                        setEditingUser({ ...editingUser, dob: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />
                    <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
                      <button
                        onClick={async () => {
                          try {
                            await updateDoc(doc(db, "users", editingUser.id), editingUser);
                            setEditingUser(null);
                          } catch (err) {
                            console.error("Error updating user:", err);
                          }
                        }}
                        style={{
                          background: "#22c55e",
                          color: "white",
                          padding: "0.5rem 1rem",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingUser(null)}
                        style={{
                          background: "#ef4444",
                          color: "white",
                          padding: "0.5rem 1rem",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}


          {/* MESSAGES TAB................................................................................................................... */}          
          {activeTab === "Messages" && (
            <div style={{ width: "95vw", margin: "0 auto", maxWidth: 1300 }}>
              <h2 style={{ color: "#111827" }}>Messages</h2>

              {/* Tabs */}
              <div style={{ marginBottom: "1rem", display: "flex", gap: "1rem" }}>
                <button
                  onClick={() => setActiveSubTab("Inbox")}
                  style={{
                    background: activeSubTab === "Inbox" ? "#3b82f6" : "#e5e7eb",
                    color: activeSubTab === "Inbox" ? "white" : "#111827",
                    padding: "0.5rem 1rem",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Inbox
                </button>

                <button
                  onClick={() => setActiveSubTab("Sent")}
                  style={{
                    background: activeSubTab === "Sent" ? "#3b82f6" : "#e5e7eb",
                    color: activeSubTab === "Sent" ? "white" : "#111827",
                    padding: "0.5rem 1rem",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  Sent
                </button>

                <button
                  onClick={() => setShowCompose(true)}
                  style={{
                    marginLeft: "auto",
                    background: "#22c55e",
                    color: "white",
                    padding: "0.5rem 1rem",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  New Message
                </button>
              </div>

              {/* INBOX */}
              {activeSubTab === "Inbox" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f9fafb" }}>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>From</th>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>Subject</th>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>Details</th>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>Date</th>
                    </tr>
                  </thead>

                  <tbody>
                  {messages
                    .filter((msg) => msg.to === adminUser.username || msg.to === "Admin")
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    .map((msg) => {
                      const bodyText = msg.message || msg.body || "";
                      const signupUsername = extractUsernameFromBody(bodyText);
                      const pendingReq = pendingRequests.find(
                        (r) => r.username === signupUsername
                      );
                      const isSignup =
                        msg.subject === "New Account Signup Request" && signupUsername;

                      const status = processedMessages[msg.id];

                      return (
                        <tr key={msg.id}>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>
                            {msg.from}
                          </td>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>
                            {msg.subject}
                          </td>

                          {/* MESSAGE CARD WITH INLINE BUTTONS / STATUS */}
                          <td style={{ padding: "1rem", verticalAlign: "top" }}>
                            <div
                              style={{
                                background: "#f9fafb",
                                border: "1px solid #e5e7eb",
                                borderRadius: "8px",
                                padding: "1rem",
                                whiteSpace: "pre-wrap",
                                lineHeight: "1.5",
                              }}
                            >
                              <div style={{ marginBottom: "0.5rem", color: "#111827" }}>
                                <strong>From:</strong> {msg.from}
                              </div>
                              <div style={{ marginBottom: "0.5rem", color: "#111827" }}>
                                <strong>To:</strong> {msg.to}
                              </div>
                              <div style={{ marginBottom: "0.5rem", color: "#111827" }}>
                                <strong>Subject:</strong> {msg.subject}
                              </div>
                              <div style={{ marginBottom: "0.5rem", color: "#111827" }}>
                                <strong>Body:</strong> {bodyText}
                              </div>
                              <div style={{ marginBottom: "0.75rem", color: "#111827" }}>
                                <strong>Received:</strong>{" "}
                                {msg.timestamp
                                  ? new Date(msg.timestamp).toLocaleString()
                                  : ""}
                              </div>

                              {/* Extra section only for signup requests */}
                              {isSignup && (
                                <>
                                  <div
                                    style={{
                                      marginTop: "0.5rem",
                                      marginBottom: "0.25rem",
                                      color: "#111827",
                                    }}
                                  >
                                    <strong>Requested User:</strong>{" "}
                                    {pendingReq
                                      ? `${pendingReq.firstName} ${pendingReq.lastName} (${pendingReq.username})`
                                      : signupUsername}
                                  </div>
                                  <div
                                    style={{ marginBottom: "0.75rem", color: "#111827" }}
                                  >
                                    <strong>Email:</strong>{" "}
                                    {pendingReq?.email || "Unknown"}
                                  </div>

                                  {/* Show buttons only if not yet processed */}
                                  {!status && pendingReq && (
                                    <div
                                      style={{
                                        marginTop: "0.75rem",
                                        display: "flex",
                                        gap: "0.75rem",
                                      }}
                                    >
                                      <button
                                        onClick={async () => {
                                          if (!pendingReq) {
                                            alert(
                                              "No matching pending signup request found for this message."
                                            );
                                            return;
                                          }
                                          try {
                                            await approveRequest(pendingReq);
                                            setProcessedMessages((prev) => ({
                                              ...prev,
                                              [msg.id]: "approved",
                                            }));
                                          } catch (err) {
                                            console.error("Error approving request:", err);
                                          }
                                        }}
                                        style={{
                                          background: "#22c55e",
                                          color: "white",
                                          padding: "0.5rem 1.1rem",
                                          border: "none",
                                          borderRadius: "6px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        Approve
                                      </button>
                                      <button
                                        onClick={async () => {
                                          if (!pendingReq) {
                                            alert(
                                              "No matching pending signup request found for this message."
                                            );
                                            return;
                                          }
                                          try {
                                            await rejectRequest(pendingReq);
                                            setProcessedMessages((prev) => ({
                                              ...prev,
                                              [msg.id]: "rejected",
                                            }));
                                          } catch (err) {
                                            console.error("Error rejecting request:", err);
                                          }
                                        }}
                                        style={{
                                          background: "#ef4444",
                                          color: "white",
                                          padding: "0.5rem 1.1rem",
                                          border: "none",
                                          borderRadius: "6px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  )}

                                  {/* Status text after buttons disappear */}
                                  {status && (
                                    <div
                                      style={{
                                        marginTop: "0.75rem",
                                        fontWeight: 600,
                                        color:
                                          status === "approved" ? "#16a34a" : "#b91c1c",
                                      }}
                                    >
                                      {status === "approved" ? "Approved" : "Denied"}
                                    </div>
                                  )}
                                  </>
                                )}
                              </div>
                            </td>

                            <td style={{ padding: "0.75rem", color: "#111827" }}>
                              {msg.timestamp
                                ? new Date(msg.timestamp).toLocaleString()
                                : ""}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}

              {/* ============== SENT ============== */}
              {activeSubTab === "Sent" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f9fafb" }}>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>To</th>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>Subject</th>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>Message</th>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages
                      .filter((msg) => msg.from === adminUser.username)
                      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                      .map((msg) => (
                        <tr key={msg.id}>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>
                            {msg.to}
                          </td>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>
                            {msg.subject}
                          </td>
                          <td style={{ padding: "1rem", verticalAlign: "top" }}>
                            <div
                              style={{
                                background: "#f9fafb",
                                border: "1px solid #e5e7eb",
                                borderRadius: "8px",
                                padding: "1rem",
                                whiteSpace: "pre-wrap",
                                lineHeight: "1.5",
                                color: "#111827",
                              }}
                            >
                              {msg.message || msg.body || ""}
                            </div>
                          </td>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>
                            {msg.timestamp
                              ? new Date(msg.timestamp).toLocaleString()
                              : ""}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}

              {/* Compose modal (unchanged from your version) */}
              {showCompose && (
                <div
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    background: "rgba(0,0,0,0.5)",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      background: "white",
                      padding: "2rem",
                      borderRadius: "8px",
                      width: "400px",
                    }}
                  >
                    <h3>New Message</h3>
                    <label style={{ fontWeight: "600", color: "#111827" }}>To</label>
                    <select
                      value={compose.to}
                      onChange={(e) =>
                        setCompose({ ...compose, to: e.target.value })
                      }
                      style={{
                        width: "100%",
                        margin: "0.5rem 0",
                        padding: "0.5rem",
                        border: "1px solid #ccc",
                        borderRadius: "6px",
                      }}
                    >
                      <option value="">-- Select User --</option>
                      {users
                        .filter((u) => u.active)
                        .map((u) => (
                          <option key={u.id} value={u.username}>
                            {u.username}
                          </option>
                        ))}
                    </select>

                    <label style={{ fontWeight: "600", color: "#111827" }}>
                      Subject
                    </label>
                    <input
                      type="text"
                      value={compose.subject}
                      onChange={(e) =>
                        setCompose({ ...compose, subject: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />

                    <label style={{ fontWeight: "600", color: "#111827" }}>
                      Message
                    </label>
                    <textarea
                      value={compose.body}
                      onChange={(e) =>
                        setCompose({ ...compose, body: e.target.value })
                      }
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem" }}
                    />

                    {errorMessage && (
                      <p style={{ color: "red", marginTop: "0.5rem" }}>
                        {errorMessage}
                      </p>
                    )}

                    <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
                      <button
                        onClick={async () => {
                          if (!compose.to || !compose.subject || !compose.body) {
                            setErrorMessage("All fields are required.");
                            return;
                          }

                          const recipient = users.find(
                            (u) => u.username === compose.to && u.active
                          );
                          if (!recipient) {
                            setErrorMessage("Recipient must be an active user.");
                            return;
                          }

                          try {
                            await setDoc(doc(collection(db, "messages")), {
                              from: adminUser.username,
                              to: compose.to,
                              subject: compose.subject,
                              body: compose.body,
                              timestamp: Date.now(),
                            });
                            setCompose({ to: "", subject: "", body: "" });
                            setShowCompose(false);
                            setErrorMessage("");
                          } catch (err) {
                            console.error("Error sending message:", err);
                            setErrorMessage("Error sending message.");
                          }
                        }}
                        style={{
                          background: "#22c55e",
                          color: "white",
                          padding: "0.5rem 1rem",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        Send
                      </button>
                      <button
                        onClick={() => setShowCompose(false)}
                        style={{
                          background: "#ef4444",
                          color: "white",
                          padding: "0.5rem 1rem",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}


          {/* REPORTS................................................................................................................................ */} 
          {activeTab === "Reports" && (
            <>
              <h2>Password Expiration Report</h2>
              {/* --- EXPIRED PASSWORDS --- */}
              <h3 style={{ marginTop: "1rem", color: "red" }}>Expired Passwords</h3>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  marginTop: "0.5rem",
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: "#f9fafb" }}>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Username</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Role</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Expiry Date</th>
                  </tr>
                </thead>
                <tbody>
                  {users
                    .filter((u) => {
                      if (!(u.role === "Accountant" || u.role === "Manager")) return false;
                      if (!u.passwordExpiry) return false;

                      // Normalize Firestore Timestamp or numeric value
                      const raw = u.passwordExpiry?.seconds
                        ? u.passwordExpiry.seconds * 1000
                        : Number(u.passwordExpiry);
                      if (isNaN(raw)) return false;

                      // Handle both seconds and milliseconds
                      const expiryMillis = raw < 20000000000 ? raw * 1000 : raw;
                      return expiryMillis < Date.now();
                    })
                    .map((u) => (
                      <tr key={u.username}>
                        <td style={{ padding: "0.75rem" }}>{u.username}</td>
                        <td style={{ padding: "0.75rem" }}>{u.role}</td>
                        <td style={{ padding: "0.75rem" }}>
                          {new Date(
                            u.passwordExpiry?.seconds
                              ? u.passwordExpiry.seconds * 1000
                              : Number(u.passwordExpiry)
                          ).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>

              {/* ACTIVE USERS (NOT EXPIRED) */}
              <h3 style={{ marginTop: "2rem", color: "#111827" }}>
                All Users Password Expiry
              </h3>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  marginTop: "0.5rem",
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: "#f9fafb" }}>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Username</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Role</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Expiry Date</th>
                  </tr>
                </thead>
                <tbody>
                  {users
                    .filter((u) => {
                      if (!(u.role === "Accountant" || u.role === "Manager")) return false;
                      if (!u.passwordExpiry) return false;

                      // Normalize Firestore Timestamp or numeric value
                      const raw = u.passwordExpiry?.seconds
                        ? u.passwordExpiry.seconds * 1000
                        : Number(u.passwordExpiry);
                      if (isNaN(raw)) return false;

                      // Handle both seconds and milliseconds
                      const expiryMillis = raw < 20000000000 ? raw * 1000 : raw;
                      return expiryMillis >= Date.now();
                    })
                    .map((u) => (
                      <tr key={u.username}>
                        <td style={{ padding: "0.75rem" }}>{u.username}</td>
                        <td style={{ padding: "0.75rem" }}>{u.role}</td>
                        <td style={{ padding: "0.75rem" }}>
                          {new Date(
                            u.passwordExpiry?.seconds
                              ? u.passwordExpiry.seconds * 1000
                              : Number(u.passwordExpiry)
                          ).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default AdminHome;