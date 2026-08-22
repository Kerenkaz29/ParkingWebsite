# Bar Parking

A small single-page web app for ordering a parking spot. A user checks live availability, fills in their details, and receives a 4-digit confirmation code to use when entering the lot. Parking availability itself is not managed by this website — it's read from Firebase, where a separate Raspberry Pi system (with a camera) is the actual source of truth for how full the lot is.

## How it works (high level)

1. User opens the site and taps **Order Parking**.
2. The site reads `/parking` from the Firebase Realtime Database to check if there's a free spot.
   - If full → shows the "Parking is Full" screen.
   - If not full (or no data yet) → shows the order form.
3. User fills in first name, last name, email, and car number.
4. On submit, the site validates the fields, generates a random 4-digit code, atomically allocates an order number (`orderCounter`), and writes the order to `/orders/orderXXX`.
5. The user sees their confirmation code on screen — this is what they'd use to enter the lot.

The Raspberry Pi (not part of this repo) is responsible for writing `/parking` (occupied/free spot counts) based on camera input, and presumably for validating codes at the gate. **The website only ever reads `/parking`, never writes to it.**

## Files

### [index.html](index.html)
The entire UI, as four "screens" toggled via CSS classes (only one `.screen` has `.active` at a time — see `showScreen()` in `app.js`):
- **`#screen-welcome`** — Landing screen with the "Order Parking" button.
- **`#screen-full`** — Shown when the lot has no free spots.
- **`#screen-order`** — The order form (first name, last name, email, car number).
- **`#screen-code`** — Shown after a successful order, displaying the 4-digit confirmation code.

Also includes a `#loading` overlay (spinner) shown during Firebase reads/writes, and loads the Firebase SDK (`firebase-app-compat.js`, `firebase-database-compat.js`) plus `app.js` at the bottom.

### [app.js](app.js)
All the app's logic. No frameworks — plain DOM manipulation and the Firebase JS SDK.
- **Firebase config & init** — connects to the `smartparkingbar` Firebase Realtime Database project.
- **`showScreen(screenId)`** — swaps which `.screen` div is visible (with a fade-in animation).
- **`showLoading(show)`** — toggles the loading spinner overlay.
- **`goToWelcome()`** — navigates back to the welcome screen (used by several "Back" buttons).
- **`checkParking()`** — reads `/parking` once from Firebase and routes to either the "full" screen or the order form based on `freeSpots`/`isFull`. If `/parking` doesn't exist yet, it defaults to allowing an order (assumes the Pi hasn't written data yet). If the camera-reported numbers still show room, it also checks `/pendingReservations` (see below) so it doesn't send someone to the order form only to be turned away at submit.
- **`countActiveReservations(reservations)`** — counts how many entries in a `/pendingReservations` snapshot haven't expired yet.
- **`reserveSpotIfAvailable()`** — the overselling guard (see below). Atomically reserves a spot via a Firebase `transaction()` on `/pendingReservations`, or reports `'full'` if there's no room. Called from `submitOrder()` before an order is ever written.
- **`submitOrder(event)`** — validates the form fields with regexes (name = letters only, email format, car number = digits/dashes), generates a random 4-digit code, calls `reserveSpotIfAvailable()` to guard against overselling, and — only if that succeeds — uses a Firebase `transaction()` on `orderCounter` to safely get a unique, sequential order number even under concurrent submissions, then writes the order object to `/orders/orderXXX` and shows the confirmation screen.

#### Overselling guard (`/pendingReservations`)
`occupiedSpots` is only updated by the Pi once its camera actually sees a car parked — there's a lag between someone placing an order and the Pi noticing. Without a guard, several people could submit orders in that lag window and all "succeed," even though there's only one real spot left.

To close this gap, the website owns a small Firebase node, `/pendingReservations`, shaped as `{ reservationKey: expiresAtEpochMs }`. Each order submission runs a `transaction()` on this single node — Firebase executes transactions atomically, so concurrent submissions are safely serialized (unlike a plain read-then-write, which is why a live count of `/orders` wouldn't be safe to use for this on its own). The transaction:
1. Prunes any reservation whose `expiresAt` has passed (self-cleaning — no separate cleanup job needed; a no-show frees its spot automatically after `RESERVATION_TTL_MS`, currently 20 minutes).
2. Rejects (aborts, without writing) if `occupiedSpots + activeReservations >= totalSpots`.
3. Otherwise adds a new reservation and commits, reserving the spot.

The guard is skipped only when `occupiedSpots >= totalSpots` already (the existing `isFull`/`freeSpots` check has already rejected the order by then, so there's nothing to gain from also touching `/pendingReservations`) or when `/parking` has no data yet (matches the existing defensive "allow ordering" behavior). In every other case it runs on every order.

This is a client-only mitigation (no backend server), deliberately simple: it doesn't actively remove a reservation the instant a car is detected entering (that would need something listening at all times) — it just relies on the TTL to expire stale/no-show reservations. Good enough for a small lot; a nice-to-have future improvement would be removing a reservation as soon as its order's `enteredAt` gets set.

**Setup note:** `/pendingReservations` is a new path the website now reads and writes. Firebase Realtime Database rules aren't part of this repo — double check your rules permit read/write there, the same way they already do for `/orders` and `/orderCounter`.

### [style.css](style.css)
All styling for the app — dark purple gradient theme, rounded pill-shaped buttons, glowing icons, a gradient text effect for the title and confirmation code, and a simple fade-in animation for screen transitions. Includes a small responsive breakpoint (`max-width: 480px`) for phones.

### [firebase-data.json](firebase-data.json)
A snapshot/example of what the Firebase Realtime Database looks like — **not loaded by the app**, just a reference for the expected data shape:
```jsonc
{
  "parking": {              // written by the Raspberry Pi, read-only from the website
    "isFull": false,
    "totalSpots": 10,
    "occupiedSpots": 6
  },
  "orderCounter": 2,         // incremented atomically each time an order is placed
  "orders": {
    "order001": { ... }      // one entry per order, keyed by "order" + zero-padded number
  },
  "pendingReservations": {   // owned by the website; see "Overselling guard" above
    "r1741166300000_a1b2c3": 1741167500000   // reservationKey -> expiresAt (epoch ms)
  }
}
```

### [.gitattributes](.gitattributes)
Standard Git config — normalizes line endings to LF for text files.

## Data flow summary

| Path | Written by | Read by |
|---|---|---|
| `/parking` | Raspberry Pi (camera-based) | Website (read-only) |
| `/orderCounter` | Website (via transaction) | Website |
| `/orders/orderXXX` | Website | Presumably the Pi/gate system, to validate codes |
| `/pendingReservations` | Website (via transaction) | Website |

## Notes / things to know
- There's no authentication — anyone with the page can place an order.
- The Firebase config (API key, database URL, etc.) is hardcoded in `app.js`. This is normal for Firebase web apps (security is enforced via Firebase Database Rules, not by hiding the key), but it's worth confirming the project's database rules restrict writes appropriately (e.g., only allow writes to `/orders` and `/orderCounter`, never `/parking`, from client apps).
- Confirmation codes are 4 random digits and aren't checked for uniqueness against other open orders — only the order *number* (`orderCounter`) is guaranteed unique.
