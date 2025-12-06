import React from "react";
import { Link } from "react-router-dom";

function SubmitSuccess() {
  return (
    <div style={{ maxWidth: "400px", margin: "50px auto", textAlign: "center" }}>
      <h2>Success!</h2>
      <p>Your action was completed successfully.</p>
      <Link to="/">Back to Login</Link>
    </div>
  );
}

export default SubmitSuccess;