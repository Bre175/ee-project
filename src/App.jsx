import React from "react";
import { Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import ForgotPassword from "./pages/ForgotPassword";
import AdminHome from "./pages/AdminHome";
import ManagerHome from "./pages/ManagerHome"; 
import AccountantHome from "./pages/AccountantHome"; 
import EventLogPage from "./pages/EventLogPage";
import HelpPage from "./pages/HelpPage"; 
import LedgerPage from "./pages/LedgerPage";  

function App() {
  return (
    <Routes>
      {/* Default Accountant login */}
      <Route path="/" element={<Login role="Accountant" />} />

      {/* Dynamic login by role */}
      <Route path="/login/:role" element={<Login />} />

      {/* Signup */}
      <Route path="/signup" element={<Signup />} />

      {/* Dashboard */}
      <Route path="/dashboard" element={<Dashboard />} />

      {/* Forgot password */}
      <Route path="/forgot-password" element={<ForgotPassword />} />

      {/* Admin homepage */}
      <Route path="/admin-home" element={<AdminHome />} />

      {/* Manager homepage */}
      <Route path="/manager-home" element={<ManagerHome />} />

      {/* Accountant homepage */}
      <Route path="/accountant-home" element={<AccountantHome />} />

      {/* Admin Event Logs Page */}
      <Route path="/event-logs" element={<EventLogPage />} />

      {/* Help Page */}
      <Route path="/help" element={<HelpPage />} /> 

      {/* Ledger Page */}
      <Route path="/ledger/:accountId" element={<LedgerPage />} />

    </Routes>
  );
}

export default App;