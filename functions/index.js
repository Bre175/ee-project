// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sgMail = require("@sendgrid/mail");

// initialize admin SDK (uses default app credentials provided by Firebase Functions)
admin.initializeApp();

// config: set via `firebase functions:config:set sendgrid.key="..." sendgrid.from="..."`
const SENDGRID_KEY = functions.config()?.sendgrid?.key;
const SENDGRID_FROM = functions.config()?.sendgrid?.from || "no-reply@example.com";

if (SENDGRID_KEY) {
  sgMail.setApiKey(SENDGRID_KEY);
} else {
  console.warn("SendGrid key not found in functions config. Set it with `firebase functions:config:set sendgrid.key=\"YOUR_KEY\" sendgrid.from=\"from@example.com\"`");
}

// Notify managers when a new JE is created with status "Pending"
exports.notifyManagersOnNewJE = functions.firestore
  .document("journalEntries/{jeId}")
  .onCreate(async (snap, context) => {
    try {
      const je = snap.data() || {};
      const status = (je.status || "").toString().toLowerCase();
      if (status !== "pending") {
        console.log("JE created but not pending, skipping notification:", context.params.jeId);
        return null;
      }

      // Build small summary
      const jeId = context.params.jeId;
      const date = je.date || new Date().toISOString();
      const memo = je.memo || "";
      const submittedBy = je.submittedBy || je.createdBy || "—";
      // Try to compute amount (if stored)
      let amount = je.amount ?? je.totalAmount ?? null;
      if (!amount && Array.isArray(je.debits)) {
        amount = je.debits.reduce((s, d) => s + (Number(d.amount) || 0), 0);
      }
      if (!amount && Array.isArray(je.credits)) {
        const csum = je.credits.reduce((s, c) => s + (Number(c.amount) || 0), 0);
        amount = amount ?? csum;
      }

      // Query active managers
      const usersRef = admin.firestore().collection("users");
      const q = usersRef.where("role", "==", "Manager").where("active", "==", true);
      const snapManagers = await q.get();

      if (snapManagers.empty) {
        console.log("No active managers found.");
        return null;
      }

      // Build message (text + html)
      const subject = `Journal Entry needs approval — ${jeId}`;
      const textBody = [
        `A journal entry requires approval/rejection.`,
        ``,
        `ID: ${jeId}`,
        `Date: ${date}`,
        `Submitted By: ${submittedBy}`,
        `Amount: ${amount !== null ? amount : "See entry"}`,
        `Memo: ${memo}`,
        ``,
        `Open the Manager interface to review and approve/reject the JE.`
      ].join("\n");

      const htmlBody = `<p>A journal entry requires approval/rejection.</p>
        <ul>
          <li><strong>ID:</strong> ${jeId}</li>
          <li><strong>Date:</strong> ${date}</li>
          <li><strong>Submitted By:</strong> ${submittedBy}</li>
          <li><strong>Amount:</strong> ${amount !== null ? amount : "See entry"}</li>
          <li><strong>Memo:</strong> ${memo}</li>
        </ul>
        <p>Open the Manager interface to review and approve/reject the JE.</p>`;

      // Send to each manager that has an email
      const sendPromises = [];
      snapManagers.forEach((mgrDoc) => {
        const mgr = mgrDoc.data() || {};
        if (!mgr.email) {
          console.log("Skipping manager with no email:", mgrDoc.id);
          return;
        }
        const msg = {
          to: mgr.email,
          from: SENDGRID_FROM,
          subject,
          text: textBody,
          html: htmlBody,
        };
        if (!SENDGRID_KEY) {
          // When key not set, log instead of sending
          console.log("Would send email to:", mgr.email, "MSG:", msg);
          return;
        }
        sendPromises.push(
          sgMail.send(msg)
            .then(() => console.log("Email sent to", mgr.email, "for JE", jeId))
            .catch((err) => console.error("SendGrid error for", mgr.email, ":", err?.toString?.() || err))
        );
      });

      await Promise.all(sendPromises);
      return null;
    } catch (err) {
      console.error("notifyManagersOnNewJE error:", err);
      return null;
    }
  });