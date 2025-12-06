// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";
import { getStorage } from "firebase/storage";   

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBvB0rwboygTMQJjt70tdVenf43Ge-Lq44",
  authDomain: "ee-project-ce533.firebaseapp.com",
  projectId: "ee-project-ce533",
  storageBucket: "ee-project-ce533.firebasestorage.app",
  messagingSenderId: "966037569713",
  appId: "1:527430695533:web:5fbcd76aac66fc820b1d64",
  measurementId: "G-B0HJ9VHGVB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Export Firebase services to use elsewhere
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);          