// src/pages/HelpPage.jsx
import React, { useState } from "react";
import Header from "../components/Header";
import profilePic from "../assets/ProfilePic.jpg";
import { useLocation } from "react-router-dom";

function HelpPage() {
  const location = useLocation();
  const passedRole = location.state?.role;
  const role = passedRole || localStorage.getItem("userRole") || "Admin";

  const [openSection, setOpenSection] = useState(null);

  const toggleSection = (section) => {
    setOpenSection(openSection === section ? null : section);
  };
 
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        backgroundColor: "#f9fafb",
      }}
    >
      {/* Consistent Header Layout */}
      <div style={{ width: "95vw", margin: "1rem auto", maxWidth: 1400 }}>
      <Header
        username={localStorage.getItem("loggedInUser") || "User"}
        profilePic={profilePic}
        role={role}
        activeTab="Help"
        setActiveTab={() => {}}
        showActions={true}
      />
      </div>

      {/* Consistent Main Layout */}
      <div
        style={{
          width: "95vw",
          margin: "0 auto",
          maxWidth: 1410,
          flex: 1,
        }}
      >
        <main
          style={{
            flex: 1,
            background: "#ffffff",
            padding: "2.5rem",
            borderRadius: "12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          }}
        >
          <h2 style={{ color: "#111827", marginBottom: "1rem", fontSize: "1.5rem", fontWeight: 700 }}>
            Help & Documentation
          </h2>

          <p style={{ color: "#374151", marginBottom: "1.5rem" }}>
            Welcome to <strong>Equity Experts</strong>.  
            Below you’ll find guidance organized by topic — including system features, account management, event logs, and reporting.
          </p>

          {[
            {
              title: "1️⃣ Getting Started",
              content: (
                <>
                  <p>• Log in with your assigned credentials. If your password has expired, use the “Forgot Password” link.</p>
                  <p>• Navigate via the top menu bar after login.</p>
                  <p>• Your homepage depends on your role — administrators manage users, accountants handle journal entries, etc.</p>
                </>
              ),
            },
            {
              title: "2️⃣ Chart of Accounts",
              content: (
                <>
                  <p>• View all accounts, their categories, and balances.</p>
                  <p>• Use filters to search by name, number, or category.</p>
                  <p>• Add or edit accounts as needed; changes are automatically logged.</p>
                </>
              ),
            },
            {
              title: "3️⃣ Journal Entries",
              content: (
                <>
                  <p>• Use the Journalize tab to record transactions.</p>
                  <p>• Debits and credits must balance before saving.</p>
                  <p>• Entries automatically update Chart of Accounts balances.</p>
                </>
              ),
            },
            {
              title: "4️⃣ Event Logs",
              content: (
                <>
                  <p>• Every change is recorded in <strong>Event Logs</strong> with full before/after data.</p>
                  <p>• Each log includes the user ID, timestamp, and modified details.</p>
                  <p>• Access anytime via the “Event Logs” tab above.</p>
                </>
              ),
            },
            {
              title: "5️⃣ Reports",
              content: (
                <>
                  <p>• Generate reports such as Trial Balance, Income Statement, and Balance Sheet.</p>
                  <p>• Reports always reflect the most current data.</p>
                </>
              ),
            },
            {
              title: "6️⃣ User Management (Admin Only)",
              content: (
                <>
                  <p>• Create, suspend, or edit users under “Manage Users.”</p>
                  <p>• Passwords expire automatically after 90 days for non-admins.</p>
                  <p>• Inactive users cannot log in until reactivated.</p>
                </>
              ),
            },
            {
              title: "7️⃣ Security & Audit Trail",
              content: (
                <>
                  <p>• All key actions are logged for compliance.</p>
                  <p>• Admins can review modification histories in Event Logs.</p>
                  <p>• Strong password and expiration policies protect system data.</p>
                </>
              ),
            },
            {
              title: "8️⃣ Troubleshooting",
              content: (
                <>
                  <p>• If pages don’t load, try refreshing or clearing cache.</p>
                  <p>• For permission issues, check your role in “Manage Users.”</p>
                  <p>• Persistent issues? Contact the system administrator.</p>
                </>
              ),
            },
          ].map(({ title, content }) => (
            <div
              key={title}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                marginBottom: "1rem",
                background: "#fefefe",
              }}
            >
              <button
                onClick={() => toggleSection(title)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  padding: "1rem",
                  fontWeight: 700,
                  color: "#111827",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                {title}
                <span style={{ fontSize: "1.2rem" }}>
                  {openSection === title ? "−" : "+"}
                </span>
              </button>
              {openSection === title && (
                <div
                  style={{
                    padding: "0 1rem 1rem 1rem",
                    color: "#374151",
                    lineHeight: 1.6,
                  }}
                >
                  {content}
                </div>
              )}
            </div>
          ))}
        </main>
      </div>
    </div>
  );
}

export default HelpPage;
