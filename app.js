// =============================================
// Firebase Configuration
// =============================================
const firebaseConfig = {
    apiKey: "AIzaSyDjv1iwEcdqv4w6mQgZQ6r5SgO-hiiSgL8",
    authDomain: "smartparkingbar.firebaseapp.com",
    databaseURL: "https://smartparkingbar-default-rtdb.firebaseio.com",
    projectId: "smartparkingbar",
    storageBucket: "smartparkingbar.firebasestorage.app",
    messagingSenderId: "1090333673423",
    appId: "1:1090333673423:web:fb6298832910e35aceb4ba",
    measurementId: "G-G2984SM7TJ"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// NOTE: parking status (occupiedSpots, freeSpots, isFull) is owned by the
// Raspberry Pi. The Pi sees the physical lot via the camera and is the
// single source of truth. The website only READS those values -- it must
// never write to /parking, otherwise it will overwrite the Pi's data.

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

            // Defensive check: if /parking has not been written yet,
            // allow ordering (the Pi will populate it shortly).
            if (!data) {
                showScreen('screen-order');
                return;
            }

            const freeSpots = typeof data.freeSpots === 'number' ? data.freeSpots : null;
            const isFull = data.isFull === true;

            // Prefer freeSpots when available -- it's the most direct value.
            if (freeSpots !== null) {
                if (freeSpots <= 0) {
                    showScreen('screen-full');
                } else {
                    showScreen('screen-order');
                }
            } else if (isFull) {
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
    const carnumber = document.getElementById('carnumber').value.trim();

    // Validation
    if (!firstname) { alert('Please enter your first name.'); return; }
    if (!/^[a-zA-Z\s]{2,}$/.test(firstname)) { alert('First name must contain only letters (at least 2 characters).'); return; }
    if (!lastname) { alert('Please enter your last name.'); return; }
    if (!/^[a-zA-Z\s]{2,}$/.test(lastname)) { alert('Last name must contain only letters (at least 2 characters).'); return; }
    if (!email) { alert('Please enter your email.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Please enter a valid email address.'); return; }
    if (!carnumber) { alert('Please enter your car number.'); return; }
    if (!/^[0-9\-]{5,10}$/.test(carnumber)) { alert('Car number must contain only digits and dashes (5-10 characters).'); return; }

    showLoading(true);

    const code = String(Math.floor(1000 + Math.random() * 9000));

    const orderData = {
        firstName: firstname,
        lastName: lastname,
        email: email,
        carNumber: carnumber,
        code: code,
        orderedAt: new Date().toISOString(),
        enteredAt: null
    };

    // Atomically increment orderCounter and use the new value as the
    // order ID. transaction() guarantees that even if two users press
    // "Confirm Order" at the same time, each gets a unique number.
    db.ref('orderCounter').transaction(current => {
        return (current || 0) + 1;
    })
    .then(result => {
        if (!result.committed) {
            throw new Error('Could not allocate order number');
        }
        const newNumber = result.snapshot.val();
        const orderId = 'order' + String(newNumber).padStart(3, '0');

        return db.ref('orders/' + orderId).set(orderData)
            .then(() => orderId);
    })
    .then(orderId => {
        showLoading(false);
        document.getElementById('confirmation-code').textContent = code;
        showScreen('screen-code');
        document.getElementById('order-form').reset();
        console.log('Order saved as:', orderId);
    })
    .catch(error => {
        console.error('Firebase write error:', error);
        showLoading(false);
        alert('Error saving order. Please try again.');
    });
}