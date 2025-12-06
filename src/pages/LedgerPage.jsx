// src/pages/LedgerPage.jsx
import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "../firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  doc,
} from "firebase/firestore";
import Header from "../components/Header";

function LedgerPage() {
  const { accountId } = useParams();
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [ledgerDocs, setLedgerDocs] = useState([]); 
  const [loading, setLoading] = useState(true);

  // prefer canonical stored user & role (non-react state)
  const username = localStorage.getItem("loggedInUser") || "Accountant";
  const userRole = localStorage.getItem("userRole") || "Manager";

  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Helper: parse stored date into a local Date object
  const parseDateLocal = (dateField, timestampField) => {
    // 1) If dateField is a YYYY-MM-DD (no timezone), construct local date to avoid UTC shift
    if (typeof dateField === "string") {
      const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateField);
      if (isoDateOnly) {
        const [y, m, d] = dateField.split("-").map((n) => parseInt(n, 10));
        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
          return new Date(y, m - 1, d); // local midnight (preserves user date)
        }
      }
      // 2) If string but not plain YYYY-MM-DD, try Date constructor (ISO with timezone)
      const parsed = new Date(dateField);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // 3) If a numeric timestamp (ms), use it
    if (typeof timestampField === "number") {
      // if timestamp looks like seconds (10 digits) convert to ms
      if (timestampField < 1e12) {
        return new Date(timestampField * 1000);
      }
      return new Date(timestampField);
    }

    // 4) fallback null
    return null;
  };

  // Fetch account details
  useEffect(() => {
    let mounted = true;
    const fetchAccount = async () => {
      try {
        const ref = doc(db, "accounts", accountId);
        const snap = await getDoc(ref);
        if (mounted && snap.exists()) setAccount({ id: snap.id, ...snap.data() });
      } catch (err) {
        console.error("Error loading account:", err);
      }
    };
    fetchAccount();
    return () => {
      mounted = false;
    };
  }, [accountId]);

  // Fetch ledger entries for this account (real-time)
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "ledgerEntries"), where("accountId", "==", accountId));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => {
          const data = d.data();
          // normalize date into dateObj and keep raw
          const dateObj = parseDateLocal(data.date, data.timestamp);
          return { id: d.id, dateObj, ...data };
        });

        // sort by normalized date (fallback to timestamp or doc id)
        docs.sort((a, b) => {
          const ta = a.dateObj ? a.dateObj.getTime() : a.timestamp || 0;
          const tb = b.dateObj ? b.dateObj.getTime() : b.timestamp || 0;
          return ta - tb;
        });

        setLedgerDocs(docs);
        setLoading(false);
      },
      (err) => {
        console.error("Ledger entries snapshot error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [accountId]);

  if (loading) return <p>Loading ledger...</p>;
  if (!account) return <p>Account not found.</p>;

  // Compute ledger rows and running balance
  const initialBalance = parseFloat(account.initialBalance ?? account.balance ?? 0) || 0;
  let runningBalance = initialBalance;

  const ledgerRows = ledgerDocs.map((le) => {
    // numeric values for debit/credit
    const debit = Number(le.debit || 0);
    const credit = Number(le.credit || 0);

    // date object (already normalized) - fallback to timestamp if present
    const dateObj = le.dateObj || (le.timestamp ? new Date(le.timestamp < 1e12 ? le.timestamp * 1000 : le.timestamp) : null);

    runningBalance = runningBalance + debit - credit;

    return {
      id: le.id,
      dateObj,
      date: dateObj ? dateObj.toISOString().slice(0, 10) : "",
      description: le.description || le.source || "Ledger Entry",
      debit,
      credit,
      balance: runningBalance,
      journalEntryId: le.journalEntryId || null,
      raw: le,
    };
  });

  // Apply filters
  const filtered = ledgerRows.filter((e) => {
    const inRange =
      (!filterFrom || (e.dateObj && new Date(e.dateObj).setHours(0, 0, 0, 0) >= new Date(filterFrom).setHours(0, 0, 0, 0))) &&
      (!filterTo || (e.dateObj && new Date(e.dateObj).setHours(0, 0, 0, 0) <= new Date(filterTo).setHours(0, 0, 0, 0)));

    const matchesSearch =
      !searchTerm ||
      (e.description || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      String(e.debit).includes(searchTerm) ||
      String(e.credit).includes(searchTerm) ||
      (e.journalEntryId && String(e.journalEntryId).toLowerCase().includes(searchTerm.toLowerCase()));

    return inRange && matchesSearch;
  });

  const backRoute =
  userRole === "Admin"
    ? "/admin-home"
    : userRole === "Accountant"
    ? "/accountant-home"
    : "/manager-home";

  const backTabState = { tab: "Chart of Accounts" };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb" }}>
      <Header username={username} role={userRole} />
      <div
        style={{
          width: "95vw",
          margin: "0 auto",
          maxWidth: 1400,
          padding: "2.5rem",
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        }}
      >
        <h2 style={{ color: "#111827" }}>
          Ledger for: <span style={{ color: "#2563eb" }}>{account.accountName}</span>
        </h2>
        <p style={{ color: "#4b5563", marginBottom: "1rem" }}>
          Account Number: {account.accountNumber || "—"}
        </p>

        {/* Filter bar */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ fontWeight: 600 }}>Date From</label>
            <input
              type="date"
              value={filterFrom || ""}
              onChange={(e) => setFilterFrom(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ fontWeight: 600 }}>Date To</label>
            <input
              type="date"
              value={filterTo || ""}
              onChange={(e) => setFilterTo(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <input
              type="text"
              placeholder="description, amount, or PR..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        {/* Ledger table */}
        <table style={tableStyle}>
          <thead style={{ background: "#f3f4f6" }}>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Debit</th>
              <th style={thStyle}>Credit</th>
              <th style={thStyle}>Balance</th>
              <th style={thStyle}>PR</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: "1rem" }}>
                  No ledger entries available for this account.
                </td>
              </tr>
            ) : (
              filtered.map((e) => (
                <tr key={e.id}>
                  <td style={tdStyle}>
                    {e.dateObj ? e.dateObj.toLocaleDateString() : ""}
                  </td>
                  <td style={tdStyle}>{e.description}</td>
                  <td style={{ ...tdStyle, color: "#15803d" }}>{e.debit ? e.debit.toLocaleString() : ""}</td>
                  <td style={{ ...tdStyle, color: "#b91c1c" }}>{e.credit ? e.credit.toLocaleString() : ""}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {e.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={tdStyle}>
                    <span
                      // inside the PR span for each ledger row
                      onClick={() => {
                        const highlightId = e.journalEntryId || e.id;

                        // persist to sessionStorage as a robust fallback (some navigations can lose location.state)
                        try {
                          sessionStorage.setItem("highlightJournalEntryId", String(highlightId));
                        } catch (err) {
                          console.warn("sessionStorage not available for highlightJournalEntryId", err);
                        }

                        // still pass in location.state for the code paths that read it immediately
                        navigate(backRoute, {
                          state: {
                            tab: "Journal Entries",
                            highlightJournalEntryId: String(highlightId),
                            user: username,
                            role: userRole,
                          },
                        });
                      }}

                      style={{
                        color: "#2563eb",
                        cursor: "pointer",
                        textDecoration: "underline",
                        fontWeight: 500,
                      }}
                    >
                      PR
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div style={{ marginTop: "1.5rem" }}>
          <button onClick={() => navigate(backRoute, { state: backTabState })} style={backButtonStyle}>
            ← Back to Chart of Accounts
          </button>
        </div>
      </div>
    </div>
  );
}

// Styles
const thStyle = {
  textAlign: "left",
  padding: "0.75rem",
  color: "#111827",
  fontWeight: 600,
  borderBottom: "1px solid #e5e7eb",
};

const tdStyle = {
  padding: "0.75rem",
  borderBottom: "1px solid #e5e7eb",
  color: "#111827",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  background: "#fff",
  borderRadius: "8px",
  overflow: "hidden",
  boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
};

const inputStyle = {
  border: "1px solid #ccc",
  borderRadius: "6px",
  padding: "0.3rem",
  minWidth: "160px",
};

const backButtonStyle = {
  background: "#3b82f6",
  color: "#fff",
  padding: "0.5rem 1rem",
  borderRadius: "6px",
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
};

export default LedgerPage;