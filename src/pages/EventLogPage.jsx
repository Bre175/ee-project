// src/pages/EventLogPage.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot } from "firebase/firestore";
import Header from "../components/Header";
import profilePic from "../assets/ProfilePic.jpg";

const EventLogPage = () => {
  const [eventLogs, setEventLogs] = useState([]);
  const [adminUser, setAdminUser] = useState({
    username: localStorage.getItem("loggedInUser") || "Admin",
    profilePic: profilePic,
  });

  useEffect(() => { 
    const unsub = onSnapshot(collection(db, "accountEventLogs"), (snapshot) => {
      const logs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      logs.sort((a, b) => b.timestamp - a.timestamp);
      setEventLogs(logs);
    });
    return () => unsub();
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
      }}
    >
      {/* Consistent Header Layout */}
      <div style={{ width: "95vw", margin: "1rem auto", maxWidth: 1400 }}>
        <Header
          username={adminUser.username}
          profilePic={adminUser.profilePic}
          activeTab="Event Logs"
        />
      </div>

      {/* Consistent Main Layout */}
      <div
        style={{
          width: "95vw",
          margin: "0 auto",
          maxWidth: 1400,
          flex: 1,
        }}
      >
        <main
          style={{
            flex: 1,
            padding: "2.5rem",
            backgroundColor: "#ffffff",
          }}
        >
          <h2 style={{ color: "#111827", fontSize: "1.5rem", fontWeight: 700 }}>
            My Event Logs
          </h2>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "1rem",
            }}
          >
            <thead>
              <tr style={{ backgroundColor: "#f9fafb" }}>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Event ID</th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Account ID</th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Action</th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>User</th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Timestamp</th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>Before</th>
                <th style={{ padding: "0.75rem", textAlign: "left" }}>After</th>
              </tr>
            </thead>
            <tbody>
              {eventLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ padding: "0.75rem" }}>{log.id}</td>
                  <td style={{ padding: "0.75rem" }}>{log.accountId}</td>
                  <td
                    style={{
                      padding: "0.75rem",
                      color:
                        log.action === "Added"
                          ? "green"
                          : log.action === "Modified"
                          ? "#3b82f6"
                          : log.action === "Deactivated"
                          ? "red"
                          : "#111827",
                    }}
                  >
                    {log.action}
                  </td>
                  <td style={{ padding: "0.75rem" }}>{log.userId}</td>
                  <td style={{ padding: "0.75rem" }}>
                    {new Date(
                      log.timestamp?.seconds
                        ? log.timestamp.seconds * 1000
                        : log.timestamp
                    ).toLocaleString()}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem",
                      color: "#6b7280",
                      whiteSpace: "pre-wrap",
                      maxWidth: "300px",
                    }}
                  >
                    {log.oldData ? JSON.stringify(log.oldData, null, 2) : "—"}
                  </td>
                  <td
                    style={{
                      padding: "0.75rem",
                      color: "#6b7280",
                      whiteSpace: "pre-wrap",
                      maxWidth: "300px",
                    }}
                  >
                    {log.newData ? JSON.stringify(log.newData, null, 2) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      </div>
    </div>
  );
};

export default EventLogPage;