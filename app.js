// =============================================
// Firebase Configuration
// =============================================
// TODO: Replace with YOUR Firebase project config
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "000000000000",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// =============================================
// Screen Navigation
// =============================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    target.classList.remove('active');
    // Force reflow to restart animation
    void target.offsetWidth;
    target.classList.add('active');
}

function showLoading(show) {
    document.getElementById('loading').classList.toggle('active', show);
}

function goToWelcome() {
    showScreen('screen-welcome');
}

// =============================================
// Check Parking Availability
// =============================================
function checkParking() {
    showLoading(true);

    db.ref('parking').once('value')
        .then(snapshot => {
            const data = snapshot.val();
            showLoading(false);

            if (data && data.isFull) {
                showScreen('screen-full');
            } else {
                showScreen('screen-order');
            }
        })
        .catch(error => {
            console.error('Firebase read error:', error);
            showLoading(false);
            alert('Error connecting to database. Please try again.');
        });
}

// =============================================
// Submit Order
// =============================================
function submitOrder(event) {
    event.preventDefault();

    const firstname = document.getElementById('firstname').value.trim();
    const lastname = document.getElementById('lastname').value.trim();
    const email = document.getElementById('email').value.trim();

    if (!firstname || !lastname || !email) return;

    showLoading(true);

    // Generate random 4-digit code
    const code = String(Math.floor(1000 + Math.random() * 9000));

    // Save order to Firebase
    const orderData = {
        firstName: firstname,
        lastName: lastname,
        email: email,
        code: code,
        orderedAt: new Date().toISOString(),
        enteredAt: null
    };

    db.ref('orders').push(orderData)
        .then(() => {
            showLoading(false);
            document.getElementById('confirmation-code').textContent = code;
            showScreen('screen-code');

            // Reset form
            document.getElementById('order-form').reset();
        })
        .catch(error => {
            console.error('Firebase write error:', error);
            showLoading(false);
            alert('Error saving order. Please try again.');
        });
}
