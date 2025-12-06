// src/components/Header.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/EELogo.jpg";
import defaultProfilePic from "../assets/ProfilePic.jpg";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";

function Header({
  username = "Admin",
  profilePic,
  role: propRole,
  activeTab,
  setActiveTab,
  showActions = true,
}) {
  const navigate = useNavigate();

  // Map any incoming role to a canonical value
  const normalizeRole = (val) => {
    const r = (val || "").trim().toLowerCase();
    if (["admin", "administrator", "sysadmin"].includes(r)) return "Admin";
    if (["manager"].includes(r)) return "Manager";
    if (["accountant", "accounting"].includes(r)) return "Accountant";
    return ""; 
  };

  const getInitialRole = () => {
    if (propRole) return normalizeRole(propRole);
    const stored = localStorage.getItem("userRole");
    return normalizeRole(stored) || "Admin";
  };

  const [role, setRole] = useState(getInitialRole);

  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout error:", err);
    }

    // Clear stored session info
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("userRole");

    // Send back to main login (safe for all roles)
    navigate("/");
  };


  // Keep in sync with prop/localStorage
  useEffect(() => {
    const fromProp = normalizeRole(propRole);
    if (fromProp && fromProp !== role) {
      setRole(fromProp);
      return;
    }
    if (!fromProp) {
      const stored = normalizeRole(localStorage.getItem("userRole"));
      if (stored && stored !== role) setRole(stored);
    }
  }, [propRole, role]);

  const allTabs = [
    // Admin
    { name: "Dashboard", path: "/admin-home", roles: ["Admin"], state: { tab: "Dashboard" } },
    { name: "Create User", path: "/admin-home", roles: ["Admin"], state: { tab: "Create User" } },
    { name: "Manage Users", path: "/admin-home", roles: ["Admin"], state: { tab: "Manage Users" } },
    { name: "Chart of Accounts", path: "/admin-home", roles: ["Admin"], state: { tab: "Chart of Accounts" } },
    { name: "Messages", path: "/admin-home", roles: ["Admin"], state: { tab: "Messages" } },
    { name: "Event Logs", path: "/event-logs", roles: ["Admin"], state: { tab: "Event Logs" } },
    { name: "Expiration Reports", path: "/admin-home", roles: ["Admin"], state: { tab: "Reports" } },
    { name: "Help", path: "/help", roles: ["Admin"], state: { role: "Admin" } },

    // Manager
    { name: "Dashboard", path: "/manager-home", roles: ["Manager"], state: { tab: "Dashboard" } },
    { name: "Chart of Accounts", path: "/manager-home", roles: ["Manager"], state: { tab: "Chart of Accounts" } },
    { name: "Journal Entries", path: "/manager-home", roles: ["Manager"], state: { tab: "Journal Entries" } },
    { name: "Event Logs", path: "/manager-home", roles: ["Manager"], state: { tab: "Event Logs" } },
    { name: "Reports", path: "/manager-home", roles: ["Manager"], state: { tab: "Reports" } },
    { name: "Messages", path: "/manager-home", roles: ["Manager"], state: { tab: "Messages" } },
    { name: "Help", path: "/help", roles: ["Manager"], state: { role: "Manager" } },

    // Accountant
    { name: "Dashboard", path: "/accountant-home", roles: ["Accountant"], state: { tab: "Dashboard" } },
    { name: "Chart of Accounts", path: "/accountant-home", roles: ["Accountant"], state: { tab: "Chart of Accounts" } },
    { name: "Journal Entries", path: "/accountant-home", roles: ["Accountant"], state: { tab: "Journal Entries" } },
    { name: "Event Logs", path: "/accountant-home", roles: ["Accountant"], state: { tab: "Event Logs" } },
    { name: "Messages", path: "/accountant-home", roles: ["Accountant"], state: { tab: "Messages" } },
    { name: "Help", path: "/help", roles: ["Accountant"], state: { role: "Accountant" } },
  ];

  const visibleTabs = allTabs.filter((t) => t.roles.includes(role));

  return (
    <header
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        padding: "0.85rem 2rem",
        backgroundColor: "#ffffff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        border: "1px solid #e5e7eb",
        borderRadius: "12px",
        width: "96%",
        margin: "1rem auto",
      }}
    >
      {/* Left: Logo */}
      <div
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
        onClick={() => {
          if (role === "Admin") navigate("/admin-home");
          else if (role === "Manager") navigate("/manager-home");
          else if (role === "Accountant") navigate("/accountant-home");
        }}
        title="Return to Home"
      >
        <img src={logo} alt="Company Logo" style={{ height: 55, width: "auto", borderRadius: 8 }} />
        <span style={{ fontWeight: 800, color: "#111827", letterSpacing: 0.25, fontSize: "1.05rem" }}>
          EQUITY EXPERTS
        </span>
      </div>

      {/* Center: Tabs */}
      {showActions && (
        <nav
          aria-label="Main navigation"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            flexGrow: 1,
            flexWrap: "nowrap",
            overflowX: "hidden",
          }}
        >
          {visibleTabs.map((item, i) => (
            <span
              key={i}
              title={item.name}
              onClick={() => {
                setActiveTab?.(item.name);
                item.state ? navigate(item.path, { state: item.state }) : navigate(item.path);
              }}
              style={{
                cursor: "pointer",
                fontWeight: activeTab === item.name ? 700 : 500,
                color: activeTab === item.name ? "#4f46e5" : "#111827",
                fontSize: "0.9rem",
                transition: "color 0.2s ease, transform 0.1s ease",
                userSelect: "none",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.textDecoration = "underline";
                e.currentTarget.style.transform = "scale(1.03)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.textDecoration = "none";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              {item.name}
            </span>
          ))}
        </nav>
      )}

        {/* Right: User */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            position: "relative",
            cursor: "pointer",
          }}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <span style={{ fontWeight: 600, fontSize: "1rem", color: "#111827" }}>
            {username || role}
          </span>
          <img
            src={profilePic || defaultProfilePic}
            alt="Profile"
            style={{
              height: 42,
              width: 42,
              borderRadius: "50%",
              border: "3px solid #c7d2fe",
              objectFit: "cover",
              background: "#f3f4f6",
            }}
            title="Profile"
          />

          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "120%",
                right: 0,
                backgroundColor: "#ffffff",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                padding: "0.5rem 0.75rem",
                minWidth: 130,
                zIndex: 100,
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation(); 
                  handleLogout();
                }}
                style={{
                  background: "none",
                  border: "none",
                  padding: "0.25rem 0",
                  width: "100%",
                  textAlign: "left",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  color: "#111827",
                  cursor: "pointer",
                }}
              >
                Logout
              </button>
            </div>
          )}
        </div>

    </header>
  );
}

export default Header;