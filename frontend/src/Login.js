import React from "react";
import { auth } from "./firebase";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import Button from "@mui/material/Button";

function Login() {
  const navigate = useNavigate();
  const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      navigate("/dashboard");
    } catch (error) {
      alert("Login failed: " + error.message);
    }
  };
  return (
    <div style={{ textAlign: "center", marginTop: "100px" }}>
      <h2>PrepMind - AI Interview Preparation</h2>
      <Button variant="contained" onClick={handleGoogleSignIn}>
        Sign in with Google
      </Button>
    </div>
  );
}
export default Login;
