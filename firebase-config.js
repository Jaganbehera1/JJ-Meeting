// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAgZCtcnltf6um5felvWP3r_L1rJt3dEgQ",
    authDomain: "online-classes-83846.firebaseapp.com",
    databaseURL: "https://online-classes-83846-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "online-classes-83846",
    storageBucket: "online-classes-83846.firebasestorage.app",
    messagingSenderId: "187976015161",
    appId: "1:187976015161:web:9b44253a575b011e835ce8",
    measurementId: "G-8600VC5E8Q"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();