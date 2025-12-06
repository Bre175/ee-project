/* src/pages/ManagerHome.jsx
*
* Main dashboard page for users with the "Manager" role. Provides functionality for:
*   - Viewing financial ratios and dashboard metrics
*   - Managing Chart of Accounts (view-only)
*   - Creating, reviewing, approving/rejecting journal entries
*   - Generating financial reports (trial balance, income statement, balance sheet, retained earnings)
*   - Sending/receiving in-app messages
*   - Viewing event logs
*/


// IMPORTS...............................................................................................................................................................................................

// React core hooks
import React, { useState, useEffect, useRef } from "react";

// Custom components
import Header from "../components/Header";

// Firebase Firestore database instance
import { db } from "../firebase";

// Firestore functions for CRUD operations and real-time subscriptions
import {
  collection,         // Reference to a Firestore collection
  onSnapshot,         // Real-time listener for data changes
  updateDoc,          // Update existing document
  doc,                // Reference to a specific document
  getDoc,             // Fetch single document
  addDoc,             // Create new document with auto-generated ID
  getDocs,            // Fetch all documents in a collection
  deleteDoc,          // Delete a document
  serverTimestamp,    // Server-side timestamp for consistency
  query,              // Build queries with filters/ordering
  orderBy,            // Sort query results
} from "firebase/firestore";

// Default profile picture asset
import profilePic from "../assets/ProfilePic.jpg";

// React Router hooks for navigation and URL state
import { Link, useLocation, useNavigate } from "react-router-dom";

// Firebase Storage for file uploads (used for report attachments)
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

// PDF generation libraries (for downloading reports as PDF)
import html2canvas from "html2canvas";
import jsPDF from "jspdf";


// HELPER FUNCTIONS (Outside Component)...................................................................................................................................................................

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


// MAIN COMPONENT: ManagerHome...........................................................................................................................................................................
function ManagerHome() {

  // STATE VARIABLES - User & Navigation...................................................................

  // Current logged-in manager's information; loaded from Firestore on component mount based on localStorage
  const [managerUser, setManagerUser] = useState({
    username: "Manager",
    profilePic: profilePic,
    role: "Manager",
  });

  // Currently active navigation tab; persisted to localStorage so it survives page refreshes
  const [activeTab, setActiveTab] = useState(() => {
    const savedTab = localStorage.getItem("managerActiveTab");
    return savedTab || "Dashboard";
  });  
  
  // React Router hooks
  const location = useLocation();
  const navigate = useNavigate();


  // NAVIGATION & TAB PERSISTENCE - useEffect Hooks..........................................................

  // Handle navigation-triggered tab changes (does NOT reset back to dashboard)
  useEffect(() => {
    if (location.state?.tab) {
      setActiveTab(location.state.tab);
    }
  }, [location.state]);

  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("managerActiveTab", activeTab);
  }, [activeTab]);

  // Handle journal entry highlighting from URL query params
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const highlightId = params.get("highlightJE");
    if (!highlightId) return;

    // Switch to Journal Entries tab
    setActiveTab("Journal Entries");

    // Save highlight ID so your JE list can use it
    try {
      sessionStorage.setItem("highlightJournalEntryId", highlightId);
    } catch (err) {
      console.warn("Unable to persist highlightJournalEntryId", err);
    }

    // Remove the query from the URL
    window.history.replaceState({}, document.title, "/manager-home");
  }, [location]);


  /*
   * Primary tab resolution effect
   * Determines which tab to show based on:
   *   1. URL query param (?tab=...)
   *   2. Navigation state (location.state.tab)
   *   3. localStorage saved tab
   *   4. Default to "Dashboard"
   */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlTab = params.get("tab");

    if (urlTab) {
      setActiveTab(urlTab);
      return;
    }

    if (location.state?.tab) {
      setActiveTab(location.state.tab);
      return;
    }

    // Only default to Dashboard if nothing is saved in localStorage
    const savedTab = localStorage.getItem("managerActiveTab");
    if (!savedTab) {
      setActiveTab("Dashboard");
    }
  }, [location]);


  // USER DATA LOADING......................................................................................

  // Load logged-in manager's details from Firestore; uses the username stored in localStorage (set during login) to fetch full user data
  useEffect(() => {
    const fetchManagerUser = async () => {
      const storedUsername = localStorage.getItem("loggedInUser");
      if (!storedUsername) return;
      try {
        const userRef = doc(db, "users", storedUsername);
        const snap = await getDoc(userRef);
        if (snap.exists()) {
          const data = snap.data();
          setManagerUser({
            username: data.username || "Manager",
            profilePic,
            role: data.role || "Manager",
          });
        }
      } catch (err) {
        console.error("Error loading user:", err);
      }
    };
    fetchManagerUser();
  }, []);


  // USERS STATE - Real-time subscription to all users (read-only for manager)..............................

  /*
   * List of all users in the system
   * Used for:
   *   - Displaying user list in Manage Users tab (read-only)
   *   - Populating recipient dropdown in message compose
   *   - Validating message recipients
   */
  const [users, setUsers] = useState([]);

  // Real-time subscription to users collection; automatically updates when users are added/modified/deleted
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snapshot) => {
      const usersData = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUsers(usersData);
    });
    return () => unsub();
  }, []);


  // MESSAGES STATE - In-app messaging systemconst [messages, setMessages] = useState([]);..................

  // All messages in the system (filtered by UI based on sender/recipient) */
  const [messages, setMessages] = useState([]);

  // Current sub-tab in Messages section: "Inbox" or "Sent" 
  const [activeSubTab, setActiveSubTab] = useState("Inbox");

  // Controls visibility of the compose message modal 
  const [showCompose, setShowCompose] = useState(false);

  // Form state for composing a new message
  const [compose, setCompose] = useState({ to: "", subject: "", body: "" });

  // Error message to display in compose modal (e.g., "Recipient required")
  const [errorMessage, setErrorMessage] = useState("");

  /**
   * Real-time subscription to messages collection
   * Loads all messages; filtering by recipient/sender happens in the render
   */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "messages"), (snapshot) => {
      const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMessages(data);
    });
    return () => unsub();
  }, []);


  // CHART OF ACCOUNTS STATE - Account data for financial operations.........................................

  const [accounts, setAccounts] = useState([]);

  // Derived Financial Values 
  const currentAssets = sumBy(accounts, acc =>
    acc.accountSubcategory === "Current Assets"
  );

  const currentLiabilities = sumBy(accounts, acc =>
    acc.accountSubcategory === "Current Liabilities"
  );

  // Quick assets
  const cash = sumBy(accounts, acc => acc.accountName === "Cash");
  const shortTermInvestments = sumBy(accounts, acc => acc.accountNumber === "170");
  const accountsReceivable = sumBy(accounts, acc => acc.accountName === "Accounts Receivable");

  // Revenue & expenses
  const revenue = sumBy(accounts, acc =>
    acc.statementType === "IS" && acc.normalSide === "Credit"
  );

  const expenses = sumBy(accounts, acc =>
    acc.statementType === "IS" && acc.normalSide === "Debit"
  );

  const netIncome = revenue - expenses;

  // Assets / liabilities totals
  const totalAssets = sumBy(accounts, acc =>
    acc.statementType === "BS" && acc.normalSide === "Debit"
  );

  const totalLiabilities = sumBy(accounts, acc =>
    acc.statementType === "BS" && acc.accountCategory === "Liability"
  );

  // Interest & tax
  const interestExpense = sumBy(accounts, acc => acc.accountNumber === "505");
  const taxExpense = sumBy(accounts, acc => acc.accountNumber === "506");


  // FINANCIAL RATIO CALCULATIONS - Used on Dashboard........................................................

  /*
   * Current Ratio = Current Assets / Current Liabilities
   * Measures ability to pay short-term obligations
   * Healthy: >= 2.0, Warning: >= 1.0, Concerning: < 1.0
   */
  const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : 0;

  /*
   * Quick Ratio = (Cash + Short-term Investments + Accounts Receivable) / Current Liabilities
   * More stringent liquidity measure (excludes inventory)
   * Healthy: >= 1.0, Warning: >= 0.8, Concerning: < 0.8
   */
  const quickRatio = currentLiabilities > 0
    ? (cash + shortTermInvestments + accountsReceivable) / currentLiabilities
    : 0;

  /*
   * Profit Margin = (Net Income / Revenue) * 100
   * Shows what percentage of revenue becomes profit
   * Healthy: >= 20%, Warning: >= 10%, Concerning: < 10%
   */
  const profitMargin = revenue > 0 ? (netIncome / revenue) * 100 : 0;

  /*
   * Asset Turnover = Revenue / Total Assets
   * Measures how efficiently assets generate revenue
   * Higher is better
   */
  const assetTurnover = totalAssets > 0 ? revenue / totalAssets : 0;

  /*
   * Debt to Assets = Total Liabilities / Total Assets
   * Shows proportion of assets financed by debt
   * Lower is better (less financial risk)
   */
  const debtToAssets = totalAssets > 0 ? totalLiabilities / totalAssets : 0;

  /*
   * Times Interest Earned (TIE) = (Net Income + Interest Expense + Tax Expense) / Interest Expense
   * Measures ability to meet interest payments
   * Higher is better (more cushion for interest obligations)
   */
  const timesInterestEarned = interestExpense > 0
    ? (netIncome + interestExpense + taxExpense) / interestExpense
    : 0;

  
  // CHART OF ACCOUNTS - Search and Filter State............................................................

  // Text search term for filtering accounts by name/number 
  const [searchTerm, setSearchTerm] = useState("");

  // Controls visibility of the advanced filter panel 
  const [filterOpen, setFilterOpen] = useState(false);

  // Advanced filter criteria for Chart of Accounts
  const [filters, setFilters] = useState({
    name: "",
    number: "",
    category: "",
    subcategory: "",
    minAmount: "",
    maxAmount: "",
  });

  // Date range filter for Chart of Accounts 
  const [coaDateRange, setCoaDateRange] = useState({ from: "", to: "" });

  // Controls visibility of date range filter panel
  const [coaDateOpen, setCoaDateOpen] = useState(false);

  /*
   * Real-time subscription to accounts collection
   * Automatically updates when accounts are added/modified/deleted
   */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "accounts"), (snapshot) => {
      setAccounts(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // Highlight / scroll to a specific journal entry when coming from LedgerPage
  useEffect(() => {
    if (location.state?.highlightJournalEntryId) {
      const idToHighlight = location.state.highlightJournalEntryId;

      setActiveTab("Journal Entries"); // Auto-switch tab

      // Give it a moment for table render
      setTimeout(() => {
        const el = document.getElementById(`journal-entry-${idToHighlight}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.style.backgroundColor = "#fef08a"; // highlight yellow
          setTimeout(() => (el.style.backgroundColor = ""), 2000);
        }
      }, 600);
    }
  }, [location.state]);


  // JOURNAL ENTRIES STATE.................................................................................

  // All journal entries from Firestore 
  const [journalEntries, setJournalEntries] = useState([]);

  // Filter dropdown value: "All", "Pending", "Approved", "Rejected", etc. 
  const [jeFilterStatus, setJeFilterStatus] = useState("All");

  // Date range filter for journal entries list 
  const [jeDateRange, setJeDateRange] = useState({ from: "", to: "" });

  // Text search for journal entries (searches memo, accounts, etc.) 
  const [jeSearch, setJeSearch] = useState("");

  // Reason text when rejecting a journal entry 
  const [rejectReason, setRejectReason] = useState("");

  // ID of the journal entry currently being rejected (shows rejection modal) 
  const [rejectingEntry, setRejectingEntry] = useState(null);

  // Loading state while saving a journal entry 
  const [jeSaving, setJeSaving] = useState(false);

  // Error message for journal entry operations 
  const [jeError, setJeError] = useState("");

  // Real-time subscription to journal entries
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "journalEntries"), (snapshot) => {
      setJournalEntries(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);


  // DASHBOARD ALERT CALCULATIONS...........................................................................

  // Count of journal entries awaiting manager approval 
  const pendingApprovals = journalEntries.filter(j => j.status === "Pending").length;

  // Count of draft journal entries (not yet submitted) 
  const draftEntries = journalEntries.filter(j => j.status === "Not Submitted").length;


  // REPORTS STATE - Financial report generation............................................................

  // Ledger entries used for generating reports 
  const [ledgerEntries, setLedgerEntries] = useState([]);

  /*
   * Real-time subscription to ledger entries
   * Used by report generation functions to calculate account balances
   */
  useEffect(() => {
    try {
      const unsub = onSnapshot(collection(db, "ledgerEntries"), (snap) => {
        setLedgerEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      });
      return () => unsub();
    } catch (err) {
      console.error("Failed to subscribe to ledgerEntries:", err);
    }
  }, []);

  // reports UI state

  /** Currently selected report type dropdown value */
  const [reportType, setReportType] = useState("Trial Balance"); // Options: "Trial Balance" | "Income Statement" | "Balance Sheet" | "Retained Earnings"

  /** Date range for report generation (YYYY-MM-DD format) */
  const [reportRange, setReportRange] = useState({ from: "", to: "" });

  /** Loading state while generating a report */
  const [reportLoading, setReportLoading] = useState(false);

  /** The generated report data (structure varies by report type) */
  const [generatedReport, setGeneratedReport] = useState(null);

  // Send report modal state 

  /** Controls visibility of the "Send Report" modal */
  const [sendModalOpen, setSendModalOpen] = useState(false);

  /** Loading state while sending a report message */
  const [sendModalSending, setSendModalSending] = useState(false);

  /** Recipient username for sending report */
  const [sendToUser, setSendToUser] = useState("");

  /** Email subject line for report message */
  const [sendSubject, setSendSubject] = useState("");

  /** Email body content for report message */
  const [sendBody, setSendBody] = useState("");

  /** Whether to attach CSV file to report message */
  const [attachCSV, setAttachCSV] = useState(false);

  /** Whether to attach JSON file to report message */
  const [attachJSON, setAttachJSON] = useState(false);

  /** Whether to attach PDF file to report message */
  const [attachPDF, setAttachPDF] = useState(true);

  /** ID of report being deleted (shows confirmation UI) */
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);


  // SAVED REPORTS STATE - Previously generated and saved reports...........................................

  /** List of saved reports from Firestore */
  const [savedReports, setSavedReports] = useState([]);

  /*
   * Real-time subscription to saved reports
   * Sorted by creation date (newest first)
   */
  useEffect(() => {
    try {
      const q = query(collection(db, "reports"), orderBy("createdAt", "desc"));
      const unsub = onSnapshot(
        q,
        (snap) => {
          const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setSavedReports(docs);
        },
        (err) => console.error("Saved reports subscription error:", err)
      );
      return () => unsub();
    } catch (err) {
      console.error("Failed to subscribe to reports:", err);
    }
  }, []);


  // AUTOMATIC BALANCE RECALCULATION........................................................................

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


  // ERROR LOGGING HELPER..................................................................................
  const writeErrorLog = async ({
      errorCode,
      message,
      context = "JournalEntry",
      contextId = null,
      user = managerUser.username || "unknown",
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


  // MANAGER EVENT LOGGING - Audit trail for manager actions................................................
  const [managerEventLogs, setManagerEventLogs] = useState([]);

  // Centralized writer used by manager actions (creates docs in managerAccountEventLogs)
  const logManagerAccountEvent = async ({
    accountId = null,
    action,
    userId = managerUser?.username || "Manager",
    oldData = null,
    newData = null,
  }) => {
    try {
      await addDoc(collection(db, "managerAccountEventLogs"), {
        accountId: accountId || null,
        action,
        userId: userId || managerUser?.username || "Manager",
        oldData: oldData || null,
        newData: newData || null,
        timestamp: serverTimestamp(),
      });
    } catch (err) {
      console.error("Failed to write manager event log:", err);
      // don't rethrow — logging failure must not break UI flows
    }
  };

  // Real-time subscription (most recent first)
  useEffect(() => {
    try {
      const q = query(collection(db, "managerAccountEventLogs"), orderBy("timestamp", "desc"));
      const unsub = onSnapshot(
        q,
        (snapshot) => {
          const logs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setManagerEventLogs(logs);
        },
        (err) => {
          console.error("Manager event logs subscription error:", err);
        }
      );
      return () => unsub();
    } catch (err) {
      console.error("Failed to subscribe to managerAccountEventLogs:", err);
    }
  }, []);


  // ERROR MESSAGE HELPERS - Fetch canonical error messages from Firestore..................................
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


  // UI ERROR STATE - For displaying validation errors to the user..........................................
  const [accountError, setAccountError] = useState("");
  const [errorSuggestion, setErrorSuggestion] = useState("");
  const [displayErrorCode, setDisplayErrorCode] = useState(null);

  // helper to set validation error (fetches canonical message if available)
  const setValidationError = async (errorCode, fallbackMessage = "") => {
    try {
      const em = await getErrorMessageDoc(errorCode);
      if (em) {
        setAccountError(em.message || fallbackMessage || "Validation error.");
        setErrorSuggestion(em.suggestion || "");
        setDisplayErrorCode(em.code || errorCode);
      } else {
        setAccountError(fallbackMessage || "Validation error.");
        setErrorSuggestion("");
        setDisplayErrorCode(errorCode);
      }
    } catch (err) {
      setAccountError(fallbackMessage || "Validation error.");
      setErrorSuggestion("");
      setDisplayErrorCode(errorCode);
    }
  };


  // JOURNAL ENTRY FORM STATE - Multi-row debit/credit entry................................................
  const emptyDebit = { accountId: "", accountName: "", amount: "" };
  const emptyCredit = { accountId: "", accountName: "", amount: "" };
  const [debits, setDebits] = useState([{ ...emptyDebit }]);
  const [credits, setCredits] = useState([{ ...emptyCredit }]);
  const [jeDate, setJeDate] = useState("");
  const [jeMemo, setJeMemo] = useState("");
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const printAreaRef = useRef(null);
  const [invalidAttachments, setInvalidAttachments] = useState([]);
  const [draftId, setDraftId] = useState(null);


  // JOURNAL ENTRY FORM HELPERS.............................................................................
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

  const addDebitRow = () => {
    setDebits((d) => [...d, { ...emptyDebit }]);
    setCredits((c) => [...c, { ...emptyCredit }]);
  };
  const removeDebitRow = (i) => {
    setDebits((d) => d.filter((_, idx) => idx !== i));
    setCredits((c) => c.filter((_, idx) => idx !== i));
  };

  // single amount field per row: keep debit.amount and credit.amount in sync (so legacy code works)
  const handleAmountChange = (idx, value) => {
    // normalize value to string, allow empty
    const val = value === "" ? "" : value;
    setDebits((d) => d.map((r, i) => (i === idx ? { ...r, amount: val } : r)));
    setCredits((c) => c.map((r, i) => (i === idx ? { ...r, amount: val } : r)));

    // if user enters zero/negative we show red banner immediately (instead of native tooltip)
    const n = parseFloat(val);
    if (val !== "" && (!Number.isFinite(n) || n <= 0)) {
      // prefer JE_ZERO_AMOUNT for 0, JE_NEGATIVE_AMOUNT for < 0, JE_INVALID_AMOUNT for non-number
      (async () => {
        if (!Number.isFinite(n)) {
          await setValidationError("JE_INVALID_AMOUNT", "Please enter a valid amount for each populated row.");
        } else if (n < 0) {
          await setValidationError("JE_NEGATIVE_AMOUNT", "Amount cannot be negative. Use positive values only.");
        } else {
          await setValidationError("JE_ZERO_AMOUNT", "Amount cannot be zero. Enter a positive value.");
        }
      })();
    } else {
      // clear banner if fixed
      setAccountError("");
      setErrorSuggestion("");
      setDisplayErrorCode(null);
    }
  };


  // FILE ATTACHMENT HANDLING...............................................................................
  const supportedTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "image/jpeg",
    "image/png",
  ];

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  const handleFileInput = async (fileList) => {
    // reset invalid list each time user selects files
    setInvalidAttachments([]);
    const files = Array.from(fileList).slice(0, 6);
    const bad = [];

    for (const f of files) {
      // unsupported mime
      if (!supportedTypes.includes(f.type)) {
        bad.push({ name: f.name, type: f.type });
        // log + show canonical DB message (existing behavior)
        await writeErrorLog({
          errorCode: "JE_ATTACHMENT_INVALID_TYPE",
          message: `Unsupported file type: ${f.type}`,
          context: "JournalEntry",
          user: managerUser.username,
          payload: { filename: f.name, filetype: f.type },
        });
        await setValidationError("JE_ATTACHMENT_INVALID_TYPE", `Unsupported file type: ${f.name}`);
        // do not add to attachments array
        continue;
      }

      try {
        if (f.size && f.size > 15 * 1024 * 1024) {
          bad.push({ name: f.name, type: f.type, reason: "too_large" });
          await writeErrorLog({
            errorCode: "JE_ATTACHMENT_TOO_LARGE",
            message: `Attachment too large: ${f.name}`,
            context: "JournalEntry",
            user: managerUser.username,
            payload: { filename: f.name, size: f.size },
          });
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
            uploadedBy: managerUser.username,
          },
        ]);
      } catch (err) {
        console.error("File read error", err);
      }
    }

    // update invalidAttachments state once after processing selection
    if (bad.length) {
      setInvalidAttachments(bad);
    } else {
      setInvalidAttachments([]);
      if (displayErrorCode === "JE_ATTACHMENT_INVALID_TYPE" || displayErrorCode === "JE_ATTACHMENT_TOO_LARGE") {
        setAccountError("");
        setErrorSuggestion("");
        setDisplayErrorCode(null);
      }
    }
  };


  const removeAttachment = (index) => setAttachments((a) => a.filter((_, i) => i !== index));

  // robust openAttachment - handles data: URIs and remote URLs; falls back to download
  const openAttachment = async (att) => {
    try {
      if (!att) return;
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
          // revoke after short delay to avoid breaking the preview immediately
          setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
          return;
        }

        // popup blocked fallback -> trigger download using object URL
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = att.name || "attachment";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
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

  const resetJeForm = () => {
    setDebits([{ ...emptyDebit }]);
    setCredits([{ ...emptyCredit }]);
    setJeDate("");
    setJeMemo("");
    setAttachments([]);
    setInvalidAttachments([]); 
    setAccountError("");
    setErrorSuggestion("");
    setDisplayErrorCode(null);
    if (fileInputRef.current) fileInputRef.current.value = null;
  };


  // UTILITY FUNCTIONS - Numeric and Date Helpers............................................................

  // helper to compute min/max date strings (YYYY-MM-DD)
  const formatDateYMD = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };
  const today = new Date();
  const minDateObj = new Date(today);
  minDateObj.setMonth(minDateObj.getMonth() - 1);
  const maxDateObj = new Date(today);
  maxDateObj.setMonth(maxDateObj.getMonth() + 1);
  const minDateStr = formatDateYMD(minDateObj);
  const maxDateStr = formatDateYMD(maxDateObj);

  // safe numeric coercion (put near other helpers)
  const toNumber = (v) => {
    if (v === undefined || v === null) return 0;
    const s = String(v).replace(/,/g, "").trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };

  // replace existing formatCurrency with this one (uses toNumber)
  const formatCurrency = (val) => {
    const n = toNumber(val);
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };


  // REPORT GENERATION HELPERS.............................................................................
  const nameById = (id) => {
    const a = accounts.find((x) => x.id === id || x.accountNumber === id);
    return a ? a.accountName || a.accountNumber || id : id;
  };

  const parseEntryDate = (d) => {
    if (!d) return null;
    try {
      if (typeof d === "number") return new Date(d);
      if (typeof d === "string") {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + "T00:00:00");
        return new Date(d);
      }
      if (d.seconds) return new Date(d.seconds * 1000);
    } catch (err) {}
    return null;
  };

  const withinRange = (dateStr, from, to) => {
    if (!dateStr) return false;
    const d = parseEntryDate(dateStr);
    if (!d) return false;
    if (from) {
      const f = new Date(from + "T00:00:00");
      if (d < f) return false;
    }
    if (to) {
      const t = new Date(to + "T23:59:59");
      if (d > t) return false;
    }
    return true;
  };

  function formatLocalJE(dateStr) {
    try {
      const [y, m, d] = dateStr.split("-");
      return `${m}/${d}/${y}`; 
    } catch {
      return dateStr;
    }
  }


  // REPORT GENERATION FUNCTIONS............................................................................

  const generateTrialBalance = (from, to) => {
    // returns array of { accountId, accountName, debit, credit }
    try {
      // 1) Seed map with ALL accounts so accounts with zero activity still appear
      const map = {};
      (accounts || []).forEach((a) => {
        const id = a.id || (a.accountNumber ? String(a.accountNumber) : `acct-${Math.random()}`);
        const initial = toNumber(a.initialBalance ?? a.initial ?? a.balance ?? 0);
        map[id] = {
          accountId: id,
          accountName: a.accountName || a.accountNumber || id,
          debit: 0,
          credit: 0,
          accountNumber: a.accountNumber || "",
        };
      });

      // 2) Accumulate ledgerEntries that fall within the date range
      (ledgerEntries || []).forEach((le) => {
        if (!withinRange(le.date || le.timestamp || le.postedAt, from, to)) return;

        // find canonical account id: prefer accountId, then try to match by accountNumber
        let aid = le.accountId;
        if (!aid && le.accountNumber) {
          const match = (accounts || []).find((ac) => String(ac.accountNumber) === String(le.accountNumber));
          if (match) aid = match.id;
        }
        // if still no aid, fallback to stringified accountNumber or generated key
        if (!aid) aid = String(le.accountId || le.accountNumber || "unknown");

        // ensure map entry exists
        if (!map[aid]) {
          map[aid] = {
            accountId: aid,
            accountName: nameById(aid) || String(le.accountName || aid),
            debit: 0,
            credit: 0,
            accountNumber: le.accountNumber || "",
          };
        }

        // robust numeric parsing using your toNumber helper (handles strings / commas)
        const debitVal = toNumber(le.debit ?? (le.type === "Debit" ? le.amount : 0));
        const creditVal = toNumber(le.credit ?? (le.type === "Credit" ? le.amount : 0));

        map[aid].debit = (map[aid].debit || 0) + debitVal;
        map[aid].credit = (map[aid].credit || 0) + creditVal;
      });

      // 3) Convert to array and sort
      const rows = Object.values(map).map((m) => ({
        accountId: m.accountId,
        accountName: m.accountName,
        debit: Number(m.debit || 0),
        credit: Number(m.credit || 0),
      }));

      rows.sort((a, b) => (a.accountName || a.accountId).localeCompare(b.accountName || b.accountId));
      return rows;
    } catch (err) {
      console.error("generateTrialBalance error:", err);
      return [];
    }
  };


  const generateBalanceSheet = (asOfTo) => {
    try {
      // Build base map from accounts (seed with initial / current balance)
      const map = {};
      (accounts || []).forEach((a) => {
        const init = toNumber(a.initialBalance ?? a.initial ?? a.balance ?? 0);
        map[a.id] = {
          accountId: a.id,
          accountName: a.accountName || a.accountNumber || a.id,
          accountNumber: a.accountNumber || "",
          balance: init,
          _category: (a.accountCategory ?? a.category ?? "").toString(),
          _subcategory: (a.accountSubcategory ?? a.subcategory ?? "Other").toString(),
        };
      });

      // Accumulate ledger up to asOfTo (inclusive)
      (ledgerEntries || []).forEach((le) => {
        if (!withinRange(le.date ?? le.timestamp ?? le.postedAt, null, asOfTo)) return;

        let aid = le.accountId;
        if (!aid && le.accountNumber) {
          const acctMatch = (accounts || []).find((ac) => String(ac.accountNumber) === String(le.accountNumber));
          if (acctMatch) aid = acctMatch.id;
        }
        if (!aid) return;

        if (!map[aid]) {
          map[aid] = {
            accountId: aid,
            accountName: nameById(aid),
            accountNumber: le.accountNumber || "",
            balance: 0,
            _category: "",
            _subcategory: "Other",
          };
        }

        const debit = toNumber(le.debit ?? (le.type === "Debit" ? le.amount : 0));
        const credit = toNumber(le.credit ?? (le.type === "Credit" ? le.amount : 0));

        map[aid].balance = (map[aid].balance || 0) + (debit - credit);
      });

      // classify into BS buckets only (assets, liabilities, equity)
      const buckets = { assets: {}, liabilities: {}, equity: {} };

      Object.values(map).forEach((m) => {
        const acc = (accounts || []).find((x) => x.id === m.accountId) || {};
        const cand =
          [
            acc.accountCategory ?? acc.category ?? m._category ?? "",
            acc.statementType ?? acc.statement ?? "",
            acc.normalSide ?? "",
            (acc.accountName || "").toString(),
          ]
            .join(" ")
            .toLowerCase();

        let type = null;
        if (cand.includes("asset")) type = "assets";
        else if (cand.includes("liabil") || cand.includes("liability")) type = "liabilities";
        else if (cand.includes("equity") || cand.includes("owner") || cand.includes("capital")) type = "equity";

        if (!type && m.accountNumber) {
          const n = String(m.accountNumber);
          if (/^[01]/.test(n)) type = "assets";
          else if (/^[23]/.test(n)) type = "liabilities";
          else type = null;
        }

        // skip anything that is not clearly an asset/liability/equity (this removes revenue/expense)
        if (!type) return;

        const sub = (acc.accountSubcategory ?? acc.subcategory ?? m._subcategory ?? "Other").toString();
        buckets[type][sub] = buckets[type][sub] || [];
        buckets[type][sub].push({
          accountId: m.accountId,
          accountName: m.accountName,
          accountNumber: m.accountNumber,
          balance: toNumber(m.balance),
        });
      });

      // convert bucket objects into arrays expected by the renderer: { name, items }
      const bucketToGroups = (obj) =>
        Object.keys(obj)
          .map((sub) => ({
            name: sub,
            items: (obj[sub] || []).slice().sort((a, b) => (a.accountName || "").localeCompare(b.accountName || "")),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

      // compute totals
      const sumItems = (groups) =>
        (groups || []).reduce((gAcc, g) => gAcc + (g.items || []).reduce((s, it) => s + toNumber(it.balance), 0), 0);    

      const assetsGroups = bucketToGroups(buckets.assets);
      const liabilitiesGroups = bucketToGroups(buckets.liabilities);
      const equityGroups = bucketToGroups(buckets.equity);

      const assetsTotal = sumItems(assetsGroups);
      const liabilitiesTotal = sumItems(liabilitiesGroups);
      const equityTotal = sumItems(equityGroups);
      const liabilitiesAndEquityTotal = liabilitiesTotal + equityTotal;

      return {
        assetsGroups,
        liabilitiesGroups,
        equityGroups,
        // totals (numbers)
        assetsTotal,
        liabilitiesTotal,
        equityTotal,
        liabilitiesAndEquityTotal,
      };
    } catch (err) {
      console.error("generateBalanceSheet error:", err);
      return {
        assetsGroups: [],
        liabilitiesGroups: [],
        equityGroups: [],
        assetsTotal: 0,
        liabilitiesTotal: 0,
        equityTotal: 0,
        liabilitiesAndEquityTotal: 0,
      };
    }
  };

  // generateIncomeStatement 
  const generateIncomeStatement = (from, to) => {
    try {
      // Helper to parse numbers safely
      const parseNum = (v) => {
        if (v === undefined || v === null || v === "") return 0;
        if (typeof v === "string") {
          const cleaned = v.replace(/,/g, "");
          const n = Number(cleaned);
          return Number.isFinite(n) ? n : 0;
        }
        return Number(v) || 0;
      };

      // Helper to check if date is in range
      const toDate = (x) => {
        if (!x && x !== 0) return null;
        if (typeof x === "object" && x !== null && "seconds" in x) {
          return new Date(x.seconds * 1000);
        }
        try {
          const n = Number(x);
          if (!Number.isNaN(n) && String(x).length > 9) {
            return new Date(n);
          }
          return new Date(x);
        } catch (err) {
          return null;
        }
      };

      const fromDate = toDate(from);
      const toDateObj = toDate(to);

      const inRange = (val) => {
        if (!val) return true;
        let d = null;
        if (typeof val === "object" && val !== null && "seconds" in val) {
          d = new Date(val.seconds * 1000);
        } else {
          const num = Number(val);
          if (!Number.isNaN(num) && String(val).length > 9) {
            d = new Date(num);
          } else {
            d = new Date(val);
          }
        }
        if (!d || isNaN(d.getTime())) return true;
        if (fromDate && d < fromDate) return false;
        if (toDateObj && d > toDateObj) return false;
        return true;
      };

      // Build map of account balances from ledger entries
      const accountTotals = {};

      // Aggregate all ledger entries in date range
      (ledgerEntries || []).forEach((le) => {
        if (!inRange(le.date || le.timestamp)) return;

        const accountId = le.accountId || le.accountNumber;
        if (!accountId) return;

        const debit = parseNum(le.debit || 0);
        const credit = parseNum(le.credit || 0);

        if (!accountTotals[accountId]) {
          accountTotals[accountId] = { debit: 0, credit: 0 };
        }

        accountTotals[accountId].debit += debit;
        accountTotals[accountId].credit += credit;
      });

      const revenues = [];
      const expenses = [];

      // Process each account in COA
      (accounts || []).forEach((a) => {
        const acctId = a.id || a.accountNumber;
        if (!acctId) return;

        const stmtType = String(a.statementType || "").toUpperCase();
        const cat = String(a.accountCategory || "").toLowerCase();
        const normalSide = String(a.normalSide || "").toLowerCase();
        const acctName = a.accountName || `Account ${acctId}`;

        // Only process Income Statement accounts
        const isIS = stmtType === "IS" || 
                    cat.includes("revenue") || 
                    cat.includes("expense") || 
                    cat.includes("income");

        if (!isIS) return;

        // Get totals for this account
        const totals = accountTotals[acctId] || { debit: 0, credit: 0 };
        
        // Determine if revenue or expense
        // Check category first (most reliable), then normalSide, then account name patterns
        
        const isExpense = cat.includes("expense") || 
                          normalSide === "debit" ||
                          /expense/i.test(acctName);  // Check for "expense" in name first

        const isRevenue = !isExpense && (
                          cat.includes("revenue") || 
                          cat.includes("income") || 
                          normalSide === "credit" ||
                          /revenue|sales|service/i.test(acctName));

        // Calculate amount based on normal side
        let amount = 0;
        if (isRevenue) {
          // Revenue: credit increases, debit decreases
          amount = totals.credit - totals.debit;
          revenues.push({
            accountId: acctId,
            accountName: acctName,
            amount: amount
          });
        } else if (isExpense) {
          // Expense: debit increases, credit decreases
          amount = totals.debit - totals.credit;
          expenses.push({
            accountId: acctId,
            accountName: acctName,
            amount: amount
          });
        }
      });

      // Sort by account name
      const sortByName = (x, y) => 
        String(x.accountName || "").localeCompare(String(y.accountName || ""));
      
      revenues.sort(sortByName);
      expenses.sort(sortByName);

      // Calculate totals
      const totalRevenue = revenues.reduce((s, r) => s + parseNum(r.amount), 0);
      const totalExpenses = expenses.reduce((s, e) => s + parseNum(e.amount), 0);
      const netIncome = totalRevenue - totalExpenses;

      return {
        revenues,
        expenses,
        totalRevenue,
        totalExpenses,
        netIncome
      };
    } catch (err) {
      console.error("generateIncomeStatement error:", err);
      return { 
        revenues: [], 
        expenses: [], 
        totalRevenue: 0, 
        totalExpenses: 0, 
        netIncome: 0 
      };
    }
  };

  const generateRetainedEarnings = (from, to) => {
    try {
      // Helper to parse numbers safely (reuse your existing toNumber if available, or use this)
      const parseNum = (v) => {
        if (v === undefined || v === null || v === "") return 0;
        const cleaned = String(v).replace(/,/g, "").trim();
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : 0;
      };

      // Find retained earnings account
      const reAcct = accounts.find((a) => (a.statementType || "").toString().toUpperCase() === "RE") ||
                    accounts.find((a) => /retained/i.test(a.accountName || ""));

      // Opening balance: use initial balance from the retained earnings account, or 0
      const openingBalance = reAcct ? parseNum(reAcct.initialBalance) : 0;

      // Get net income for the period from Income Statement
      const is = generateIncomeStatement(from, to);
      const netIncome = parseNum(is.netIncome);

      // Calculate dividends from ledger entries in the date range
      const dividends = ledgerEntries.reduce((sum, le) => {
        // Only include entries within date range
        if (!withinRange(le.date || le.timestamp, from, to)) return sum;

        // Find the account for this ledger entry
        const acc = accounts.find((a) => a.id === le.accountId) || 
                    accounts.find((a) => a.accountNumber === String(le.accountNumber));

        // If this is a dividend account, add to total
        if (acc && /dividend/i.test(acc.accountName || "")) {
          const debit = parseNum(le.debit);
          const credit = parseNum(le.credit);
          // Dividends are typically debits (reduce equity)
          return sum + (debit - credit);
        }
        return sum;
      }, 0);

      // Calculate ending balance
      const endingBalance = openingBalance + netIncome - dividends;

      return {
        retainedAccount: reAcct || null,
        openingBalance: openingBalance,
        netIncome: netIncome,
        dividends: dividends,
        endingBalance: endingBalance
      };
    } catch (err) {
      console.error("generateRetainedEarnings error:", err);
      return {
        retainedAccount: null,
        openingBalance: 0,
        netIncome: 0,
        dividends: 0,
        endingBalance: 0
      };
    }
  };


  // Report actions.........................................................................................
  const exportReportCSV = (rows, filename = "report.csv") => {
    if (!rows || rows.length === 0) {
      alert("Nothing to export.");
      return;
    }
    // rows = array of objects; create CSV header from keys of first row
    const header = Object.keys(rows[0]).join(",");
    const lines = rows.map((r) => Object.values(r).map(v => `"${String(v).replace(/"/g,'""')}"`).join(","));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // generate CSV string for Trial Balance rows or generic objects
  const generateCSVFromRows = (rows) => {
    if (!rows || rows.length === 0) return "";
    const header = Object.keys(rows[0]);
    const lines = rows.map((r) =>
      header.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")
    );
    return [header.join(","), ...lines].join("\n");
  };

  const blobToDataURL = (blob) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });


  const saveReportToFirestore = async (payload) => {
    if (!payload) {
      alert("No report to save.");
      return null;
    }
    try {
      const docRef = await addDoc(collection(db, "reports"), {
        ...payload,
        createdBy: managerUser?.username || "unknown",
        createdAt: Date.now(),
      });
      alert("Report saved. It will appear in Saved Reports below.");
      return docRef.id;
    } catch (err) {
      console.error("Failed to save report:", err);
      alert("Failed to save report. Check console for details.");
      return null;
    }
  };

  const loadSavedReport = (r) => {
    setGeneratedReport({
      ...r,
      type: r.type || "Saved Report",
      from: r.from || "",
      to: r.to || "",
      rows: r.rows || r.data?.rows || null,
      data: r.data || null,
      savedId: r.id,
    });
  };

  const downloadSavedReportJSON = (r) => {
    const payload = { id: r.id, ...r };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(r.type || "report").replace(/\s+/g, "_").toLowerCase()}_${r.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };


  const sendReportAsMessage = async ({ toUsername, subject, body, attachCSVOpt = true, attachJSONOpt = false }) => {
    if (!toUsername) {
      alert("Please enter a recipient username (in-app).");
      return;
    }
    try {
      setSendingReport(true);

      // validate recipient exists (users state contains user list)
      const recipient = users.find((u) => u.username === toUsername && u.active);
      if (!recipient) {
        alert("Recipient not found or not active.");
        setSendingReport(false);
        return;
      }

      const attachments = [];
      // Helper to attempt storage upload; returns { url, filename, size } or null on failure
      const tryUploadToStorage = async (blob, filename) => {
        try {
          // getStorage() will use default app; if Storage not configured this will throw
          const storage = getStorage();
          const basePath = `reports/${managerUser.username || "manager"}/${Date.now()}`;
          const sRef = storageRef(storage, `${basePath}/${filename}`);
          await uploadBytes(sRef, blob);
          const url = await getDownloadURL(sRef);
          return { url, filename, size: blob.size, path: sRef.fullPath };
        } catch (err) {
          console.warn("Storage upload unavailable or failed:", err);
          return null;
        }
      };

      // Build attachments conditionally
      if (attachCSVOpt && generatedReport) {
        // prefer structured rows when Trial Balance; else fallback to JSON->CSV conversion of data
        let csv = "";
        if (generatedReport.type === "Trial Balance" && generatedReport.rows) {
          csv = generateCSVFromRows(generatedReport.rows);
        } else if (generatedReport.type === "Income Statement" && generatedReport.data) {
          // flatten revenue + expenses into rows
          const rows = [];
          (generatedReport.data.revenues || []).forEach((r) =>
            rows.push({ section: "Revenue", account: r.accountName, amount: r.amount })
          );
          (generatedReport.data.expenses || []).forEach((r) =>
            rows.push({ section: "Expense", account: r.accountName, amount: r.amount })
          );
          csv = generateCSVFromRows(rows);
        } else {
          csv = generateCSVFromRows([generatedReport]);
        }

        const csvBlob = new Blob([csv], { type: "text/csv" });
        const csvFilename = `${(generatedReport.type || "report").replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.csv`;

        // try upload to Storage, fallback to data URL
        const uploaded = await tryUploadToStorage(csvBlob, csvFilename);
        if (uploaded) {
          attachments.push({ type: "csv", filename: uploaded.filename, url: uploaded.url, size: uploaded.size });
        } else {
          const dataUrl = await blobToDataURL(csvBlob);
          attachments.push({ type: "csv", filename: csvFilename, dataUrl, size: csvBlob.size });
        }
      }

      if (attachJSONOpt && generatedReport) {
        const json = JSON.stringify(generatedReport, null, 2);
        const jsonBlob = new Blob([json], { type: "application/json" });
        const jsonFilename = `${(generatedReport.type || "report").replace(/\s+/g, "_").toLowerCase()}_${Date.now()}.json`;

        const uploaded = await tryUploadToStorage(jsonBlob, jsonFilename);
        if (uploaded) {
          attachments.push({ type: "json", filename: uploaded.filename, url: uploaded.url, size: uploaded.size });
        } else {
          const dataUrl = await blobToDataURL(jsonBlob);
          attachments.push({ type: "json", filename: jsonFilename, dataUrl, size: jsonBlob.size });
        }
      }

      // message payload
      const payload = {
        from: managerUser.username,
        to: toUsername,
        subject: subject || `${generatedReport?.type || "Report"} (${generatedReport?.from || "—"}→${generatedReport?.to || "—"})`,
        body: body || `Report generated by ${managerUser.username}`,
        timestamp: Date.now(),
        attachments,
        reportMeta: {
          type: generatedReport?.type || null,
          from: generatedReport?.from || null,
          to: generatedReport?.to || null,
          generatedAt: generatedReport?.generatedAt || null,
          rowsCount:
            (generatedReport?.rows && generatedReport.rows.length) ||
            (generatedReport?.data && ((generatedReport.data.revenues||[]).length + (generatedReport.data.expenses||[]).length)) ||
            null,
        },
      };

      await addDoc(collection(db, "messages"), payload);

      // log event
      try {
        await logManagerAccountEvent({
          accountId: null,
          action: "SentReport",
          userId: managerUser.username,
          oldData: null,
          newData: { to: toUsername, subject: payload.subject, attachmentsCount: attachments.length || 0 },
        });
      } catch (err) {
        console.warn("logManagerAccountEvent failed for send report:", err);
      }

      setSendModalOpen(false);
      setSendToUser("");
      setSendSubject("");
      setSendBody("");
      setAttachCSV(true);
      setAttachJSON(false);
      alert("Report sent as an in-app message.");
    } catch (err) {
      console.error("Failed to send report message:", err);
      alert("Failed to send report. See console.");
    } finally {
      setSendingReport(false);
    }
  };

  const handleSendReport = async ({
    toUsername,
    subject,
    body,
    attachPdf = false,
    attachCsv = false,
    attachJson = false,
    timeoutMs = 15000,
  } = {}) => {
    if (!toUsername) {
      alert("Please enter a recipient username.");
      return;
    }

    if (!generatedReport) {
      alert("No generated report to send. Generate a report first.");
      return;
    }

    // Validate recipient exists
    const recipient = users.find((u) => u.username === toUsername && u.active);
    if (!recipient) {
      alert("Recipient not found or not active.");
      return;
    }

    setSendModalSending(true);

    try {
      let reportSummary = "";
      
      if (generatedReport.type === "Trial Balance" && generatedReport.rows) {
        const totalDebit = generatedReport.rows.reduce((sum, r) => sum + Number(r.debit || 0), 0);
        const totalCredit = generatedReport.rows.reduce((sum, r) => sum + Number(r.credit || 0), 0);
        reportSummary = `\n\n--- Report Summary ---\nTotal Accounts: ${generatedReport.rows.length}\nTotal Debits: $${totalDebit.toLocaleString(undefined, {minimumFractionDigits: 2})}\nTotal Credits: $${totalCredit.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
      } else if (generatedReport.type === "Income Statement" && generatedReport.data) {
        reportSummary = `\n\n--- Report Summary ---\nTotal Revenue: $${(generatedReport.data.totalRevenue || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}\nTotal Expenses: $${(generatedReport.data.totalExpenses || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}\nNet Income: $${(generatedReport.data.netIncome || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
      } else if (generatedReport.type === "Balance Sheet" && generatedReport.data) {
        reportSummary = `\n\n--- Report Summary ---\nTotal Assets: $${(generatedReport.data.assetsTotal || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}\nTotal Liabilities: $${(generatedReport.data.liabilitiesTotal || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}\nTotal Equity: $${(generatedReport.data.equityTotal || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
      } else if (generatedReport.type === "Retained Earnings" && generatedReport.data) {
        reportSummary = `\n\n--- Report Summary ---\nOpening Balance: $${(generatedReport.data.openingBalance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}\nNet Income: $${(generatedReport.data.netIncome || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}\nDividends: $${(generatedReport.data.dividends || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}\nEnding Balance: $${(generatedReport.data.endingBalance || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
      }

      const messagePayload = {
        from: managerUser.username || "unknown",
        to: toUsername,
        subject: subject || `${generatedReport.type} Report (${generatedReport.from || "—"} to ${generatedReport.to || "—"})`,
        body: (body || `Please find the ${generatedReport.type} report details below.`) + reportSummary,
        timestamp: Date.now(),
        reportMeta: {
          type: generatedReport.type || "Report",
          from: generatedReport.from || null,
          to: generatedReport.to || null,
        },
      };

      await addDoc(collection(db, "messages"), messagePayload);

      alert("Report sent successfully!");
      setSendModalOpen(false);
      setSendToUser("");
      setSendSubject("");
      setSendBody("");
      setAttachPDF(true);
      setAttachCSV(false);
      setAttachJSON(false);

    } catch (err) {
      console.error("handleSendReport error:", err);
      alert("Failed to send report. See console for details.");
    } finally {
      setSendModalSending(false);
    }
  };


  // validate & prepare payload (returns payload or null) - includes date range check
  const validateAndPrepareManagerJE = async (statusForDB = "Pending") => {
    // Reset any displayed error
    setAccountError("");
    setErrorSuggestion("");
    setDisplayErrorCode(null);

    // 1) Date required
    if (!jeDate) {
      await setValidationError("JE_DATE_MISSING", "Please select a date for the journal entry.");
      await writeErrorLog({
        errorCode: "JE_DATE_MISSING",
        message: "Journal entry missing date",
        context: "JournalEntry",
        contextId: draftId || null,
        user: managerUser.username,
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
        await setValidationError(
          "JE_DATE_OUT_OF_RANGE",
          `Date must be between ${minDateStr} and ${maxDateStr}.`
        );
        await writeErrorLog({
          errorCode: "JE_DATE_OUT_OF_RANGE",
          message: "Journal entry date out of allowed range",
          context: "JournalEntry",
          contextId: draftId || null,
          user: managerUser.username,
          payload: { date: jeDate, allowedRange: { min: minDateStr, max: maxDateStr } },
        });
        return null;
      }
    } catch (err) {
      // fallback
    }

    // 1.5) Memo length limit
    if (jeMemo && jeMemo.length >100) {
      await setValidationError("JE_MEMO_TOO_LONG", "Memo must be 100 characters or fewer.");
      await writeErrorLog({
        errorCode: "JE_MEMO_TOO_LONG",
        message: "Journal entry memo exceeds allowed length",
        context: "JournalEntry",
        contextId: draftId || null,
        user: managerUser.username,
        payload: { memoLength: jeMemo.length },
      });
      return null;
    }

    // 2) Iterate through rows and validate
    const maxRows = Math.max(debits.length, credits.length);
    let anyRow = false;
    const debitLines = [];
    const creditLines = [];

    for (let i = 0; i < maxRows; i++) {
      const d = debits[i] || {};
      const c = credits[i] || {};

      // single amount field per row (d.amount or c.amount). prefer d.amount then c.amount
      const amtStr = d?.amount !== undefined && d?.amount !== "" ? d.amount : c?.amount;
      const amt = parseFloat(amtStr);

      // If an account is selected but no amount provided -> require amount
      if (d?.accountId && (d.amount === "" || d.amount === undefined)) {
        await setValidationError("JE_MISSING_AMOUNT", "Please enter an amount for any row with a selected debit account.");
        await writeErrorLog({
          errorCode: "JE_MISSING_AMOUNT",
          message: "Debit account selected but amount missing",
          context: "JournalEntry",
          contextId: draftId || null,
          user: managerUser.username,
          payload: { rowIndex: i, debit: d },
        });
        return null;
      }
      if (c?.accountId && (c.amount === "" || c.amount === undefined)) {
        await setValidationError("JE_MISSING_AMOUNT", "Please enter an amount for any row with a selected credit account.");
        await writeErrorLog({
          errorCode: "JE_MISSING_AMOUNT",
          message: "Credit account selected but amount missing",
          context: "JournalEntry",
          contextId: draftId || null,
          user: managerUser.username,
          payload: { rowIndex: i, credit: c },
        });
        return null;
      }

      // if no amount in this row -> skip
      if (!amtStr && amtStr !== 0) {
        continue;
      }

      anyRow = true;

      if (!Number.isFinite(amt)) {
        await setValidationError("JE_INVALID_AMOUNT", "Please enter a valid amount for each populated row.");
        await writeErrorLog({
          errorCode: "JE_INVALID_AMOUNT",
          message: "Invalid amount value in JE row",
          context: "JournalEntry",
          contextId: draftId || null,
          user: managerUser.username,
          payload: { rowIndex: i, debit: d, credit: c },
        });
        return null;
      }

      if (amt < 0) {
        await setValidationError("JE_NEGATIVE_AMOUNT", "Amount cannot be negative. Use positive values only.");
        await writeErrorLog({
          errorCode: "JE_NEGATIVE_AMOUNT",
          message: "Negative amount in journal entry row",
          context: "JournalEntry",
          contextId: draftId || null,
          user: managerUser.username,
          payload: { rowIndex: i, amount: amt },
        });
        return null;
      }

      if (amt === 0) {
        await setValidationError("JE_ZERO_AMOUNT", "Amount cannot be zero. Enter a positive value.");
        await writeErrorLog({
          errorCode: "JE_ZERO_AMOUNT",
          message: "Zero amount in journal entry row",
          context: "JournalEntry",
          contextId: draftId || null,
          user: managerUser.username,
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
          user: managerUser.username,
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
          user: managerUser.username,
          payload: { rowIndex: i, credit: c },
        });
        return null;
      }

      // prevent same account on both sides of the same row (if both selected)
      if (d.accountId && c.accountId && d.accountId === c.accountId) {
        await setValidationError("JE_SAME_ACCOUNT_BOTH_SIDES", "A single account cannot be both debit and credit in the same row.");
        await writeErrorLog({
          errorCode: "JE_SAME_ACCOUNT_BOTH_SIDES",
          message: "Same account used on both debit and credit in a row",
          context: "JournalEntry",
          contextId: draftId || null,
          user: managerUser.username,
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

    } // end row loop

    if (!anyRow) {
      await setValidationError("JE_NO_ROWS", "Add at least one row with a positive amount.");
      await writeErrorLog({
        errorCode: "JE_NO_ROWS",
        message: "Journal entry has no populated rows",
        context: "JournalEntry",
        contextId: draftId || null,
        user: managerUser.username,
        payload: { debits, credits },
      });
      return null;
    }

    // everything validated, compute totals and create payload
    const totalDebits = debitLines.reduce((s, r) => s + r.amount, 0);
    const totalCredits = creditLines.reduce((s, r) => s + r.amount, 0);

    // Backwards-compatible legacy single-line fields if exactly one debit & credit
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

    // attachments limits
    for (const at of attachments) {
      if (at.size && at.size > 15 * 1024 * 1024) {
        await setValidationError("JE_ATTACHMENT_TOO_LARGE", "Attachment too large. Max 15 MB per file.");
        await writeErrorLog({
          errorCode: "JE_ATTACHMENT_TOO_LARGE",
          message: "Attachment exceeded size limit",
          context: "JournalEntry",
          contextId: draftId || null,
          user: managerUser.username,
          payload: { filename: at.name, size: at.size },
        });
        return null;
      }
      if (at.type && !supportedTypes.includes(at.type)) {
        await setValidationError("JE_ATTACHMENT_INVALID_TYPE", "Unsupported file type for attachments.");
        await writeErrorLog({
          errorCode: "JE_ATTACHMENT_INVALID_TYPE",
          message: "Unsupported attachment type",
          context: "JournalEntry",
          contextId: draftId || null,
          user: managerUser.username,
          payload: { filename: at.name, type: at.type },
        });
        return null;
      }
    }

    // successful payload
    return {
      debits: debitLines,
      credits: creditLines,
      totalDebits,
      totalCredits,
      date: jeDate,
      memo: jeMemo || "",
      attachments,
      status: statusForDB,
      createdBy: managerUser.username,
      createdAt: Date.now(),
      submittedBy: statusForDB === "Pending" ? managerUser.username : null,
      submittedAt: statusForDB === "Pending" ? Date.now() : null,
      ...legacy,
    };
  }; // end validateAndPrepareManagerJE

  // Submit JE (creates a Pending journal entry)
  const submitJournalEntry = async (e) => {
    e?.preventDefault();
    setJeError("");
    setAccountError("");
    setErrorSuggestion("");
    const payload = await validateAndPrepareManagerJE("Pending");
    if (!payload) {
      // validation helper already set UI and logged the error
      return;
    }
    try {
      setJeSaving(true);
      const ref = await addDoc(collection(db, "journalEntries"), payload);
  
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
            from: managerUser.username,
            to: mgr.data().username,
            subject: `Journal Entry Pending Review – JE #${ref.id}`,
            message: `A new Journal Entry requires your review.

      Journal Entry ID: ${ref.id}
      Date: ${formatLocalJE(payload.date)}
      Submitted by: ${managerUser.username}

      `,
            timestamp: Date.now(),
            read: false,
            type: "system-alert",
          })
        );

        await Promise.all(notifications);
        console.log("Manager JE notifications sent.");
      } catch (err) {
        console.error("Manager JE notification failed:", err);
      }

      // log that the manager submitted a JE
      try {
        await logManagerAccountEvent({
          accountId: null,
          action: "SubmittedJournalEntry",
          userId: managerUser.username,
          oldData: null,
          newData: { journalEntryId: ref.id, ...payload },
        });
      } catch (err) {
        // already tolerated by helper; no UI break
        console.warn("logManagerAccountEvent failed for submit:", err);
      }

      if (draftId) {
        try {
          await deleteDoc(doc(db, "jeDrafts", draftId));
          setDraftId(null);
        } catch (err) {
          console.warn("Failed to delete associated draft:", err);
        }
      }
      resetJeForm();
      alert("Journal entry submitted (Pending approval).");
    } catch (err) {
      console.error("Submit JE failed:", err);
      setJeError("Failed to submit journal entry.");
      await writeErrorLog({
        errorCode: "JE_SUBMIT_FAILED",
        message: "Failed to persist journal entry",
        context: "JournalEntry",
        user: managerUser.username,
        payload: { error: err?.toString?.() },
      });
    } finally {
      setJeSaving(false);
    }
  };

  // Approve / Reject handlers 
  const handleApprove = async (entry) => {
    try {
      const jeRef = doc(db, "journalEntries", entry.id);
      await updateDoc(jeRef, {
        status: "Approved",
        approvedBy: managerUser.username,
        approvedAt: Date.now(),
      });

      const debs =
        (entry.debits && Array.isArray(entry.debits) && entry.debits) ||
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
        (entry.credits && Array.isArray(entry.credits) && entry.credits) ||
        (entry.creditAccountId
          ? [
              {
                accountId: entry.creditAccountId,
                accountName: entry.creditAccountName || "",
                amount: entry.amount || entry.totalAmount || 0,
              },
            ]
          : []);

      for (const dl of debs) {
        if (!dl.accountId) continue;
        const accSnap = await getDoc(doc(db, "accounts", dl.accountId));
        const acc = accSnap.exists() ? accSnap.data() : {};
        const accountNumber = acc.accountNumber || null;

        await addDoc(collection(db, "ledgerEntries"), {
          accountId: dl.accountId,
          accountNumber,
          accountName: dl.accountName || acc.accountName || "",
          journalEntryId: entry.id,
          type: "Debit",
          amount: dl.amount,
          debit: dl.amount,
          credit: 0,
          date: entry.date,
          source: "JournalApproval",
          postedBy: managerUser.username,
          timestamp: Date.now(),
        });
      }

      for (const cl of creds) {
        if (!cl.accountId) continue;
        const accSnap = await getDoc(doc(db, "accounts", cl.accountId));
        const acc = accSnap.exists() ? accSnap.data() : {};
        const accountNumber = acc.accountNumber || null;

        await addDoc(collection(db, "ledgerEntries"), {
          accountId: cl.accountId,
          accountNumber,
          accountName: cl.accountName || acc.accountName || "",
          journalEntryId: entry.id,
          type: "Credit",
          amount: cl.amount,
          debit: 0,
          credit: cl.amount,
          date: entry.date,
          source: "JournalApproval",
          postedBy: managerUser.username,
          timestamp: Date.now(),
        });
      }
      // manager approved JE - high-level event
      try {
        await logManagerAccountEvent({
          accountId: entry.id,
          action: "ApprovedJournalEntry",
          userId: managerUser.username,
          oldData: { status: "Pending" },
          newData: { status: "Approved", approvedBy: managerUser.username, approvedAt: Date.now() },
        });
      } catch (err) {
        console.warn("logManagerAccountEvent failed for approve:", err);
      }

      alert("Entry approved and posted to ledger.");
    } catch (err) {
      console.error("Error approving entry:", err);
      alert("Error approving entry.");
      await writeErrorLog({
        errorCode: "JE_APPROVE_FAILED",
        message: "Failed while approving journal entry",
        context: "JournalEntry",
        user: managerUser.username,
        payload: { error: err?.toString?.() },
      });
    }
  };

  const handleReject = async (entry, reason) => {
    if (!reason || !reason.trim()) {
      alert("Reject reason required.");
      return;
    }
    try {
      await updateDoc(doc(db, "journalEntries", entry.id), {
        status: "Rejected",
        rejectReason: reason,
        rejectedBy: managerUser.username,
        rejectedAt: Date.now(),
      });
      // manager rejected JE - log rejection
      try {
        await logManagerAccountEvent({
          accountId: entry.id,
          action: "RejectedJournalEntry",
          userId: managerUser.username,
          oldData: { status: entry.status || "Pending" },
          newData: { status: "Rejected", rejectReason: reason, rejectedBy: managerUser.username, rejectedAt: Date.now() },
        });
      } catch (err) {
        console.warn("logManagerAccountEvent failed for reject:", err);
      }
      alert("Entry rejected.");
    } catch (err) {
      console.error("Error rejecting entry:", err);
      alert("Failed to reject entry.");
    }
  };

  const filteredJournalEntries = journalEntries.filter((entry) => {
    const byStatus = jeFilterStatus === "All" || entry.status === jeFilterStatus;
    const inRange =
      (!jeDateRange.from || new Date(entry.date) >= new Date(jeDateRange.from)) &&
      (!jeDateRange.to || new Date(entry.date) <= new Date(jeDateRange.to));

    if (!jeSearch) return byStatus && inRange;

    const q = jeSearch.toLowerCase();
    const debitNames =
      (entry.debits && Array.isArray(entry.debits) && entry.debits.map((d) => d.accountName || "").join(" ")) ||
      (entry.debitAccountName || "");
    const creditNames =
      (entry.credits && Array.isArray(entry.credits) && entry.credits.map((c) => c.accountName || "").join(" ")) ||
      (entry.creditAccountName || "");

    const amountMatch = String(entry.amount || entry.totalAmount || "").includes(q);
    const dateMatch = entry.date ? new Date(entry.date).toLocaleDateString().toLowerCase().includes(q) : false;
    const accountMatch =
      (debitNames + " " + creditNames).toLowerCase().includes(q);

    return byStatus && inRange && (amountMatch || dateMatch || accountMatch);
  });


  // RENDER.........................................................................................................................................................................................
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "90vh", marginTop: "0.8rem" }}>


      {/* HEADER */}
      {managerUser.role ? (
        <div style={{ width: "95vw", margin: "0 auto", maxWidth: 1400 }}>
          <Header username={managerUser.username} profilePic={managerUser.profilePic} role={managerUser.role} activeTab={activeTab} setActiveTab={setActiveTab} />
        </div>
      ) : (
        <div style={{ textAlign: "center", marginTop: "2rem", color: "#6b7280", fontSize: "1rem" }}>Loading manager data...</div>
      )}


      {/* LAYOUT */}
      <div style={{ display: "flex", flex: 1, width: "95vw", margin: "0 auto", maxWidth: 1400 }}>
        <main style={{ flex: 1, padding: "2.5rem", backgroundColor: "#ffffff" }}>
          {/* Global validation banner (red) - appears whenever accountError is set */}
          {accountError && (
            <div style={{ background: "#fff5f5", border: "1px solid #fecaca", color: "#b91c1c", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1rem" }}>
              <div style={{ fontWeight: 700 }}>{accountError}</div>
              {errorSuggestion && <div style={{ marginTop: "0.25rem", color: "#991b1b" }}>{errorSuggestion}</div>}
            </div>
          )}

          
          {/* DASHBOARD........................................................................................................................................................................... */} 
          {activeTab === "Dashboard" && (
            <>
              <h2 style={{ color: "#111827", fontSize: "1.5rem", width: "95vw", margin: "0 auto", marginTop: "0.75rem", maxWidth: 1325}}>
                Manager Dashboard
              </h2>
              <p style={{ marginTop: "0.75rem", color: "#374151", fontSize: "1rem" }}>
                Use the top navigation to view accounts, manage journal entries, track system activity, generate reports, communicate, and access support resources.
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

          {/* Manage Users */}
          {activeTab === "Manage Users" && (
            <>
              <h2>Manage Users</h2>
              <p style={{ marginTop: "0.75rem", color: "#374151" }}>
                Managers can only view users; editing, suspension, or deactivation is
                restricted to administrators.
              </p>
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
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td style={{ color: "#111827", padding: "0.75rem" }}>{u.username}</td>
                      <td style={{ color: "#111827", padding: "0.75rem" }}>{u.role}</td>
                      <td
                        style={{
                          color: u.active ? "green" : "red",
                          padding: "0.75rem",
                        }}
                      >
                        {u.active ? "Active" : "Inactive"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}


          {/* Chart of Accounts.................................................................................................................................................................... */}
          {activeTab === "Chart of Accounts" && (
            <div className="chart-of-accounts" style={{ position: "relative", width: "95vw", margin: "0 auto", marginTop: "0.75rem", maxWidth: 1325 }}>
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
                  <label style={{ }}></label>
                  <input
                    type="text"
                    placeholder="Search by name, number, or category..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                      width: "400px",
                      padding: "0.5rem 1rem",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                      height: "20px",
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


          {/* JOURNAL ENTRIES.............................................................................................................................................................................. */} 
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
                          minHeight: "17px",
                          marginTop: "-0.2rem",
                          marginBottom: "1.2rem",
                        }}
                        onInvalid={(ev) => ev.preventDefault()}
                      />

                    </div>

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
                          onClick={addDebitRow}
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
                          setErrorSuggestion("");
                          setDisplayErrorCode(null);
                          return;
                        }
                        const chosenD = new Date(val + "T00:00:00");
                        const minD = new Date(minDateStr + "T00:00:00");
                        const maxD = new Date(maxDateStr + "T23:59:59");
                        if (chosenD >= minD && chosenD <= maxD) {
                          setAccountError("");
                          setErrorSuggestion("");
                          setDisplayErrorCode(null);
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
                        padding: "0.45rem",
                        borderRadius: 6,
                        border: "1px solid #ccc",
                        minHeight: "17px",
                        marginTop: "0.5rem",
                        marginBottom: "1.2rem",
                      }}
                    />
                  </div>
                </div>

                {/* Inline accountError removed - top banner shows validation messages */}
                {jeError && <div style={{ color: "red", marginBottom: "0.75rem" }}>{jeError}</div>}


                {/* Actions */}
                <div
                  style={{
                    gap: "0.75rem",         
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      resetJeForm();
                      setJeError("");
                    }}
                    style={{
                      background: "#ef4444",
                      color: "white",
                      border: "1px solid #cbd5e1",
                      padding: "0.6rem 1rem",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                      marginRight: 0,      
                      alignSelf: "center",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#dc2626")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#ef4444")}
                  >
                    Cancel/Reset
                  </button>

                  <button
                    type="submit"
                    disabled={jeSaving || invalidAttachments.length > 0}
                    title={invalidAttachments.length > 0 ? "Remove unsupported attachment(s) before submitting" : undefined}
                    style={{
                      background: "#10b981", 
                      color: "#fff", 
                      border: "none",
                      padding: "0.6rem 1.1rem",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 700,
                      marginLeft: 0,          
                      float: "none",           
                      alignSelf: "center",  
                    }}
                  >
                    {jeSaving ? "Submitting..." : "Submit"}
                  </button>
                </div>
              </form>

              {/* Journal Entry List */}
              <h3 style={{ color: "#111827", marginTop: "2.5rem" }}>Journal Entry List</h3>

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
                    value={jeFilterStatus}
                    onChange={(e) => setJeFilterStatus(e.target.value)}
                    style={{
                      padding: "0.4rem 0.5rem",
                      borderRadius: "6px",
                      border: "1px solid #ccc",
                      minWidth: "140px",
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
                    onChange={(e) => setJeDateRange((p) => ({ ...p, from: e.target.value }))}
                    style={{ padding: "0.4rem 0.5rem", borderRadius: "6px", border: "1px solid #ccc" }}
                  />
                </div>

                {/* To Date */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <label style={{ marginBottom: "0.25rem" }}>To:</label>
                  <input
                    type="date"
                    value={jeDateRange.to}
                    onChange={(e) => setJeDateRange((p) => ({ ...p, to: e.target.value }))}
                    style={{ padding: "0.4rem 0.5rem", borderRadius: "6px", border: "1px solid #ccc" }}
                  />
                </div>

                {/* Search */}
                <div style={{ display: "flex", flexDirection: "column", marginLeft: "auto" }}>
                  <label style={{ marginBottom: "0.25rem", visibility: "hidden" }}>Search</label>
                  <input
                    type="text"
                    placeholder="Search account name, amount, or date..."
                    value={jeSearch}
                    onChange={(e) => setJeSearch(e.target.value)}
                    style={{ padding: "0.45rem 0.6rem", borderRadius: "6px", border: "1px solid #ccc", minWidth: "320px", height: "20px",}}
                  />
                </div>
              </div>

              {/* JE Table */}
              <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", marginTop: "1rem" }}>
              <thead style={{ background: "#f9fafb", textAlign: "left" }}>
                <tr>
                  <th style={{ padding: 10, width: 120 }}>Date</th>
                  <th style={{ padding: 10 }}>Accounts</th>
                  <th style={{ padding: 10, width: 120, textAlign: "left" }}>Debit</th>
                  <th style={{ padding: 10, width: 120, textAlign: "left" }}>Credit</th>
                  <th style={{ padding: 10, width: 160, textAlign: "left" }}>Attachments</th>
                  <th style={{ padding: 10, maxWidth: 240, textAlign: "left" }}>Memo</th>
                  <th style={{ padding: 10, width: 120, textAlign: "left" }}>Status</th>
                  <th style={{ padding: 10, width: 160, textAlign: "left" }}>Submitted By</th>
                  <th style={{ padding: 10, width: 160, textAlign: "left" }}>Actions</th>
                </tr>
              </thead>

                <tbody>
                  {filteredJournalEntries.map((entry) => {
                    // Build debit and credit lists (support both new multi-line and legacy single-line)
                    const debs =
                      (entry.debits && Array.isArray(entry.debits) && entry.debits.map((d) => ({
                        accountId: d.accountId || d.account || "",
                        accountName: d.accountName || d.account || "",
                        amount: d.amount || 0,
                      }))) ||
                      (entry.debitAccountId
                        ? [{ accountId: entry.debitAccountId, accountName: entry.debitAccountName || "", amount: entry.amount || entry.totalAmount || 0 }]
                        : []);

                    const creds =
                      (entry.credits && Array.isArray(entry.credits) && entry.credits.map((c) => ({
                        accountId: c.accountId || c.account || "",
                        accountName: c.accountName || c.account || "",
                        amount: c.amount || 0,
                      }))) ||
                      (entry.creditAccountId
                        ? [{ accountId: entry.creditAccountId, accountName: entry.creditAccountName || "", amount: entry.amount || entry.totalAmount || 0 }]
                        : []);

                    const totalRows = Math.max(debs.length + creds.length, 1);
                    const rejectionText =
                      entry.rejectionReason ||
                      entry.rejectReason ||
                      entry.reason ||
                      entry.rejectionNote ||
                      entry.rejectReason ||
                      "";

                    return (
                      <React.Fragment key={entry.id}>
                        {Array.from({ length: totalRows }).map((_, rowIndex) => {
                          const isDebitRow = rowIndex < debs.length;
                          const debitIndex = rowIndex;
                          const creditIndex = rowIndex - debs.length;
                          const showShared = rowIndex === 0;
                          const rowStyle = {
                            borderBottom: rowIndex === totalRows - 1 ? "2px solid #e5e7eb" : "1px solid #e5e7eb",
                            ...(rowIndex === debs.length && debs.length > 0 ? { borderTop: "2px solid #e5e7eb" } : {}),
                          };

                          return (
                            <tr key={`${entry.id}-r-${rowIndex}`} style={rowStyle} id={`journal-entry-${entry.id}`}>
                              {showShared && (
                                <td rowSpan={totalRows} style={{ padding: "0.75rem", verticalAlign: "top", whiteSpace: "nowrap" }}>
                                  {entry.date
                                    ? `${entry.date.split("-")[1]}/${entry.date.split("-")[2]}/${entry.date.split("-")[0]}`
                                    : "—"}

                                </td>
                              )}

                              {/* Accounts cell */}
                              <td style={{ padding: "0.75rem", verticalAlign: "top" }}>
                                {isDebitRow ? (
                                  <Link to={`/ledger/${debs[debitIndex].accountId || ""}`} style={{ color: "#2563eb", textDecoration: "none" }}>
                                    {debs[debitIndex].accountName || "—"}
                                  </Link>
                                ) : rowIndex >= debs.length ? (
                                  <Link to={`/ledger/${(creds[creditIndex] && creds[creditIndex].accountId) || ""}`} style={{ color: "#2563eb", textDecoration: "none" }}>
                                    {(creds[creditIndex] && creds[creditIndex].accountName) || "—"}
                                  </Link>
                                ) : (
                                  "—"
                                )}
                              </td>

                              {/* Debit */}
                              <td style={{ padding: "0.75rem", verticalAlign: "top", textAlign: "left", width: "120px", whiteSpace: "nowrap" }}>
                                {isDebitRow ? (
                                  Number(debs[debitIndex].amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                ) : (
                                  "—"
                                )}
                              </td>


                              {/* Credit */}
                              <td style={{ padding: "0.75rem", verticalAlign: "top", textAlign: "left", width: "120px", whiteSpace: "nowrap" }}>
                                {rowIndex >= debs.length ? (
                                  Number((creds[creditIndex] && creds[creditIndex].amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                ) : (
                                  "—"
                                )}
                              </td>


                              {showShared && (
                                <>
                                  {/* Attachments column - inserted before Memo */}
                                  <td rowSpan={totalRows} style={{ padding: "0.75rem", verticalAlign: "top", width: "160px" }}>
                                    {entry.attachments && entry.attachments.length > 0 ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        {entry.attachments.map((att, ai) => (
                                          <a
                                            key={ai}
                                            href={att.dataUrl || att.url || "#"}
                                            onClick={(e) => {
                                              e.preventDefault(); // prevent default navigation
                                              openAttachment(att);
                                            }}
                                            style={{ color: "#2563eb", textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                                            title={att.name || "attachment"}
                                          >
                                            {att.name || `attachment-${ai + 1}`}
                                          </a>
                                        ))}
                                      </div>
                                    ) : (
                                      "—"
                                    )}
                                  </td>

                                  {/* Memo */}
                                  <td
                                    rowSpan={totalRows}
                                    style={{
                                      padding: "0.75rem",
                                      verticalAlign: "top",
                                      maxWidth: 200,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "normal",
                                    }}
                                  >
                                    {entry.memo || "—"}
                                  </td>

                                  {/* Status */}
                                  <td
                                    rowSpan={totalRows}
                                    style={{
                                      padding: "0.75rem",
                                      verticalAlign: "top",
                                      color: entry.status === "Approved" ? "green" : entry.status === "Rejected" ? "red" : "#374151",
                                    }}
                                  >
                                    <div style={{ fontWeight: 600 }}>{entry.status || "Pending"}</div>
                                    {entry.status === "Rejected" && (
                                      <div style={{ marginTop: 6 }}>
                                        <div>Reason: {" " + (rejectionText || "—")}</div>
                                      </div>
                                    )}
                                  </td>

                                  {/* Submitted By */}
                                  <td rowSpan={totalRows} style={{ padding: "0.75rem", verticalAlign: "top" }}>
                                    {entry.submittedBy || entry.createdBy || "—"}
                                  </td>

                                  {/* Actions */}
                                  <td rowSpan={totalRows} style={{ padding: "0.75rem", verticalAlign: "top" }}>
                                    {entry.status === "Pending" ? (
                                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        <button
                                          onClick={() => handleApprove(entry)}
                                          style={{
                                            background: "#22c55e",
                                            color: "#fff",
                                            border: "none",
                                            borderRadius: 6,
                                            padding: "6px 10px",
                                            cursor: "pointer",
                                            fontWeight: 600,
                                          }}
                                        >
                                          Approve
                                        </button>
                                        <button
                                          onClick={() => setRejectingEntry(entry)}
                                          style={{
                                            background: "#ef4444",
                                            color: "#fff",
                                            border: "none",
                                            borderRadius: 6,
                                            padding: "6px 10px",
                                            cursor: "pointer",
                                            fontWeight: 600,
                                          }}
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    ) : (
                                      <div style={{ color: "#6b7280" }}>—</div>
                                    )}
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

              {/* Reject Modal (requires reason) */}
              {rejectingEntry && (
                <div
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    width: "100vw",
                    height: "100vh",
                    background: "rgba(0,0,0,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 999,
                  }}
                >
                  <div style={{ background: "#fff", padding: "1.5rem", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.2)", width: "480px" }}>
                    <h3 style={{ marginBottom: "0.75rem" }}>Reject Journal Entry - {rejectingEntry.memo || "Untitled"}</h3>
                    <label style={{ display: "block", marginBottom: "0.5rem" }}>Enter reason for rejection:</label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={4}
                      style={{ width: "100%", borderRadius: "6px", border: "1px solid #ccc", padding: "0.5rem", marginBottom: "1rem" }}
                    />

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                      <button
                        onClick={() => {
                          setRejectingEntry(null);
                          setRejectReason("");
                        }}
                        style={{ background: "#ef4444", color: "white", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (!rejectReason.trim()) {
                            alert("Please enter a rejection reason before proceeding.");
                            return;
                          }
                          handleReject(rejectingEntry, rejectReason);
                          setRejectingEntry(null);
                          setRejectReason("");
                        }}
                        style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
                      >
                        Confirm Reject
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* EVENT LOGS........................................................................................................................................................................... */} 
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
                    {managerEventLogs && managerEventLogs.length > 0 ? (
                      managerEventLogs.map((log) => (
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


          {/* REPORTS........................................................................................................................................................................... */} 
          {activeTab === "Reports" && (
            <div style={{ paddingTop: "0rem", width: "95vw", margin: "0 auto", maxWidth: 1400, marginTop: "0.75rem", maxWidth: 1330 }}>
              <h2 style={{ color: "#111827" }}>Reports</h2>

              {/* Controls */}
              <div
                style={{
                  display: "flex",
                  gap: "1rem",
                  alignItems: "flex-start",
                  marginBottom: "1rem",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ marginTop: "0.2rem", display: "flex", flexDirection: "column" }}>
                  <label style={{ marginBottom: "0.1rem", fontWeight: 600 }}>Report</label>
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value)}
                    style={{ padding: "0.5rem", borderRadius: 6, marginTop: 0 }}
                  >
                    <option>Trial Balance</option>
                    <option>Income Statement</option>
                    <option>Balance Sheet</option>
                    <option>Retained Earnings</option>
                  </select>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <label style={{ margin: "0 0 0.25rem 0", fontWeight: 600 }}>From</label>
                    <input
                      type="date"
                      value={reportRange.from}
                      onChange={(e) => setReportRange((r) => ({ ...r, from: e.target.value }))}
                      style={{ padding: "0.4rem", borderRadius: 6 }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <label style={{ margin: "0 0 0.25rem 0", fontWeight: 600 }}>To</label>
                    <input
                      type="date"
                      value={reportRange.to}
                      onChange={(e) => setReportRange((r) => ({ ...r, to: e.target.value }))}
                      style={{ padding: "0.4rem", borderRadius: 6 }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto", alignItems: "flex-start" }}>
                  <button
                    onClick={async () => {
                      try {
                        setReportLoading(true);
                        let payload = null;
                        if (reportType === "Trial Balance")
                          payload = { type: "Trial Balance", rows: generateTrialBalance(reportRange.from, reportRange.to) };
                        else if (reportType === "Income Statement")
                          payload = { type: "Income Statement", data: generateIncomeStatement(reportRange.from, reportRange.to) };
                        else if (reportType === "Balance Sheet")
                          payload = { type: "Balance Sheet", data: generateBalanceSheet(reportRange.to) };
                        else if (reportType === "Retained Earnings")
                          payload = { type: "Retained Earnings", data: generateRetainedEarnings(reportRange.from, reportRange.to) };
                        setGeneratedReport({ ...payload, generatedAt: Date.now(), from: reportRange.from, to: reportRange.to });
                      } catch (err) {
                        console.error("Generate report error:", err);
                        alert("Failed to generate report.");
                      } finally {
                        setReportLoading(false);
                      }
                    }}
                    style={{ background: "#10b981", color: "#fff",  padding: "0.6rem 0.9rem", borderRadius: 6 }}
                  >
                    {reportLoading ? "Generating..." : "Generate"}
                  </button>

                </div>
              </div>

              {/* Generated report area */}
              <div id="manager-report-print-area" ref={printAreaRef} 
                style={{ background: "#fff", padding: "1rem", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
              >
                {!generatedReport ? (
                  <div style={{ color: "#6b7280" }}>No report generated. Select type and dates, then click Generate.</div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                      <div>
                        <h3 style={{ margin: 0 }}>{generatedReport.type}</h3>
                        <div style={{ color: "#6b7280" }}>{generatedReport.from || "—"} → {generatedReport.to || "—"}</div>
                      </div>

                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <button
                          onClick={async () => {
                            await saveReportToFirestore(generatedReport);
                          }}
                          style={{ padding: "0.45rem 0.6rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6 }}
                        >
                          Save
                        </button>

              {/* Download/Print Button */}
              <button
                onClick={async () => {
                  if (!generatedReport) {
                    alert("Generate a report first.");
                    return;
                  }
                  const printArea = printAreaRef.current;
                  if (!printArea) {
                    alert("Report area not found.");
                    return;
                  }

                  try {
                    // Temporarily hide the action buttons during capture
                    const actionButtons = printArea.querySelector('div[style*="display: flex"][style*="gap"]');
                    let originalDisplay = "";
                    if (actionButtons && actionButtons.parentElement) {
                      const buttonContainer = actionButtons;
                      originalDisplay = buttonContainer.style.display;
                      buttonContainer.style.display = "none";
                    }

                    // Capture the report area as canvas
                    const canvas = await html2canvas(printArea, {
                      scale: 2,
                      useCORS: true,
                      logging: false,
                      backgroundColor: "#ffffff",
                    });

                    // Restore button visibility
                    if (actionButtons) {
                      actionButtons.style.display = originalDisplay || "flex";
                    }

                    // Create PDF
                    const imgData = canvas.toDataURL("image/png");
                    const pdf = new jsPDF({
                      orientation: canvas.width > canvas.height ? "landscape" : "portrait",
                      unit: "px",
                      format: [canvas.width, canvas.height],
                    });

                    pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);

                    // Generate filename based on report type
                    const filename = `${generatedReport.type.replace(/\s+/g, "_")}_${generatedReport.from || "report"}_to_${generatedReport.to || "report"}.pdf`;
                    pdf.save(filename);
                  } catch (err) {
                    console.error("PDF generation error:", err);
                    alert("Failed to generate PDF. Check console for details.");
                  }
                }}
                style={{ padding: "0.45rem 0.6rem", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6 }}
              >
                Download/Print
              </button>


              <button
                onClick={() => {
                  if (!generatedReport) {
                    alert("Generate a report first.");
                    return;
                  }
                  setSendModalOpen(true);
                  setSendSubject(`${generatedReport.type} Report (${generatedReport.from || "—"} to ${generatedReport.to || "—"})`);
                  
                  // Build a clean, readable message body
                  let cleanBody = `Hi,\n\nPlease find the attached ${generatedReport.type} report.\n\n`;
                  cleanBody += `Report Details:\n`;
                  cleanBody += `• Type: ${generatedReport.type}\n`;
                  cleanBody += `• Date Range: ${generatedReport.from || "—"} to ${generatedReport.to || "—"}\n`;
                  cleanBody += `• Generated by: ${managerUser.username}\n`;
                  cleanBody += `• Generated on: ${new Date().toLocaleString()}\n\n`;
                  cleanBody += `Best regards,\n${managerUser.username}`;
                  
                  setSendBody(cleanBody);
                }}
                style={{ padding: "0.45rem 0.6rem", borderRadius: 6, background: "#3b82f6", color: "#fff", border: "none" }}
              >
                Email
              </button>

            </div>
          </div>

              {/* Render report content */}
              <div>
                {generatedReport.type === "Trial Balance" && (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead style={{ background: "#f9fafb" }}>
                      <tr>
                        <th style={{ padding: 8, textAlign: "left" }}>Account</th>
                        <th style={{ padding: 8, textAlign: "right" }}>Debit</th>
                        <th style={{ padding: 8, textAlign: "right" }}>Credit</th>
                      </tr>
                    </thead>

                    <tbody>
                      {(generatedReport.rows || []).map((r) => (
                        <tr key={r.accountId || r.accountName}>
                          <td style={{ padding: 8 }}>{r.accountName}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{formatCurrency(r.debit)}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{formatCurrency(r.credit)}</td>
                        </tr>
                      ))}

                      {/* Totals row */}
                      {(() => {
                        const totalDebit = (generatedReport.rows || []).reduce((s, it) => s + toNumber(it.debit), 0);
                        const totalCredit = (generatedReport.rows || []).reduce((s, it) => s + toNumber(it.credit), 0);
                        return (
                          <tr style={{ borderTop: "2px solid #e5e7eb", fontWeight: 800 }}>
                            <td style={{ padding: 8, textAlign: "left" }}>Total</td>
                            <td style={{ padding: 8, textAlign: "right" }}>{formatCurrency(totalDebit)}</td>
                            <td style={{ padding: 8, textAlign: "right" }}>{formatCurrency(totalCredit)}</td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                )}

                    {generatedReport.type === "Income Statement" && (
                      <div>
                        <h4>Revenue</h4>
                        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
                          <tbody>
                            {(generatedReport.data?.revenues || []).map((r) => (
                              <tr key={r.accountId}>
                                <td style={{ padding: 6 }}>{r.accountName}</td>
                                <td style={{ padding: 6, textAlign: "right" }}>{formatCurrency(r.amount)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td style={{ padding: 6, fontWeight: 700 }}>Total Revenue</td>
                              <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>
                                {formatCurrency(generatedReport.data?.totalRevenue || 0)}
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        <h4>Expenses</h4>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <tbody>
                            {(generatedReport.data?.expenses || []).map((r) => (
                              <tr key={r.accountId}>
                                <td style={{ padding: 6 }}>{r.accountName}</td>
                                <td style={{ padding: 6, textAlign: "right" }}>{formatCurrency(r.amount)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td style={{ padding: 6, fontWeight: 700 }}>Total Expenses</td>
                              <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>
                                {formatCurrency(generatedReport.data?.totalExpenses || 0)}
                              </td>
                            </tr>
                            <tr>
                              <td style={{ padding: 6, fontWeight: 900 }}>Net Income</td>
                              <td style={{ padding: 6, textAlign: "right", fontWeight: 900 }}>
                                {formatCurrency(generatedReport.data?.netIncome || 0)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {generatedReport.type === "Balance Sheet" && (
                      <div style={{ display: "flex", gap: 16 }}>
                        <div style={{ flex: 1 }}>
                          <h4>Assets</h4>
                          {((generatedReport.data?.assetsGroups) || []).length === 0 ? (
                            <div style={{ color: "#6b7280" }}>No asset accounts found.</div>
                          ) : (
                            generatedReport.data.assetsGroups.map((group) => (
                              <div key={group.name} style={{ marginBottom: 12 }}>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>{group.name}</div>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <tbody>
                                    {(group.items || []).map((a) => (
                                      <tr key={a.accountId}>
                                        <td style={{ padding: 6 }}>{a.accountName}</td>
                                        <td style={{ padding: 6, textAlign: "right" }}>{formatCurrency(a.balance)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))
                          )}

                          <div
                            style={{
                              borderTop: "1px solid #e5e7eb",
                              marginTop: 8,
                              paddingTop: 8,
                              display: "flex",
                              justifyContent: "space-between",
                              fontWeight: 800,
                            }}
                          >
                            <div>Total Assets</div>
                            <div>{formatCurrency(generatedReport.data?.assetsTotal || 0)}</div>
                          </div>
                        </div>

                        <div style={{ flex: 1 }}>
                          <h4>Liabilities & Equity</h4>

                          {((generatedReport.data?.liabilitiesGroups) || []).length === 0 ? (
                            <div style={{ color: "#6b7280" }}>No liability accounts found.</div>
                          ) : (
                            generatedReport.data.liabilitiesGroups.map((group) => (
                              <div key={`liab-${group.name}`} style={{ marginBottom: 12 }}>
                                <div style={{ fontWeight: 700, marginBottom: 6 }}>{group.name}</div>
                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                  <tbody>
                                    {(group.items || []).map((a) => (
                                      <tr key={a.accountId}>
                                        <td style={{ padding: 6 }}>{a.accountName}</td>
                                        <td style={{ padding: 6, textAlign: "right" }}>{formatCurrency(a.balance)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))
                          )}

                          {((generatedReport.data?.equityGroups) || []).length > 0 && (
                            <>
                              <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "12px 0" }} />
                              <div style={{ fontWeight: 800, marginBottom: 8 }}>Equity</div>
                              {generatedReport.data.equityGroups.map((group) => (
                                <div key={`eq-${group.name}`} style={{ marginBottom: 12 }}>
                                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{group.name}</div>
                                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <tbody>
                                      {(group.items || []).map((a) => (
                                        <tr key={a.accountId}>
                                          <td style={{ padding: 6 }}>{a.accountName}</td>
                                          <td style={{ padding: 6, textAlign: "right" }}>{formatCurrency(a.balance)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}

                              <div
                                style={{
                                  borderTop: "1px solid #e5e7eb",
                                  marginTop: 8,
                                  paddingTop: 8,
                                  display: "flex",
                                  justifyContent: "space-between",
                                  fontWeight: 800,
                                }}
                              >
                                <div>Total Equity</div>
                                <div>{formatCurrency(generatedReport.data?.equityTotal || 0)}</div>
                              </div>
                            </>
                          )}

                          <div
                            style={{
                              marginTop: 12,
                              borderTop: "2px solid #e5e7eb",
                              paddingTop: 10,
                              display: "flex",
                              justifyContent: "space-between",
                              fontWeight: 900,
                            }}
                          >
                            <div>Total Liabilities & Equity</div>
                            <div>
                              {formatCurrency(
                                generatedReport.data?.liabilitiesAndEquityTotal ||
                                  (generatedReport.data?.liabilitiesTotal || 0) + (generatedReport.data?.equityTotal || 0)
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {generatedReport.type === "Retained Earnings" && (
                      <div>
                        <table style={{ width: "100%" }}>
                          <tbody>
                            <tr>
                              <td style={{ padding: 6 }}>Opening Retained Earnings</td>
                              <td style={{ padding: 6, textAlign: "right" }}>{formatCurrency(generatedReport.data.openingBalance)}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: 6 }}>Net Income (period)</td>
                              <td style={{ padding: 6, textAlign: "right" }}>{formatCurrency(generatedReport.data.netIncome)}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: 6 }}>Dividends</td>
                              <td style={{ padding: 6, textAlign: "right" }}>{formatCurrency(generatedReport.data.dividends)}</td>
                            </tr>
                            <tr>
                              <td style={{ padding: 6, fontWeight: 700 }}>Ending Retained Earnings</td>
                              <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>
                                {formatCurrency(generatedReport.data.endingBalance)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {sendModalOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 2000,
            }}
          >
            <div style={{ width: "640px", background: "#fff", padding: "1rem", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }}>
              <h3 style={{ marginTop: 0 }}>Send Report (in-app)</h3>

              <label style={{ display: "block", marginBottom: 6 }}>To (username)</label>
              <input
                type="text"
                value={sendToUser}
                onChange={(e) => setSendToUser(e.target.value)}
                placeholder="recipient username"
                style={{ width: "100%", padding: "0.5rem", marginBottom: "0.75rem", borderRadius: 6, border: "1px solid #ccc" }}
                list="active-users"
              />
              <datalist id="active-users">
                {users.filter(u => u.active).map(u => <option key={u.id} value={u.username} />)}
              </datalist>

              <label style={{ display: "block", marginBottom: 6 }}>Subject</label>
              <input
                type="text"
                value={sendSubject}
                onChange={(e) => setSendSubject(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", marginBottom: "0.75rem", borderRadius: 6, border: "1px solid #ccc" }}
              />

              <label style={{ display: "block", marginBottom: 6 }}>Message body</label>
              <textarea
                rows={6}
                value={sendBody}
                onChange={(e) => setSendBody(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", marginBottom: "0.75rem", borderRadius: 6, border: "1px solid #ccc" }}
              />

              

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setSendModalOpen(false)}
                  style={{ padding: "0.5rem 0.75rem", borderRadius: 6, background: "#ef4444", color: "white", border: "none" }}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      await handleSendReport({
                        toUsername: sendToUser,
                        subject: sendSubject,
                        body: sendBody,
                        attachPdf: attachPDF,
                        attachCsv: attachCSV,
                        attachJson: attachJSON,
                        timeoutMs: 12000,
                      });
                    } catch (err) {
                      console.error("Send click failed:", err);
                    }
                  }}
                  
                  disabled={sendModalSending}
                  style={{ padding: "0.5rem 0.75rem", borderRadius: 6, background: "#10b981", color: "#fff", border: "none" }}
                  >
                  {sendModalSending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        )}

            {/* Saved reports (visible to managers) */}
            <div style={{ marginTop: "1.25rem" }}>
              <h3 style={{ marginTop: 0 }}>Saved Reports</h3>

              {(!savedReports || savedReports.length === 0) ? (
                <div style={{ color: "#6b7280" }}>No saved reports yet. Click Save after generating a report to store it here.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                  <thead style={{ background: "#f9fafb" }}>
                    <tr>
                      <th style={{ padding: 8, textAlign: "left" }}>Created</th>
                      <th style={{ padding: 8, textAlign: "left" }}>Type</th>
                      <th style={{ padding: 8, textAlign: "left" }}>Range</th>
                      <th style={{ padding: 8, textAlign: "left" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedReports.map((r) => (
                      <tr key={r.id} style={{ borderBottom: "1px solid #eef2f7" }}>
                        <td style={{ padding: 8 }}>
                          {r.createdAt
                            ? 
                              new Date(r.createdAt?.seconds ? r.createdAt.seconds * 1000 : r.createdAt).toLocaleString()
                            : "—"}
                        </td>
                        <td style={{ padding: 8 }}>{r.type || "Report"}</td>
                        <td style={{ padding: 8 }}>{(r.from || "—") + " → " + (r.to || "—")}</td>
                        <td style={{ padding: 8 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <button
                              onClick={() => {
                                loadSavedReport(r);
                                // scroll to the report area so the loaded report is visible
                                setTimeout(() => {
                                  const el = document.getElementById("manager-report-print-area");
                                  if (el && typeof el.scrollIntoView === "function") {
                                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                                  }
                                }, 80);
                              }}
                              style={{ padding: "6px 8px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6 }}
                            >
                              View
                            </button>

                            <button
                              onClick={() => downloadSavedReportJSON(r)}
                              style={{ padding: "6px 8px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6 }}
                            >
                              Download
                            </button>

                            {deleteConfirmId === r.id ? (
                              <>
                                <span style={{ color: "#dc2626", fontWeight: 600, fontSize: "0.85rem" }}>Delete?</span>
                                <button
                                  onClick={async () => {
                                    try {
                                      await deleteDoc(doc(db, "reports", r.id));
                                      setDeleteConfirmId(null);
                                    } catch (err) {
                                      console.error("Delete failed:", err);
                                    }
                                  }}
                                  style={{ padding: "4px 8px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.85rem" }}
                                >
                                  Yes
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmId(null)}
                                  style={{ padding: "4px 8px", background: "#6b7280", color: "#fff", border: "none", borderRadius: 4, fontSize: "0.85rem" }}
                                >
                                  No
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirmId(r.id)}
                                style={{ padding: "6px 8px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 6 }}
                              >
                                Delete
                              </button>
                            )}

                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}


          {/* MESSAGES........................................................................................................................................................................... */} 
          {activeTab === "Messages" && (
            <div style={{ width: "95vw", margin: "0 auto", maxWidth: 1330 }}>
              <h2 style={{ color: "#111827" }}>Messages</h2>

              {/* Tabs */}
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

              {/* INBOX */}
              {activeSubTab === "Inbox" && (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f9fafb" }}>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>From</th>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>Subject</th>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>Message</th>
                      <th style={{ padding: "0.75rem", color: "#111827" }}>Date</th>
                    </tr>
                  </thead>

                  <tbody>
                    {messages
                      .filter((msg) => msg.to === managerUser.username)
                      .map((msg) => (
                        <tr key={msg.id}>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>{msg.from}</td>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>{msg.subject}</td>

                          {/* MESSAGE CARD (matches accountant exactly) */}
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
                            {msg.timestamp
                              ? new Date(msg.timestamp).toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}

              {/* SENT */}
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
                      .filter((msg) => msg.from === managerUser.username)
                      .map((msg) => (
                        <tr key={msg.id}>
                          <td style={{ padding: "0.75rem", color: "#111827" }}>{msg.to}</td>
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
                            {msg.timestamp
                              ? new Date(msg.timestamp).toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}

              {/* COMPOSE MODAL */}
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
                  <div
                    style={{
                      background: "white",
                      padding: "2rem",
                      borderRadius: "8px",
                      width: "520px",
                      boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
                    }}
                  >
                    <h3 style={{ color: "#111827", textAlign: "center" }}>New Message</h3>

                    <label style={{ fontWeight: 600, color: "#111827" }}>To</label>
                    <select
                      value={compose.to}
                      onChange={(e) => setCompose({ ...compose, to: e.target.value })}
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
                        .filter((u) => u.active && u.username !== managerUser.username)
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
                      style={{
                        width: "100%",
                        margin: "0.5rem 0",
                        padding: "0.5rem",
                        border: "1px solid #ccc",
                        borderRadius: "6px",
                      }}
                    />

                    <label style={{ fontWeight: 600, color: "#111827" }}>Message</label>
                    <textarea
                      value={compose.body}
                      onChange={(e) => setCompose({ ...compose, body: e.target.value })}
                      style={{
                        width: "100%",
                        margin: "0.5rem 0",
                        padding: "0.5rem",
                        border: "1px solid #ccc",
                        borderRadius: "6px",
                        minHeight: "120px",
                      }}
                    />

                    {errorMessage && (
                      <p style={{ color: "red", marginTop: "0.5rem" }}>{errorMessage}</p>
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

                          await addDoc(collection(db, "messages"), {
                            from: managerUser.username,
                            to: compose.to,
                            subject: compose.subject,
                            body: compose.body,
                            timestamp: Date.now(),
                          });

                          setCompose({ to: "", subject: "", body: "" });
                          setShowCompose(false);
                          setErrorMessage("");
                        }}
                        style={{
                          background: "#22c55e",
                          color: "white",
                          padding: "0.5rem 1rem",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                          flex: 1,
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
                          flex: 1,
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

        </main>
      </div>
    </div>
  );
}

export default ManagerHome;