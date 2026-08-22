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

// An order counts as "currently occupying a spot" from the moment it's
// placed until either the Pi/gate sets enteredAt, or this TTL elapses and
// it's treated as a no-show. This bounds /pendingReservations so it never
// needs a separate cleanup job -- expired entries are pruned lazily the
// next time the transaction below runs.
const RESERVATION_TTL_MS = 20 * 60 * 1000; // 20 minutes

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

            // Defensive check: if /parking has not been written yet,
            // allow ordering (the Pi will populate it shortly).
            if (!data) {
                showLoading(false);
                showScreen('screen-order');
                return;
            }

            const freeSpots = typeof data.freeSpots === 'number' ? data.freeSpots : null;
            const isFull = data.isFull === true;

            // Prefer freeSpots when available -- it's the most direct value.
            const officiallyFull = freeSpots !== null ? freeSpots <= 0 : isFull;

            if (officiallyFull) {
                showLoading(false);
                showScreen('screen-full');
                return;
            }

            // The camera says there's room, but orders placed moments ago
            // (not yet reflected in occupiedSpots) could already have used
            // it up. Check /pendingReservations too so we don't route
            // someone to the order form only to turn them away at submit.
            const totalSpots = typeof data.totalSpots === 'number' ? data.totalSpots : null;
            const occupiedSpots = typeof data.occupiedSpots === 'number' ? data.occupiedSpots : null;

            if (totalSpots === null || occupiedSpots === null) {
                showLoading(false);
                showScreen('screen-order');
                return;
            }

            db.ref('pendingReservations').once('value')
                .then(reservationsSnapshot => {
                    showLoading(false);
                    const activeCount = countActiveReservations(reservationsSnapshot.val());
                    if (occupiedSpots + activeCount >= totalSpots) {
                        showScreen('screen-full');
                    } else {
                        showScreen('screen-order');
                    }
                })
                .catch(error => {
                    console.error('Firebase read error:', error);
                    showLoading(false);
                    // Reservations are just a race guard; if we can't read
                    // them, fall back to the camera's own numbers.
                    showScreen('screen-order');
                });
        })
        .catch(error => {
            console.error('Firebase read error:', error);
            showLoading(false);
            alert('Error connecting to database. Please try again.');
        });
}

// Counts /pendingReservations entries that haven't expired yet.
function countActiveReservations(reservations) {
    if (!reservations) return 0;
    const now = Date.now();
    let count = 0;
    for (const key in reservations) {
        if (reservations[key] > now) count++;
    }
    return count;
}

// =============================================
// Concurrency Guard: reserve a spot atomically
// =============================================
// Prevents overselling when several people submit orders around the same
// time. /pendingReservations is a small, website-owned map of
// { reservationKey: expiresAtEpochMs }. Firebase's transaction() reads,
// mutates, and writes this ONE node atomically (the server serializes
// concurrent transactions on the same path), which is what actually closes
// the race -- a live count query over /orders could not be made atomic
// with the write that follows it.
//
// Resolves 'ok' if a spot was reserved (or there was nothing to guard
// against), or 'full' if capacity is used up.
function reserveSpotIfAvailable() {
    return db.ref('parking').once('value').then(snapshot => {
        const data = snapshot.val();

        // No data yet from the Pi -- match today's defensive behavior and
        // allow the order through.
        if (!data) return 'ok';

        const totalSpots = typeof data.totalSpots === 'number' ? data.totalSpots : null;
        const occupiedSpots = typeof data.occupiedSpots === 'number' ? data.occupiedSpots : null;

        if (totalSpots === null || occupiedSpots === null) return 'ok';

        // The camera itself already says there's no room -- reject
        // directly, no point also touching /pendingReservations.
        if (occupiedSpots >= totalSpots) return 'full';

        const reservationKey = 'r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

        return db.ref('pendingReservations').transaction(current => {
            const now = Date.now();
            const active = {};

            // Prune expired reservations (no-shows / stale entries) --
            // this is what keeps the node self-cleaning. We always write
            // the pruned map back (even when rejecting below) so garbage
            // doesn't pile up during a sustained full period.
            for (const key in current || {}) {
                if (current[key] > now) active[key] = current[key];
            }

            const activeCount = Object.keys(active).length;
            if (occupiedSpots + activeCount < totalSpots) {
                active[reservationKey] = now + RESERVATION_TTL_MS;
            }
            return active;
        }).then(result => {
            // Whether we got the spot is whether our key made it into the
            // committed data -- not just whether the transaction committed
            // (it always commits now, to keep pruning working).
            const committed = result.snapshot.val() || {};
            return committed[reservationKey] ? 'ok' : 'full';
        });
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

    // Guard against overselling: reserve a spot before allocating an order
    // number. If capacity is already used up (by occupiedSpots and/or
    // other pending orders), bail out here instead of writing an order
    // that has no real spot behind it.
    reserveSpotIfAvailable()
    .then(result => {
        if (result === 'full') {
            showLoading(false);
            showScreen('screen-full');
            return null;
        }

        // Atomically increment orderCounter and use the new value as the
        // order ID. transaction() guarantees that even if two users press
        // "Confirm Order" at the same time, each gets a unique number.
        return db.ref('orderCounter').transaction(current => {
            return (current || 0) + 1;
        })
        .then(counterResult => {
            if (!counterResult.committed) {
                throw new Error('Could not allocate order number');
            }
            const newNumber = counterResult.snapshot.val();
            const orderId = 'order' + String(newNumber).padStart(3, '0');

            return db.ref('orders/' + orderId).set(orderData)
                .then(() => orderId);
        });
    })
    .then(orderId => {
        if (orderId === null) return; // guard already handled the "full" case above
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