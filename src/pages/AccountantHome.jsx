/* src/pages/AccountantHome.jsx
*
* Main dashboard page for users with the "Accountant" role. Provides functionality for:
*   - Viewing financial ratios and dashboard metrics
*   - Managing chart of accounts (view-only)
*   - Creating and viewing Journal Entries
*   - Sending/receiving in-app messages
*   - Viewing event logs
*/


// IMPORTS................................................................................................................................................................................................

// React core hooks
import React, { useState, useEffect, useRef } from "react";

// Custom components
import Header from "../components/Header";

// Firebase Firestore database instance
import { db } from "../firebase";

// Firestore functions for CRUD operations and real-time subscriptions
import {
  collection,          // Reference to a Firestore collection
  onSnapshot,          // Real-time listener for data changes
  updateDoc,           // Update existing document
  doc,                 // Reference to a specific document
  getDoc,              // Fetch single document
  addDoc,              // Create new document with auto-generated ID
  getDocs,             // Fetch all documents in a collection
  deleteDoc,           // Delete a document
  serverTimestamp,     // Server-side timestamp for consistency
  query,               // Build queries with filters/ordering
  orderBy,             // Sort query results
  where,               // Filter query results
} from "firebase/firestore";

// Default profile picture asset
import profilePic from "../assets/ProfilePic.jpg";

// React Router hooks for navigation and URL state
import { Link, useLocation } from "react-router-dom";

// HELPER FUNCTIONS (Outside Component)....................................................................................................................................................................

/*
* Sums account balances that match a given filter function.
* Used for calculating financial ratios (current assets, liabilities, etc.)
*/
const sumBy = (accounts, filterFn) => {
  return accounts
    .filter(filterFn)
    .reduce((sum, acc) => sum + Number(acc.balance || 0), 0);
};

/*
* Returns a CSS class name for color-coding financial ratios.
* Green = healthy, Yellow = warning, Red = concerning
*/
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


// MAIN COMPONENT: AccountantHome.........................................................................................................................................................................

function AccountantHome() {

  // STATE VARIABLES - User & Navigation....................................................................
  
  // Current logged-in accountant's information; loaded from Firestore on component mount based on localStorage
  const [accountantUser, setAccountantUser] = useState({
    username: "Accountant",
    profilePic,
    role: "Accountant",
  });
  const location = useLocation();

  // Currently active navigation tab; persisted to localStorage so it survives page refreshes
  const [activeTab, setActiveTab] = useState(() => {
    const savedTab = localStorage.getItem("accountantActiveTab");
    return savedTab || "Dashboard";
  });

  // JOURNAL ENTRY HIGHLIGHTING - For navigation from LedgerPage.............................................
  
  // highlight support 
  const [highlightJournalEntryId, setHighlightJournalEntryId] = useState(null);
  const journalRowRefs = useRef({}); 

  // NAVIGATION & TAB PERSISTENCE - useEffect Hooks..........................................................

  // Handle navigation-triggered tab changes (does NOT reset back to dashboard)
  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    } else {
      const savedTab = localStorage.getItem("accountantActiveTab");
      if (!savedTab) {
        setActiveTab("Dashboard");
      }
    }
  }, [location.state]);
  
  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("accountantActiveTab", activeTab);
  }, [activeTab]);

  // Highlight / scroll to a journal entry when coming from LedgerPage
  useEffect(() => {
    const idFromState = location.state?.highlightJournalEntryId;
    const idFromSession = !idFromState ? sessionStorage.getItem("highlightJournalEntryId") : null;
    const idToHighlight = idFromState || idFromSession;

    if (!idToHighlight) return;

    // Auto-switch to Journal Entries tab
    setActiveTab("Journal Entries");

    // Give table a moment to render then scroll+flash
    setTimeout(() => {
      const el = document.getElementById(`journal-entry-${idToHighlight}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.backgroundColor = "#fef08a"; 
        setTimeout(() => { el.style.backgroundColor = ""; }, 2000);
      }
      try { sessionStorage.removeItem("highlightJournalEntryId"); } catch (e) {}
    }, 500);
  }, [location.state,]);


  // USER DATA LOADING......................................................................................

  // Load logged-in accountant's details from Firestore; uses the username stored in localStorage (set during login) to fetch full user data
  useEffect(() => {
    const fetchUser = async () => {
      const storedUsername = localStorage.getItem("loggedInUser");
      if (!storedUsername) return;
      try {
        const snap = await getDoc(doc(db, "users", storedUsername));
        if (snap.exists()) {
          const d = snap.data();
          setAccountantUser({
            username: d.username || storedUsername,
            profilePic,
            role: d.role || "Accountant",
          });
        }
      } catch (err) {
        console.error("Load user failed:", err);
      }
    };
    fetchUser();
  }, []);


  // CHART OF ACCOUNTS STATE - Account data for financial operations........................................

  // Accounts for select lists
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "accounts"), (snap) => {
      setAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // DERIVED FINANCIAL VALUES - Calculated from accounts for dashboard ratios...............................

  // Current assets & liabilities
  const currentAssets = sumBy(accounts, acc =>
    acc.accountSubcategory === "Current Assets"
  );

  const currentLiabilities = sumBy(accounts, acc =>
    acc.accountSubcategory === "Current Liabilities"
  );

  // Quick assets
  const cash = sumBy(accounts, acc => acc.accountName === "Cash");
  const shortTermInvestments = sumBy(accounts, acc => acc.accountNumber === "170"); // if you classify as liquid
  const accountsReceivable = sumBy(accounts, acc => acc.accountName === "Accounts Receivable");

  // Net sales
  const revenue = sumBy(accounts, acc => acc.statementType === "IS" && acc.normalSide === "Credit");

  // Net income
  const expenses = sumBy(accounts, acc => acc.statementType === "IS" && acc.normalSide === "Debit");
  const netIncome = revenue - expenses;

  // Total assets & liabilities
  const totalAssets = sumBy(accounts, acc => acc.statementType === "BS" && acc.normalSide === "Debit");
  const totalLiabilities = sumBy(accounts, acc => acc.statementType === "BS" && acc.accountCategory === "Liability");

  // Interest & tax expenses (from your new accounts)
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

  
  // MESSAGES STATE - In-app messaging system...............................................................

  // All messages from the messages collection 
  const [messages, setMessages] = useState([]);

  /**
 * Real-time subscription to messages collection
 * Includes both sent and received messages for the user
 */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "messages"), (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

    
  // MESSAGES UI STATE - For compose modal and message display..............................................
   
  // List of all users (for recipient dropdown in compose modal) 
  const [users, setUsers] = useState([]);
  
  // Current sub-tab in Messages: "Inbox" or "Sent" 
  const [activeSubTab, setActiveSubTab] = useState("Inbox");
  
  // Controls visibility of the compose message modal 
  const [showCompose, setShowCompose] = useState(false);
  
  // Compose form state: recipient, subject, and body 
  const [compose, setCompose] = useState({ to: "", subject: "", body: "" });
  
  // Error message for compose form validation 
  const [errorMessage, setErrorMessage] = useState("");
  
  /**
   * Load all users for the recipient dropdown
   * Allows accountant to send messages to any user in the system
   */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      setUsers(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error("Users subscription error:", err);
    });
    return () => unsub();
  }, []);


  // CHART OF ACCOUNTS UI STATE - Filtering and searching accounts.........................................

  // Chart of Accounts UI helpers (for Accountant tab)
  const [searchTerm, setSearchTerm] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  /**
   * Advanced filter criteria for Chart of Accounts
   * Allows filtering by multiple fields simultaneously
   */
  const [filters, setFilters] = useState({
    name: "",
    number: "",
    category: "",
    subcategory: "",
    minAmount: "",
    maxAmount: "",
  });

  // Date range filter for account creation/modification dates 
  const [coaDateRange, setCoaDateRange] = useState({ from: "", to: "" });

  // Controls visibility of date range picker 
  const [coaDateOpen, setCoaDateOpen] = useState(false);


  // BALANCE RECALCULATION - Automatic sync between ledger entries and account balances.....................

  // Automatically recalculates account balances when ledger entries change
  useEffect(() => {
    const recalcBalances = async () => {
      try {
        const ledgerSnap = await getDocs(collection(db, "ledgerEntries"));
        const ledgers = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  
        const totalsById = {};
        const totalsByNumber = {};
  
        ledgers.forEach((e) => {
          const debit = parseFloat(e.debit || 0);
          const credit = parseFloat(e.credit || 0);
          const delta = debit - credit;
  
          if (e.accountId) {
            totalsById[e.accountId] = (totalsById[e.accountId] || 0) + delta;
          }
          if (e.accountNumber) {
            totalsByNumber[e.accountNumber] = (totalsByNumber[e.accountNumber] || 0) + delta;
          }
        });
  
        const accSnap = await getDocs(collection(db, "accounts"));
        for (const docSnap of accSnap.docs) {
          const acc = docSnap.data();
          const docId = docSnap.id;
          const acctNo = acc.accountNumber;
  
          const ledgerSum =
            (totalsById[docId] || 0) +
            ((totalsById[docId] ? 0 : (totalsByNumber[acctNo] || 0)));
  
          const initial = parseFloat(acc.initialBalance || 0);
          const newBalance = initial + ledgerSum;
  
          if (parseFloat(acc.balance || 0) !== newBalance) {
            await updateDoc(doc(db, "accounts", docId), { balance: newBalance });
          }
        }
      } catch (err) {
        console.error("Balance recalculation failed:", err);
      }
    };
  
    const unsubLedgers = onSnapshot(collection(db, "ledgerEntries"), recalcBalances);
    const unsubAccounts = onSnapshot(collection(db, "accounts"), recalcBalances);
  
    return () => {
      unsubLedgers();
      unsubAccounts();
    };
  }, []);


  // JOURNAL ENTRY FORM STATE - For creating new journal entries...........................................

  // FORM state for creating JE
  const emptyDebit = { accountId: "", accountName: "", amount: "" };
  const emptyCredit = { accountId: "", accountName: "", amount: "" };
  const [debits, setDebits] = useState([{ ...emptyDebit }]);
  const [credits, setCredits] = useState([{ ...emptyCredit }]);
  const [jeDate, setJeDate] = useState("");
  const [jeMemo, setJeMemo] = useState("");
  const [attachments, setAttachments] = useState([]); 
  const [accountError, setAccountError] = useState("");
  const [errorSuggestion, setErrorSuggestion] = useState("");
  const [displayErrorCode, setDisplayErrorCode] = useState(null);
  const [saving, setSaving] = useState(false);
  const [debitAccount, setDebitAccount] = useState("");
  const [creditAccount, setCreditAccount] = useState("");
  const [jeAmount, setJeAmount] = useState("");
  const fileInputRef = useRef(null);
  const [invalidAttachments, setInvalidAttachments] = useState([]);
  const formatDateYMD = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };


  // DATE RANGE LIMITS - Restrict JE dates to reasonable window............................................

  const today = new Date();
  const minDateObj = new Date(today);
  minDateObj.setMonth(minDateObj.getMonth() - 1);
  const maxDateObj = new Date(today);
  maxDateObj.setMonth(maxDateObj.getMonth() + 1);
  const minDateStr = formatDateYMD(minDateObj);
  const maxDateStr = formatDateYMD(maxDateObj);


  // DRAFT STATE - For saving incomplete journal entries....................................................

  // Optional draft id (if saved)
  const [draftId, setDraftId] = useState(null);

  // JOURNAL ENTRIES LISTING - Display and filter submitted entries.........................................

  // Journal entries listing
  const [journalEntries, setJournalEntries] = useState([]);
  const [statusFilter, setStatusFilter] = useState("All");
  const [jeDateRange, setJeDateRange] = useState({ from: "", to: "" });
  const [jeSearch, setJeSearch] = useState("");

  // load journal entries (all) - accountants can view all
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "journalEntries"), (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // sort by submittedAt descending if present
      data.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
      setJournalEntries(data);
    });
    return () => unsub();
  }, []);


  // DASHBOARD ALERTS - Derived counts for notifications....................................................

  // Dashboard Alerts (Pending approvals, unfinished drafts, etc.) 
  const pendingApprovals = journalEntries.filter(j => j.status === "Pending").length;
  const draftEntries = journalEntries.filter(j => j.status === "Not Submitted").length;


  // EVENT LOGGING - Audit trail for accountant actions......................................................

  // Accountant event logs: state, writer helper, real-time listener 
  const [accountantEventLogs, setAccountantEventLogs] = useState([]);

  // Centralized writer used by accountant actions (creates docs in accountantAccountEventLogs)
  const logAccountantEvent = async ({
    accountId = null,
    action,
    userId = accountantUser?.username || "Accountant",
    oldData = null,
    newData = null,
  }) => {
    try {
      await addDoc(collection(db, "accountantAccountEventLogs"), {
        accountId: accountId || null,
        action,
        userId: userId || accountantUser?.username || "Accountant",
        oldData: oldData || null,
        newData: newData || null,
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to write accountant event log:", err);
    }
  };

  // Real-time subscription (most recent first)
  useEffect(() => {
    try {
      const q = query(collection(db, "accountantAccountEventLogs"), orderBy("timestamp", "desc"));
      const unsub = onSnapshot(
        q,
        (snapshot) => {
          const logs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setAccountantEventLogs(logs);
        },
        (err) => {
          console.error("Accountant event logs subscription error:", err);
        }
      );
      return () => unsub();
    } catch (err) {
      console.error("Failed to subscribe to accountantAccountEventLogs:", err);
    }
  }, []);


  // JOURNAL ENTRY FORM HELPERS - Account selection and row management......................................

  // Helper: set accountName when accountId changes 
  const onDebitAccountChange = (idx, accountId) => {
    const acc = accounts.find((a) => a.id === accountId);
    setDebits((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, accountId, accountName: acc?.accountName || "" } : r))
    );
  };
  const onCreditAccountChange = (idx, accountId) => {
    const acc = accounts.find((a) => a.id === accountId);
    setCredits((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, accountId, accountName: acc?.accountName || "" } : r))
    );
  };


  // ROW MANAGEMENT - Add/remove debit and credit rows.......................................................

  // Add / remove rows
  const addDebitRow = () => setDebits((d) => [...d, { ...emptyDebit }]);
  const addCreditRow = () => setCredits((c) => [...c, { ...emptyCredit }]);
  const removeDebitRow = (i) => setDebits((d) => d.filter((_, idx) => idx !== i));
  const removeCreditRow = (i) => setCredits((c) => c.filter((_, idx) => idx !== i));


  // AMOUNT VALIDATION - Real-time validation as user types..................................................

  // Add small helper so single-amount-per-row behaviour matches manager UI
  const handleAmountChange = (idx, value) => {
    const val = value === "" ? "" : value;
    setDebits((d) => d.map((r, i) => (i === idx ? { ...r, amount: val } : r)));
    setCredits((c) => c.map((r, i) => (i === idx ? { ...r, amount: val } : r)));

    // normalize and pre-validate malformed strings so we show banner immediately
    const raw = val === null || val === undefined ? "" : String(val).trim();
    const cleaned = raw.replace(/,/g, ""); // accept thousands separators

    // if user started typing something clearly non-numeric 
    if (raw !== "" && !/^(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) {
      (async () => {
        await setValidationError("JE_INVALID_AMOUNT", "Enter a valid numeric amount.");
        try {
          await writeErrorLog({
            errorCode: "JE_INVALID_AMOUNT",
            message: "Invalid amount input (inline validation)",
            context: "JournalEntry",
            user: accountantUser.username,
            payload: { rowIndex: idx, raw, cleaned },
          });
        } catch (err) {
        }
      })();
      return;
    }

    // parse numeric value after cleaning
    const n = cleaned === "" ? NaN : parseFloat(cleaned);

    // numeric range checks (zero/negative)
    if (raw !== "" && (!Number.isFinite(n) || n <= 0)) {
      (async () => {
        if (!Number.isFinite(n)) {
          await setValidationError("JE_INVALID_AMOUNT", "Enter a valid numeric amount.");
          try {
            await writeErrorLog({
              errorCode: "JE_INVALID_AMOUNT",
              message: "Invalid amount input (not finite) - inline",
              context: "JournalEntry",
              user: accountantUser.username,
              payload: { rowIndex: idx, raw, cleaned },
            });
          } catch (err) {}
        } else if (n < 0) {
          await setValidationError("JE_NEGATIVE_AMOUNT", "Amount must be greater than zero.");
          try {
            await writeErrorLog({
              errorCode: "JE_NEGATIVE_AMOUNT",
              message: "Negative amount entered - inline",
              context: "JournalEntry",
              user: accountantUser.username,
              payload: { rowIndex: idx, amount: n },
            });
          } catch (err) {}
        } else {
          await setValidationError("JE_ZERO_AMOUNT", "Amount must be greater than zero.");
          try {
            await writeErrorLog({
              errorCode: "JE_ZERO_AMOUNT",
              message: "Zero amount entered - inline",
              context: "JournalEntry",
              user: accountantUser.username,
              payload: { rowIndex: idx, amount: n },
            });
          } catch (err) {}
        }
      })();
      return;
    }

    setAccountError("");
    setErrorSuggestion("");
    setDisplayErrorCode(null);
  };


  // FILE ATTACHMENT HANDLING...............................................................................  

  // Attach files as data URLs 
  const supportedTypes = [
    "application/pdf",
    // word -> docx but browsers may report different mime; allow common ones
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "image/jpeg",
    "image/png",
  ];

  const handleFileInput = async (fileList) => {
    try {
      // reset invalid list each time user selects files
      setInvalidAttachments([]);
      const files = Array.from(fileList || []).slice(0, 6);
      const bad = [];

      for (const f of files) {
        // unsupported mime
        if (!supportedTypes.includes(f.type)) {
          bad.push({ name: f.name, type: f.type });
          // log + show canonical DB message (existing behavior)
          try {
            await writeErrorLog({
              errorCode: "JE_ATTACHMENT_INVALID_TYPE",
              message: `Unsupported file type: ${f.type}`,
              context: "JournalEntry",
              user: accountantUser?.username || "unknown",
              payload: { filename: f.name, filetype: f.type },
            });
          } catch (err) {
            console.error("writeErrorLog failed:", err);
          }
          await setValidationError("JE_ATTACHMENT_INVALID_TYPE", `Unsupported file type: ${f.name}`);
          // do not add to attachments array
          continue;
        }

        try {
          if (f.size && f.size > 15 * 1024 * 1024) {
            bad.push({ name: f.name, type: f.type, reason: "too_large" });
            try {
              await writeErrorLog({
                errorCode: "JE_ATTACHMENT_TOO_LARGE",
                message: `Attachment too large: ${f.name}`,
                context: "JournalEntry",
                user: accountantUser?.username || "unknown",
                payload: { filename: f.name, size: f.size },
              });
            } catch (err) {
              console.error("writeErrorLog failed:", err);
            }
            await setValidationError("JE_ATTACHMENT_TOO_LARGE", "Attachment too large. Max 15 MB per file.");
            continue;
          }

          const dataUrl = await readFileAsDataURL(f);

          setAttachments((prev) => [
            ...prev,
            {
              name: f.name,
              type: f.type,
              size: f.size,
              dataUrl,
              uploadedAt: Date.now(),
              uploadedBy: accountantUser?.username || "unknown", // <-- fixed here
            },
          ]);
        } catch (err) {
          console.error("File read error", err);
          bad.push({ name: f.name, type: f.type, reason: "read_failed" });
        }
      }

      // update invalidAttachments state once after processing selection
      if (bad.length) {
        setInvalidAttachments(bad);
      } else {
        setInvalidAttachments([]);
        // if the current accountError was caused by a previous invalid attachment, clear it
        if (displayErrorCode === "JE_ATTACHMENT_INVALID_TYPE" || displayErrorCode === "JE_ATTACHMENT_TOO_LARGE") {
          setAccountError("");
          setErrorSuggestion("");
          setDisplayErrorCode(null);
        }
      }
    } catch (err) {
      // unexpected runtime error — log and show non-blocking validation message instead of crashing
      console.error("handleFileInput unexpected error:", err);
      await setValidationError("JE_ATTACHMENT_PROCESSING_ERROR", "Failed to process selected file(s). Try again or contact support.");
      try {
        await writeErrorLog({
          errorCode: "JE_ATTACHMENT_PROCESSING_ERROR",
          message: "Unexpected error in handleFileInput",
          context: "JournalEntry",
          user: accountantUser?.username || "unknown",
          payload: { message: String(err && err.message) },
        });
      } catch (e) {
        console.error("writeErrorLog failed in outer catch:", e);
      }
    }
  };


  // FILE READING UTILITY..................................................................................  

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }


  // ERROR LOGGING SYSTEM...................................................................................

  // Error logging helper (writes a minimal error log doc) 
  const writeErrorLog = async ({
    errorCode,
    message,
    context = "JournalEntry",
    contextId = null,
    user = accountantUser.username || "unknown",
    payload = null,
    severity = "error",
  }) => {
    try {
      await addDoc(collection(db, "errorLogs"), {
        errorCode,
        message,
        context,
        contextId,
        user,
        payload,
        severity,
        resolved: false,
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to write error log:", err);
    }
  };

  // Fetch canonical message + suggestion from errorMessages collection 
  const getErrorMessageDoc = async (errorCode) => {
    if (!errorCode) return null;
    try {
      const snap = await getDoc(doc(db, "errorMessages", errorCode));
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        code: errorCode,
        message: data.message || "",
        suggestion: data.suggestion || "",
      };
    } catch (err) {
      console.error("Failed to fetch errorMessages doc:", err);
      return null;
    }
  };

  // helper to set validation error (fetches canonical message if available)
  const setValidationError = async (errorCode, fallbackMessage = "") => {
    // immediate synchronous UI so banner appears even if DB call is slow/fails
    setAccountError(fallbackMessage || "Validation error.");
    setErrorSuggestion("");
    setDisplayErrorCode(errorCode);

    // then try to fetch canonical message from DB and overwrite if present
    try {
      const em = await getErrorMessageDoc(errorCode);
      if (em) {
        setAccountError(em.message || fallbackMessage || "Validation error.");
        setErrorSuggestion(em.suggestion || "");
        setDisplayErrorCode(em.code || errorCode);
      }
      return;
    } catch (err) {
      console.error("setValidationError: failed to fetch canonical message", err);
      return;
    }
  };


  // ATTACHMENT UTILITIES..................................................................................

  const removeAttachment = (index) => setAttachments((a) => a.filter((_, i) => i !== index));

  // robust openAttachment - handles data: URIs and remote URLs; falls back to download
  const openAttachment = async (att) => {
    try {
      if (!att) return;
      // canonical href: prefer remote url then dataUrl
      const href = (att.url && String(att.url)) || (att.dataUrl && String(att.dataUrl)) || null;
      if (!href) {
        alert("Attachment URL not available.");
        return;
      }

      if (href.startsWith("data:")) {
        const resp = await fetch(href);
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);

        const newWin = window.open();
        if (newWin) {
          const safeTitle = (att.name || "attachment").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          newWin.document.write(
            `<!doctype html><html><head><title>${safeTitle}</title><meta charset="utf-8" /></head>
            <body style="margin:0"><iframe src="${objectUrl}" frameborder="0" style="width:100%;height:100vh"></iframe></body></html>`
          );
          newWin.document.close();
          setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
          return;
        }

        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = att.name || "attachment";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
        return;
      }

      const newWin = window.open(href, "_blank", "noopener,noreferrer");
      if (newWin) return;

      const a2 = document.createElement("a");
      a2.href = href;
      a2.target = "_blank";
      a2.download = att.name || "";
      document.body.appendChild(a2);
      a2.click();
      a2.remove();
    } catch (err) {
      console.error("openAttachment error:", err);
      alert("Unable to open attachment.");
    }
  };


  // COMPUTED VALUES - Running totals for balance validation...............................................

  // compute totals
  const totalDebits = debits.reduce((s, r) => s + (parseFloat(r.amount || 0) || 0), 0);
  const totalCredits = credits.reduce((s, r) => s + (parseFloat(r.amount || 0) || 0), 0);


  // DRAFT MANAGEMENT - Save incomplete entries for later...................................................

  // Save a draft to jeDrafts collection
  const saveDraft = async () => {
    try {
      const payload = {
        debits,
        credits,
        jeDate,
        jeMemo,
        attachments,
        savedBy: accountantUser.username,
        savedAt: Date.now(),
      };
      if (draftId) {
        await updateDoc(doc(db, "jeDrafts", draftId), { ...payload, updatedAt: Date.now() });
        alert("Draft updated");
      } else {
        const ref = await addDoc(collection(db, "jeDrafts"), payload);
        setDraftId(ref.id);
        alert("Draft saved");
      }
    } catch (err) {
      console.error("Save draft error:", err);
      alert("Failed to save draft");
    }
  };

  // Reset form (clears but DOES NOT delete saved draft)
  const resetForm = () => {
    setDebits([{ ...emptyDebit }]);
    setCredits([{ ...emptyCredit }]);
    setJeDate("");
    setJeMemo("");
    setAttachments([]);
    setInvalidAttachments([]);
    setAccountError("");
    setDebitAccount("");
    setCreditAccount("");
    setJeAmount("");
    // also clear the file input's selected files
    if (fileInputRef.current) fileInputRef.current.value = null;
  };

  // Cancel: delete draft (if exists) and reset
  const cancelForm = async () => {
    if (draftId) {
      try {
        await deleteDoc(doc(db, "jeDrafts", draftId));
        setDraftId(null);
      } catch (err) {
        console.error("Delete draft failed:", err);
      }
    }
    resetForm();
  };


  // VALIDATION AND SUBMISSION - Validate form and prepare data for submission.............................

  const validateAndPrepare = async (statusForDB = "Pending") => {
    // clear any previous error
    setAccountError("");

    // 1) Date required
    if (!jeDate) {
      await setValidationError("JE_DATE_MISSING", "Please select a date for the journal entry.");
      await writeErrorLog({
        errorCode: "JE_DATE_MISSING",
        message: "Journal entry missing date",
        context: "JournalEntry",
        contextId: draftId || null,
        user: accountantUser.username,
        payload: { date: jeDate },
      });
      return null;
    }

    // 1b) Date range: between one month before today and one month after
    try {
      const chosen = new Date(jeDate + "T00:00:00"); // avoid timezone shift
      const minD = new Date(minDateStr + "T00:00:00");
      const maxD = new Date(maxDateStr + "T23:59:59");
      if (chosen < minD || chosen > maxD) {
        await setValidationError("JE_DATE_OUT_OF_RANGE", `Date must be between ${minDateStr} and ${maxDateStr}.`);
        await writeErrorLog({
          errorCode: "JE_DATE_OUT_OF_RANGE",
          message: "Journal entry date out of allowed range",
          context: "JournalEntry",
          contextId: draftId || null,
          user: accountantUser.username,
          payload: { date: jeDate, allowedRange: { min: minDateStr, max: maxDateStr } },
        });
        return null;
      }
    } catch (err) {
    }

    // 2) Memo length check (DB-driven msg JE_MEMO_TOO_LONG)
    const MEMO_MAX = 250; 
    if (jeMemo && jeMemo.length > MEMO_MAX) {
      await setValidationError("JE_MEMO_TOO_LONG", `Memo is too long (max ${MEMO_MAX} characters).`);
      await writeErrorLog({
        errorCode: "JE_MEMO_TOO_LONG",
        message: "Memo exceeded allowed length",
        context: "JournalEntry",
        contextId: draftId || null,
        user: accountantUser.username,
        payload: { length: jeMemo.length, limit: MEMO_MAX },
      });
      return null;
    }

    // helper to find account name quickly
    const nameById = (id) => accounts.find((a) => a.id === id)?.accountName || "";

    const debitLines = [];
    const creditLines = [];

    // walk visual rows
    for (let i = 0; i < Math.max(debits.length, credits.length); i++) {
      const d = debits[i] || {};
      const c = credits[i] || {};
    const amtStr = d?.amount !== undefined && d?.amount !== "" ? d.amount : c?.amount;

    // skip empty rows
    if (!amtStr && amtStr !== 0) continue;

    // robust normalization and validation for malformed inputs (covers '--', '1,2,3', 'abc', '')
    const rawAmtStr = amtStr === null || amtStr === undefined ? "" : String(amtStr).trim();
    // remove common thousands separators so '1,000.50' is accepted
    const cleaned = rawAmtStr.replace(/,/g, "");

    // reject clearly malformed strings before coercion
    if (cleaned === "" || !/^(\d+(\.\d+)?|\.\d+)$/.test(cleaned)) {
      await setValidationError("JE_INVALID_AMOUNT", "Please enter a valid amount for each populated row.");
      await writeErrorLog({
        errorCode: "JE_INVALID_AMOUNT",
        message: "Invalid amount value in JE row",
        context: "JournalEntry",
        contextId: draftId || null,
        user: accountantUser.username,
        payload: { rowIndex: i, raw: amtStr, cleaned },
      });
      return null;
    }

    // parse the cleaned decimal string
    const amt = parseFloat(cleaned);

    // safety: ensure finite number
    if (!Number.isFinite(amt)) {
      await setValidationError("JE_INVALID_AMOUNT", "Please enter a valid amount for each populated row.");
      await writeErrorLog({
        errorCode: "JE_INVALID_AMOUNT",
        message: "Invalid amount value in JE row (not finite)",
        context: "JournalEntry",
        contextId: draftId || null,
        user: accountantUser.username,
        payload: { rowIndex: i, raw: amtStr, cleaned },
      });
      return null;
    }

    // negative value check
    if (amt < 0) {
      await setValidationError("JE_NEGATIVE_AMOUNT", "Amount cannot be negative. Use positive values only.");
      await writeErrorLog({
        errorCode: "JE_NEGATIVE_AMOUNT",
        message: "Negative amount in journal entry row",
        context: "JournalEntry",
        contextId: draftId || null,
        user: accountantUser.username,
        payload: { rowIndex: i, amount: amt },
      });
      return null;
    }

    // zero value check
    if (amt === 0) {
      await setValidationError("JE_ZERO_AMOUNT", "Amount cannot be zero. Enter a positive value.");
      await writeErrorLog({
        errorCode: "JE_ZERO_AMOUNT",
        message: "Zero amount in journal entry row",
        context: "JournalEntry",
        contextId: draftId || null,
        user: accountantUser.username,
        payload: { rowIndex: i, amount: amt },
      });
      return null;
    }

      // if debit amount present but no debit account selected
      if (d?.amount && (!d.accountId || d.accountId.trim() === "")) {
        await setValidationError("JE_MISSING_DEBIT", "Please select a debit account for the row with amount.");
        await writeErrorLog({
          errorCode: "JE_MISSING_DEBIT",
          message: "Missing debit account for a populated row",
          context: "JournalEntry",
          contextId: draftId || null,
          user: accountantUser.username,
          payload: { rowIndex: i, debit: d },
        });
        return null;
      }

      // if credit amount present but no credit account selected
      if (c?.amount && (!c.accountId || c.accountId.trim() === "")) {
        await setValidationError("JE_MISSING_CREDIT", "Please select a credit account for the row with amount.");
        await writeErrorLog({
          errorCode: "JE_MISSING_CREDIT",
          message: "Missing credit account for a populated row",
          context: "JournalEntry",
          contextId: draftId || null,
          user: accountantUser.username,
          payload: { rowIndex: i, credit: c },
        });
        return null;
      }

      // Prevent same account on both sides of the same row (if both selected)
      if (d.accountId && c.accountId && d.accountId === c.accountId) {
        await setValidationError("JE_SAME_ACCOUNT_BOTH_SIDES", "A single account cannot be both debit and credit in the same row.");
        await writeErrorLog({
          errorCode: "JE_SAME_ACCOUNT_BOTH_SIDES",
          message: "Same account used on both debit and credit in a row",
          context: "JournalEntry",
          contextId: draftId || null,
          user: accountantUser.username,
          payload: { rowIndex: i, debit: d, credit: c },
        });
        return null;
      }

      // normalize each side's amount using same cleaning rules as validation
      if (d.accountId && d.amount !== undefined && d.amount !== "") {
        const dRaw = String(d.amount).trim();
        const dClean = dRaw.replace(/,/g, "");
        const dAmt = Number.isFinite(parseFloat(dClean)) ? parseFloat(dClean) : NaN;
        debitLines.push({
          accountId: d.accountId,
          accountName: d.accountName || nameById(d.accountId),
          amount: dAmt,
        });
      }
      if (c.accountId && c.amount !== undefined && c.amount !== "") {
        const cRaw = String(c.amount).trim();
        const cClean = cRaw.replace(/,/g, "");
        const cAmt = Number.isFinite(parseFloat(cClean)) ? parseFloat(cClean) : NaN;
        creditLines.push({
          accountId: c.accountId,
          accountName: c.accountName || nameById(c.accountId),
          amount: cAmt,
        });
      }

    } // end loop

    // must have at least one side populated
    if (debitLines.length === 0 && creditLines.length === 0) {
      await setValidationError("JE_NO_ROWS", "Add at least one row with a positive amount.");
      await writeErrorLog({
        errorCode: "JE_NO_ROWS",
        message: "Journal entry has no populated rows",
        context: "JournalEntry",
        contextId: draftId || null,
        user: accountantUser.username,
        payload: { debits, credits },
      });
      return null;
    }

    // totals
    const totalDebits = debitLines.reduce((s, r) => s + r.amount, 0);
    const totalCredits = creditLines.reduce((s, r) => s + r.amount, 0);

    // legacy single-line back-compat if exact 1:1
    const legacy =
      debitLines.length === 1 && creditLines.length === 1
        ? {
            debitAccountId: debitLines[0].accountId,
            debitAccountName: debitLines[0].accountName,
            creditAccountId: creditLines[0].accountId,
            creditAccountName: creditLines[0].accountName,
            amount: debitLines[0].amount,
          }
        : {};

    return {
      debits: debitLines,
      credits: creditLines,
      totalDebits,
      totalCredits,
      date: jeDate,
      memo: jeMemo || "",
      attachments,
      status: statusForDB,
      createdBy: accountantUser.username,
      createdAt: Date.now(),
      submittedBy: statusForDB === "Pending" ? accountantUser.username : null,
      submittedAt: statusForDB === "Pending" ? Date.now() : null,
      ...legacy,
    };
  };


  // JOURNAL ENTRY SUBMISSION - Main submit handler.........................................................

  // Submit JE: write to journalEntries
  const submitJournalEntry = async (e) => {
    e?.preventDefault();

    const payload = await validateAndPrepare();
    if (!payload) return;

    setSaving(true);

    try {
      // 1. SAVE JOURNAL ENTRY
      const docRef = await addDoc(collection(db, "journalEntries"), payload);

      // 2. SEND IN-APP NOTIFICATION TO ALL ACTIVE MANAGERS
      try {
        const managersSnap = await getDocs(
          query(
            collection(db, "users"),
            where("role", "==", "Manager"),
            where("active", "==", true)
          )
        );

        const msgRef = collection(db, "messages");

        const notifications = managersSnap.docs.map((mgr) =>
          addDoc(msgRef, {
            from: accountantUser.username,
            to: mgr.data().username,                         // manager username
            subject: `Journal Entry Pending Review – JE #${docRef.id}`,
            message: `A new Journal Entry requires your approval.

            Journal Entry ID: ${docRef.id}
            Date: ${payload.date}
            Submitted by: ${accountantUser.username}

  `,
            timestamp: Date.now(),
            read: false,
            type: "system-alert"
          })
        );

        await Promise.all(notifications);
        console.log("Manager notifications sent.");
      } catch (err) {
        console.error("Manager notification failed:", err);
      }

      // 3. LOG ACCOUNTANT EVENT
      try {
        await logAccountantEvent({
          accountId: null,
          action: "SubmittedJournalEntry",
          userId: accountantUser.username,
          oldData: null,
          newData: { journalEntryId: docRef.id, ...payload },
        });
      } catch (err) {
        console.warn("logAccountantEvent failed for submit:", err);
      }

      // 4. DELETE DRAFT IF IT EXISTS
      if (draftId) {
        try {
          await deleteDoc(doc(db, "jeDrafts", draftId));
          setDraftId(null);
        } catch (err) {
          console.warn("Failed to delete associated draft:", err);
        }
      }

      // 5. RESET FORM + FEEDBACK
      resetForm();
      alert("Journal entry submitted (Pending approval).");

    } catch (err) {
      console.error("Submit JE failed:", err);
      alert("Failed to submit journal entry.");
    } finally {
      setSaving(false);
    }
  };


  // ADDITIONAL ENTRY OPERATIONS............................................................................

  // Create -> writes entry with status "Not Submitted"
  const createJournalEntry = async (e) => {
    e?.preventDefault();
    const payload = await validateAndPrepare("Not Submitted");
    if (!payload) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "journalEntries"), payload);
      // reset the form after creating a "not submitted" entry
      resetForm();
      alert("Journal entry created (Not Submitted). You can Submit or Cancel it from the list.");
    } catch (err) {
      console.error("Create JE failed:", err);
      alert("Failed to create journal entry.");
    } finally {
      setSaving(false);
    }
  };

  // Submit an existing 'Not Submitted' entry -> set status to Pending
  const submitEntry = async (entryId) => {
    if (!entryId) return;
    try {
      await updateDoc(doc(db, "journalEntries", entryId), {
        status: "Pending",
        submittedBy: accountantUser.username,
        submittedAt: Date.now(),
      });
    } catch (err) {
      console.error("Submit entry failed:", err);
      alert("Failed to submit entry.");
    }
  };

  // Cancel/delete an existing 'Not Submitted' entry
  const cancelEntry = async (entryId) => {
    if (!entryId) return;
    if (!window.confirm("Are you sure you want to cancel (delete) this entry? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, "journalEntries", entryId));
    } catch (err) {
      console.error("Cancel entry (delete) failed:", err);
      alert("Failed to cancel (delete) entry.");
    }
  };


  // DATE FORMATTING UTILITY................................................................................

  // helper to format dates without timezone-shift for "YYYY-MM-DD" inputs
  const formatDate = (val) => {
    if (!val) return "—";
    // number (timestamp ms)
    if (typeof val === "number") {
      return new Date(val).toLocaleDateString();
    }
    // plain date string YYYY-MM-DD (from <input type="date">)
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const [y, m, d] = val.split("-");
      return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString();
    }
    // ISO / full date fallback
    try {
      return new Date(val).toLocaleDateString();
    } catch (err) {
      return String(val);
    }
  };


  // JOURNAL ENTRIES FILTERING - Filter and search for display.............................................

  // Filtering & searching Journal Entries list
  const filteredJournalEntries = journalEntries
    .filter((entry) => {
      if (statusFilter !== "All" && entry.status !== statusFilter) return false;
      if (jeDateRange.from && new Date(entry.date) < new Date(jeDateRange.from)) return false;
      if (jeDateRange.to && new Date(entry.date) > new Date(jeDateRange.to)) return false;
      if (!jeSearch) return true;
      const q = jeSearch.toLowerCase();
      // search by account names (in debits or credits), amount, date
      const debitNames = (entry.debits || []).map((d) => d.accountName || "").join(" ");
      const creditNames = (entry.credits || []).map((c) => c.accountName || "").join(" ");
      if (debitNames.toLowerCase().includes(q) || creditNames.toLowerCase().includes(q)) return true;
      if (String(entry.totalAmount || entry.amount || "").includes(q)) return true;
      if (formatDate(entry.date).includes(q)) return true;
      return false;
    })
    .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
  

  // RENDER.............................................................................................................................................
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
        < Header
          username={accountantUser.username}
          profilePic={accountantUser.profilePic}
          role={accountantUser.role}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />
      </div>


      {/* LAYOUT */}
      <div style={{ display: "flex", flex: 1, width: "95vw", margin: "0 auto", maxWidth: 1400 }}>
        <main style={{ flex: 1, padding: "2.5rem", backgroundColor: "#ffffff" }}>
        {accountError && (
          <div
            style={{
              background: "#fff5f5",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              padding: "0.75rem 1rem",
              borderRadius: 8,
              marginBottom: "1rem",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontWeight: 700 }}>{accountError}</div>
            {errorSuggestion && <div style={{ marginTop: "0.25rem", color: "#991b1b" }}>{errorSuggestion}</div>}
          </div>
        )}





          {/* DASHBOARD............................................................................................................................... */} 
          {activeTab === "Dashboard" && (
            <>
              <h2 style={{ color: "#111827", fontSize: "1.5rem", width: "95vw", margin: "0 auto", marginTop: "0.75rem", maxWidth: 1325 }}>Accountant Dashboard</h2>
              <p style={{ marginTop: "0.75rem", color: "#374151", fontSize: "1rem" }}>
                Use the top navigation to view accounts, record and review journal entries, track system activity, communicate, and access support resources.
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


            {/* Important Alerts Section (Pending Approvals, etc.) */}
            <div style={{
              marginTop: "32px",
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "16px"
            }}>
              <h3 style={{ marginBottom: "12px" }}>Important Notifications</h3>

              {/* Pending Journal Entries for Approval */}
              <div style={{
                marginBottom: "8px",
                fontSize: "1rem",
                color: pendingApprovals > 0 ? "#b91c1c" : "#1f2937",
                fontWeight: pendingApprovals > 0 ? 700 : 500
              }}>
                {pendingApprovals > 0
                  ? `There are ${pendingApprovals} journal entries waiting for approval.`
                  : "No pending journal entries requiring approval."}
              </div>
            </div>
            </>
          )}



          {/* Chart of Accounts....................................................................................................................... */}
          {activeTab === "Chart of Accounts" && (
            <div className="chart-of-accounts" style={{ position: "relative", width: "95vw", margin: "0 auto", marginTop: "0.75rem", maxWidth: 1325}}>
              <h2 style={{ color: "#111827" }}>Chart of Accounts</h2>

              {/* Control bar: Date, Filter, Search */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                  width: "100%",
                  marginBottom: "1.5rem",
                }}
              >
                {/* Date range */}
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
                      {coaDateRange?.from ? `From: ${coaDateRange.from}` : "From: —"}
                      &nbsp;|&nbsp;
                      {coaDateRange?.to ? `To: ${coaDateRange.to}` : "To: —"}
                    </span>
                  )}

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
                              setCoaDateRange((prev) => ({ ...prev, from: e.target.value }))
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
                              setCoaDateRange((prev) => ({ ...prev, to: e.target.value }))
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

                        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
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

                {/* Filter popover */}
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

                {/* Search */}
                <div 
                style={{
                  display: "flex",
                  flexDirection: "column",
                  minWidth: "200px",
                  marginTop: "17px",
                }}
              >
                  <label style={{ marginBottom: "0rem" }}></label>
                  <input
                    type="text"
                    placeholder="Search by name, number, or category..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                      width: "400px",
                      height: "20px",
                      padding: "0.5rem 1rem",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                    }}
                  />
                </div>
              </div>

              {/* Accounts table */}
              <h3 style={{ color: "#111827", marginTop: "2rem" }}>Accounts List</h3>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  marginTop: "1rem",
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: "#f9fafb" }}>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Account Name</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Account Number</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Category</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Balance</th>
                    <th style={{ padding: "0.75rem", textAlign: "left" }}>Status</th>
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
                          a.accountCategory
                            ?.toLowerCase()
                            .includes(filters.category.toLowerCase())) &&
                        (!filters.subcategory ||
                          a.accountSubcategory
                            ?.toLowerCase()
                            .includes(filters.subcategory.toLowerCase())) &&
                        (!filters.minAmount ||
                          parseFloat(a.balance) >= parseFloat(filters.minAmount)) &&
                        (!filters.maxAmount ||
                          parseFloat(a.balance) <= parseFloat(filters.maxAmount));

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
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}


          {/* JOURNAL ENTRIES.......................................................................................................................... */} 
          {activeTab === "Journal Entries" && (
            <div style={{ paddingTop: "0.25rem", width: "95vw", margin: "0 auto", maxWidth: 1400, marginTop: "0.75rem", maxWidth: 1325 }}>
              <h2 style={{ color: "#111827" }}>Journal Entries</h2>
              <h3 style={{ color: "#111827" }}>Create Journal Entry</h3>

              <form
                onSubmit={submitJournalEntry}
                style={{
                  marginTop: "1rem",
                  background: "#fff",
                  borderRadius: 8,
                  padding: "1rem 1rem 1rem 0",   
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  width: "100%",
                }}
              >
                {/* Multi-row Debit/Credit + Amount Rows */}
                {debits.map((_, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      gap: "1rem",
                      alignItems: "center",
                      flexWrap: "wrap",
                      marginBottom: "0.75rem",
                    }}
                  >
                    {/* Debit Account */}
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <label style={{ marginBottom: "0.5rem", fontWeight: 600 }}>Debit Account</label>
                      <select
                        value={debits[idx].accountId}
                        onChange={(e) => onDebitAccountChange(idx, e.target.value)}
                        style={{
                          width: "220px",
                          padding: "0.45rem",
                          borderRadius: 6,
                          border: "1px solid #ccc",
                        }}
                      >
                        <option value="">-- Select Account --</option>
                        {accounts
                          .filter((a) => a.active)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.accountNumber} - {a.accountName}
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Credit Account */}
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <label style={{ marginBottom: "0.5rem", fontWeight: 600 }}>Credit Account</label>
                      <select
                        value={credits[idx]?.accountId || ""}
                        onChange={(e) => onCreditAccountChange(idx, e.target.value)}
                        style={{
                          width: "220px",
                          padding: "0.45rem",
                          borderRadius: 6,
                          border: "1px solid #ccc",
                        }}
                      >
                        <option value="">-- Select Account --</option>
                        {accounts
                          .filter((a) => a.active)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.accountNumber} - {a.accountName}
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Amount */}
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <label style={{ marginTop: "1rem", marginBottom: "0.8rem", fontWeight: 600 }}>Amount</label>
                      <input
                        type="text"                            
                        inputMode="decimal"                  
                        pattern="[\d,]*[.]?\d*"               
                        placeholder="0.00"
                        value={debits[idx].amount}
                        onChange={(e) => handleAmountChange(idx, e.target.value)}
                        style={{
                          width: "160px",
                          padding: "0.45rem",
                          borderRadius: 6,
                          border: "1px solid #ccc",
                          minWidth: "120px",
                          minHeight: "17px",
                          marginTop: "-0.2rem",
                          marginBottom: "1.2rem",
                        }}
                        onInvalid={(ev) => ev.preventDefault()}
                      />

                    </div>

                    {/* Remove + Add buttons */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginTop: "1.1rem",
                      }}
                    >
                      {debits.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeDebitRow(idx)}
                          style={{
                            background: "#ef4444",
                            color: "#fff",
                            border: "none",
                            borderRadius: 6,
                            padding: "0.45rem 0.6rem",
                            cursor: "pointer",
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minHeight: "35px",
                          }}
                        >
                          Remove
                        </button>
                      )}

                      {idx === debits.length - 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setDebits((prev) => [...prev, { accountId: "", accountName: "", amount: "" }]);
                            setCredits((prev) => [...prev, { accountId: "", accountName: "", amount: "" }]);
                          }}
                          style={{
                            background: "#3b82f6",
                            color: "#fff",
                            border: "none",
                            borderRadius: 6,
                            padding: "0.45rem 0.75rem",
                            cursor: "pointer",
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minHeight: "35px",
                          }}
                        >
                          + Add Debit/Credit Row
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Date, Attachments, Memo */}
                <div
                  style={{
                    display: "flex",
                    gap: "1rem",
                    alignItems: "center",
                    flexWrap: "wrap",
                    marginBottom: "0.75rem",
                    marginTop: "-0.5rem",
                  }}
                >
                  <label style={{ display: "flex", flexDirection: "column", fontWeight: 600 }}>
                    Date
                    <input
                      type="date"
                      value={jeDate}
                      min={minDateStr}
                      max={maxDateStr}
                      onChange={(e) => {
                        const val = e.target.value;
                        setJeDate(val);

                        // immediate UI feedback: clear date-related banner if in allowed range
                        if (!val) {
                          setAccountError("");
                          return;
                        }
                        try {
                          const chosenD = new Date(val + "T00:00:00");
                          const minD = new Date(minDateStr + "T00:00:00");
                          const maxD = new Date(maxDateStr + "T23:59:59");
                          if (chosenD >= minD && chosenD <= maxD) {
                            setAccountError("");
                          } else {
                            setAccountError(`Date must be between ${minDateStr} and ${maxDateStr}.`);
                          }
                        } catch (err) {
                        }
                      }}
                      style={{
                        padding: "0.4rem",
                        borderRadius: 6,
                        border: "1px solid #ccc",
                        marginTop: "0.5rem",
                        width: "180px",
                        minHeight: "17px",
                        marginBottom: "1.2rem",
                      }}
                    />
                  </label>


                  <div style={{ marginTop: "0.2rem", display: "flex", flexDirection: "column" }}>
                    <label style={{ fontWeight: 600 }}>Attachments (optional)</label>
                    <input
                      type="file"
                      onChange={(e) => handleFileInput(e.target.files)}
                      multiple
                      accept=".pdf,.doc,.docx,.xlsx,.xls,.csv,image/png,image/jpeg"
                      ref={fileInputRef}
                      style={{
                        marginTop: "0.5rem",
                        marginBottom: "-0.1rem",
                        height: "26px",
                        width: "278px",
                        padding: "0.25rem 0.9rem",
                        border: "1px solid #ccc",
                        borderRadius: 6,
                      }}
                    />
                    <div style={{ color: "#6b7280", fontSize: 12, marginTop: "0.1rem" }}>
                      {attachments.length} file(s) attached
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "315px" }}>
                    <label style={{ fontWeight: 600, marginBottom: "0.1rem" }}>Memo (optional)</label>
                    <input
                      type="text"
                      value={jeMemo}
                      onChange={(e) => setJeMemo(e.target.value)}
                      placeholder="Memo"
                      style={{
                        width: "100%",
                        maxWidth: "450px",
                        padding: "0.4rem",
                        borderRadius: 6,
                        border: "1px solid #ccc",
                        minHeight: "17px",
                        marginTop: "0.5rem",
                        marginBottom: "1.2rem",
                      }}
                    />
                  </div>
                </div>


                {/* Actions */}
                <div
                  style={{
                    gap: "0.75rem",         
                  }}
                >
                  <button
                    type="button"
                    onClick={resetForm}
                    style={{
                      background: "#ef4444",
                      color: "white",
                      border: "1px solid #cbd5e1",
                      padding: "0.6rem 1rem",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#dc2626")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#ef4444")}
                  >
                    Cancel/Reset
                  </button>

                  <button
                    type="submit"
                    disabled={saving || invalidAttachments.length > 0}
                    title={invalidAttachments.length > 0 ? "Remove unsupported attachment(s) before submitting" : undefined}
                    style={{
                      background: "#10b981", 
                      color: "#fff", 
                      border: "none",
                      padding: "0.6rem 1.1rem",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    {saving ? "Submitting..." : "Submit"}
                  </button>
                </div>
              </form>

              {/* JE List */}
              <h3 style={{ color: "#111827", marginTop: "4rem" }}>Journal Entry List</h3>

              {/* List controls */}
              <div
                style={{
                  display: "flex",
                  gap: "1rem",
                  alignItems: "flex-end",
                  marginBottom: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                {/* Status Filter */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label style={{ marginBottom: "0.5rem", marginTop: "-3.3rem" }}>Status:</label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{
                      padding: "0.4rem 0.5rem",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                      minWidth: "120px",
                      minHeight: "30px",
                      marginTop: "-0.2rem",
                    }}
                  >
                    <option>All</option>
                    <option>Pending</option>
                    <option>Approved</option>
                    <option>Rejected</option>
                  </select>
                </div>

                {/* From Date */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label style={{ marginBottom: "0.25rem" }}>From:</label>
                  <input
                    type="date"
                    value={jeDateRange.from}
                    onChange={(e) =>
                      setJeDateRange((p) => ({ ...p, from: e.target.value }))
                    }
                    style={{
                      padding: "0.4rem 0.5rem",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                    }}
                  />
                </div>

                {/* To Date */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label style={{ marginBottom: "0.25rem" }}>To:</label>
                  <input
                    type="date"
                    value={jeDateRange.to}
                    onChange={(e) => setJeDateRange((p) => ({ ...p, to: e.target.value }))}
                    style={{
                      padding: "0.4rem 0.5rem",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                    }}
                  />
                </div>

                {/* Search Bar */}
                <div style={{ display: "flex", flexDirection: "column", marginLeft: "auto" }}>
                  <label style={{ marginBottom: "0.25rem", visibility: "hidden" }}>Search</label>
                  <input
                    type="text"
                    placeholder="Search account name, amount, or date..."
                    value={jeSearch}
                    onChange={(e) => setJeSearch(e.target.value)}
                    style={{
                      padding: "0.45rem 0.6rem",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                      minWidth: "320px",
                      height: "20px",
                    }}
                  />
                </div>
              </div>

              {/* JE table */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb" }}>
                  <th style={{ padding: 8, textAlign: "left" }}>Date</th>
                  <th style={{ padding: 8, textAlign: "left" }}>Accounts</th>
                  <th style={{ padding: 8, textAlign: "left" }}>Debit</th>
                  <th style={{ padding: 8, textAlign: "left" }}>Credit</th>
                  <th style={{ padding: 8, textAlign: "left" }}>Attachments</th>   
                  <th style={{ padding: 8, textAlign: "left" }}>Memo</th>         
                  <th style={{ padding: 8, textAlign: "left" }}>Status</th>
                  <th style={{ padding: 8, textAlign: "left" }}>Submitted By</th>
                </tr>
              </thead>
                <tbody>
                  {filteredJournalEntries.map((entry) => {
                    // Support both multi-line (debits/credits arrays) and legacy single-line fields
                    const debs =
                      (entry.debits &&
                        Array.isArray(entry.debits) &&
                        entry.debits.map((d) => ({
                          accountId: d.accountId || d.account || "",
                          accountName: d.accountName || d.account || "",
                          amount: d.amount || 0,
                        }))) ||
                      (entry.debitAccountId
                        ? [
                            {
                              accountId: entry.debitAccountId,
                              accountName: entry.debitAccountName || "",
                              amount: entry.amount || entry.totalAmount || 0,
                            },
                          ]
                        : []);

                    const creds =
                      (entry.credits &&
                        Array.isArray(entry.credits) &&
                        entry.credits.map((c) => ({
                          accountId: c.accountId || c.account || "",
                          accountName: c.accountName || c.account || "",
                          amount: c.amount || 0,
                        }))) ||
                      (entry.creditAccountId
                        ? [
                            {
                              accountId: entry.creditAccountId,
                              accountName: entry.creditAccountName || "",
                              amount: entry.amount || entry.totalAmount || 0,
                            },
                          ]
                        : []);

                    // total rows = debits followed by credits (at least 1 row so table doesn't break)
                    const totalRows = Math.max(debs.length + creds.length, 1);

                    // Look for a rejection note under a few common keys
                    const rejectionText =
                      entry.rejectionReason ||
                      entry.rejectReason ||
                      entry.reason ||
                      entry.rejectionNote ||
                      entry.managerNote ||
                      entry.managerComment ||
                      "";

                    return (
                      <React.Fragment key={entry.id}>
                        {Array.from({ length: totalRows }).map((_, rowIndex) => {
                          const isDebitRow = rowIndex < debs.length;
                          const debitIndex = rowIndex;
                          const creditIndex = rowIndex - debs.length; // used when rowIndex >= debs.length

                          // For first row render the Date + shared columns with rowSpan = totalRows
                          const showShared = rowIndex === 0;

                          // Styling: top border on first credit row to act as divider
                          const rowStyle = {
                            borderBottom: rowIndex === totalRows - 1 ? "2px solid #e5e7eb" : "1px solid #e5e7eb",
                            ...(rowIndex === debs.length && debs.length > 0 ? { borderTop: "2px solid #e5e7eb" } : {}),
                            backgroundColor: rowIndex % 2 === 0 ? "#fff" : "#fff",
                          };

                          return (
                            <tr
                              id={rowIndex === 0 ? `journal-entry-${entry.id}` : undefined}
                              key={`${entry.id}-r-${rowIndex}`}
                              ref={
                                rowIndex === 0
                                  ? (el) => {
                                      if (el) journalRowRefs.current[entry.id] = el;
                                      else delete journalRowRefs.current[entry.id];
                                    }
                                  : undefined
                              }
                              style={{ ...rowStyle, ...(String(entry.id) === String(highlightJournalEntryId) ? { backgroundColor: "#fff7c2" } : {}) }}
                            >

                              {showShared && (
                                <td
                                  rowSpan={totalRows}
                                  style={{
                                    padding: "0.75rem",
                                    verticalAlign: "top",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {entry.date
                                    ? `${entry.date.split("-")[1]}/${entry.date.split("-")[2]}/${entry.date.split("-")[0]}`
                                    : "—"}

                                </td>
                              )}

                              {/* Accounts cell */}
                              <td style={{ padding: "0.75rem", verticalAlign: "top" }}>
                                {isDebitRow ? (
                                  <Link
                                  to={`/ledger/${debs[debitIndex].accountId || ""}`}
                                  state={{
                                    from: "AccountantHome",
                                    user: accountantUser.username,
                                    role: accountantUser.role,
                                    origin: "Journal Entries"
                                  }}
                                  style={{ color: "#2563eb", textDecoration: "none" }}
                                >
                                  {debs[debitIndex].accountName || "—"}
                                </Link>                               
                                ) : rowIndex >= debs.length ? (
                                  <Link
                                    to={`/ledger/${(creds[creditIndex] && creds[creditIndex].accountId) || ""}`}
                                    state={{
                                      from: "AccountantHome",
                                      user: accountantUser.username,
                                      role: accountantUser.role,
                                      origin: "Journal Entries"
                                    }}
                                    style={{ color: "#2563eb", textDecoration: "none" }}
                                  >
                                    {(creds[creditIndex] && creds[creditIndex].accountName) || "—"}
                                  </Link>
                                ) : (
                                  "—"
                                )}
                              </td>

                              {/* Debit amount or dash */}
                              <td style={{ padding: "0.75rem", verticalAlign: "top" }}>
                                {isDebitRow ? (
                                  Number(debs[debitIndex].amount || 0).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })
                                ) : (
                                  "—"
                                )}
                              </td>

                              {/* Credit amount or dash */}
                              <td style={{ padding: "0.75rem", verticalAlign: "top" }}>
                                {rowIndex >= debs.length ? (
                                  Number((creds[creditIndex] && creds[creditIndex].amount) || 0).toLocaleString(undefined, {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })
                                ) : (
                                  "—"
                                )}
                              </td>

                              {/* Shared columns (attachments, memo, status (with rejection), submittedBy) */}
                              {showShared && (
                                <>
                                  {/* ATTACHMENTS - moved to be between Credit and Memo */}
                                  <td rowSpan={totalRows} style={{ padding: "0.75rem", verticalAlign: "top" }}>
                                    {(entry.attachments || []).length > 0 ? (
                                      <div>
                                        {entry.attachments.map((a, i) => (
                                          <div key={i}>
                                            <a
                                              href={a.dataUrl || a.url || "#"}
                                              onClick={(e) => {
                                                e.preventDefault();
                                                openAttachment(a);
                                              }}
                                              style={{ color: "#2563eb", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                              title={a.name || "attachment"}
                                              rel="noreferrer"
                                            >
                                              {a.name || `attachment-${i + 1}`}
                                            </a>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      "—"
                                    )}
                                  </td>

                                  {/* MEMO */}
                                  <td rowSpan={totalRows} style={{ padding: "0.75rem", verticalAlign: "top", maxWidth: 240 }}>
                                    {entry.memo || "—"}
                                  </td>

                                  {/* STATUS with embedded Rejection reason */}
                                  <td
                                    rowSpan={totalRows}
                                    style={{
                                      padding: "0.75rem",
                                      verticalAlign: "top",
                                      color:
                                        entry.status === "Approved"
                                          ? "green"
                                          : entry.status === "Rejected"
                                          ? "red"
                                          : "#374151",
                                    }}
                                  >
                                    <div style={{ fontWeight: 600 }}>{entry.status || "Pending"}</div>
                                    {entry.status === "Rejected" && (
                                      <div style={{ marginTop: 6 }}>
                                        <div style={{ }}>Reason:
                                          {" " + rejectionText || "—"}
                                        </div>
                                      </div>
                                    )}
                                  </td>

                                  <td rowSpan={totalRows} style={{ padding: "0.75rem", verticalAlign: "top" }}>
                                    {entry.submittedBy || "—"}
                                  </td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}


          {/* EVENT LOGS.............................................................................................................................. */} 
          {activeTab === "Event Logs" && (
            <div style={{ width: "95vw", margin: "0 auto", maxWidth: 1400, marginTop: "0.75rem", maxWidth: 1330 }}>
              <main style={{ flex: 1, padding: "1rem", backgroundColor: "#ffffff" }}>
                <h2 style={{ color: "#111827", fontSize: "1.25rem", fontWeight: 700 }}>My Event Logs</h2>

                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
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
                    {accountantEventLogs && accountantEventLogs.length > 0 ? (
                      accountantEventLogs.map((log) => (
                        <tr key={log.id}>
                          <td style={{ padding: "0.75rem" }}>{log.id}</td>
                          <td style={{ padding: "0.75rem" }}>{log.accountId || "—"}</td>
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
                              log.timestamp?.seconds ? log.timestamp.seconds * 1000 : log.timestamp || 0
                            ).toLocaleString() || "—"}
                          </td>
                          <td style={{ padding: "0.75rem", color: "#6b7280", whiteSpace: "pre-wrap", maxWidth: "300px" }}>
                            {log.oldData ? JSON.stringify(log.oldData, null, 2) : "—"}
                          </td>
                          <td style={{ padding: "0.75rem", color: "#6b7280", whiteSpace: "pre-wrap", maxWidth: "300px" }}>
                            {log.newData ? JSON.stringify(log.newData, null, 2) : "—"}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} style={{ padding: "1.5rem", color: "#6b7280", textAlign: "center" }}>
                          No event logs yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </main>
            </div>
          )}

          
          {/* MESSAGES................................................................................................................................. */} 
          {activeTab === "Messages" && (
            <div style={{ width: "95vw", margin: "0 auto", maxWidth: 1330 }}>
              <h2 style={{ color: "#111827" }}>Messages</h2>

              <div style={{ marginBottom: "1rem", display: "flex", gap: "1rem" }}>
                <button
                  onClick={() => setActiveSubTab("Inbox")}
                  title="View messages received by you"
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
                  title="View messages you have sent"
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
                  title="Compose and send a new message"
                  style={{
                    background: "#22c55e",
                    color: "white",
                    padding: "0.5rem 1rem",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    marginLeft: "auto",
                  }}
                >
                  New Message
                </button>
              </div>

              {activeSubTab === "Inbox" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f9fafb" }}>
                      <th style={{ color: "#111827", padding: "0.75rem" }}>From</th>
                      <th style={{ color: "#111827", padding: "0.75rem" }}>Subject</th>
                      <th style={{ color: "#111827", padding: "0.75rem" }}>Message</th>
                      <th style={{ color: "#111827", padding: "0.75rem" }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages
                      .filter((msg) => msg.to === accountantUser.username)
                      .map((msg) => (
                        <tr key={msg.id}>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>{msg.from}</td>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>{msg.subject}</td>
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
                              <div style={{ marginBottom: "1rem", color: "#111827" }}>
                                {msg.message || msg.body || ""}
                              </div>


                              {/* Only system JE alerts show button */}
                              {msg.type === "system-alert" && (
                                <a
                                  href="/manager-home?tab=Journal%20Entries"
                                  style={{
                                    display: "inline-block",
                                    background: "#2563eb",
                                    color: "white",
                                    padding: "0.5rem 1rem",
                                    borderRadius: "6px",
                                    textDecoration: "none",
                                    fontWeight: 500,
                                  }}
                                >
                                  Open Journal Entries
                                </a>
                              )}
                            </div>
                          </td>


                          <td style={{ padding: "0.75rem", color: "#111827" }}>
                            {msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}

              {activeSubTab === "Sent" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f9fafb" }}>
                      <th style={{ color: "#111827", padding: "0.75rem" }}>To</th>
                      <th style={{ color: "#111827", padding: "0.75rem" }}>Subject</th>
                      <th style={{ color: "#111827", padding: "0.75rem" }}>Message</th>
                      <th style={{ color: "#111827", padding: "0.75rem" }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages
                      .filter((msg) => msg.from === accountantUser.username)
                      .map((msg) => (
                        <tr key={msg.id}>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>{msg.to}</td>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>{msg.subject}</td>
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
                              <div style={{ marginBottom: "1rem", color: "#111827" }}>
                                {msg.message || msg.body || ""}
                              </div>


                              {/* Show button ONLY if system alert */}
                              {msg.type === "system-alert" && (
                                <a
                                  href="/manager-home?tab=Journal%20Entries"
                                  style={{
                                    display: "inline-block",
                                    background: "#2563eb",
                                    color: "white",
                                    padding: "0.5rem 1rem",
                                    borderRadius: "6px",
                                    textDecoration: "none",
                                    fontWeight: 500,
                                  }}
                                >
                                  Open Journal Entries
                                </a>
                              )}
                            </div>
                          </td>

                          <td style={{ padding: "0.75rem", color: "#111827" }}>
                            {msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}

              {/* Compose modal */}
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
                    zIndex: 1000,
                  }}
                >
                  <div style={{ background: "white", padding: "2rem", borderRadius: "8px", width: "520px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
                    <h3 style={{ color: "#111827", textAlign: "center" }}>New Message</h3>

                    <label style={{ fontWeight: 600, color: "#111827" }}>To</label>
                    <select
                      value={compose.to}
                      onChange={(e) => setCompose({ ...compose, to: e.target.value })}
                      title="Select recipient"
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem", border: "1px solid #ccc", borderRadius: "6px" }}
                    >
                      <option value="">-- Select User --</option>
                      {users
                        .filter((u) => u.active && u.username !== accountantUser.username)
                        .map((u) => (
                          <option key={u.id} value={u.username}>
                            {u.username}
                          </option>
                        ))}
                    </select>

                    <label style={{ fontWeight: 600, color: "#111827" }}>Subject</label>
                    <input
                      type="text"
                      value={compose.subject}
                      onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem", border: "1px solid #ccc", borderRadius: "6px" }}
                    />

                    <label style={{ fontWeight: 600, color: "#111827" }}>Message</label>
                    <textarea
                      value={compose.body}
                      onChange={(e) => setCompose({ ...compose, body: e.target.value })}
                      style={{ width: "100%", margin: "0.5rem 0", padding: "0.5rem", border: "1px solid #ccc", borderRadius: "6px", minHeight: "120px" }}
                    />

                    {errorMessage && <p style={{ color: "red", marginTop: "0.5rem" }}>{errorMessage}</p>}

                    <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
                      <button
                        onClick={async () => {
                          if (!compose.to || !compose.subject || !compose.body) {
                            setErrorMessage("All fields are required.");
                            return;
                          }
                          const recipient = users.find((u) => u.username === compose.to && u.active);
                          if (!recipient) {
                            setErrorMessage("Recipient must be an active user.");
                            return;
                          }
                          try {
                            await addDoc(collection(db, "messages"), {
                              from: accountantUser.username,
                              to: compose.to,
                              subject: compose.subject,
                              body: compose.body,
                              timestamp: Date.now(), // or serverTimestamp()
                            });                            
                            setCompose({ to: "", subject: "", body: "" });
                            setShowCompose(false);
                            setErrorMessage("");
                          } catch (err) {
                            console.error("Error sending message:", err);
                            setErrorMessage("Error sending message.");
                          }
                        }}
                        title="Send message"
                        style={{ background: "#22c55e", color: "white", padding: "0.5rem 1rem", border: "none", borderRadius: "6px", cursor: "pointer", flex: 1 }}
                      >
                        Send
                      </button>

                      <button
                        onClick={() => {
                          setShowCompose(false);
                          setCompose({ to: "", subject: "", body: "" });
                          setErrorMessage("");
                        }}
                        title="Close without sending"
                        style={{ background: "#ef4444", color: "white", padding: "0.5rem 1rem", border: "none", borderRadius: "6px", cursor: "pointer", flex: 1 }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

export default AccountantHome;