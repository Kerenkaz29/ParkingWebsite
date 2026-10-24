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
- **`checkParking()`** — reads `/parking` once from Firebase and routes to either the "full" screen or the order form based on `freeSpots`/`isFull`. If `/parking` doesn't exist yet, it defaults to allowing an order (assumes the Pi hasn't written data yet).
- **`submitOrder(event)`** — validates the form fields with regexes (name = letters only, email format, car number = digits/dashes), generates a random 4-digit code, uses a Firebase `transaction()` on `orderCounter` to safely get a unique, sequential order number even under concurrent submissions, then writes the order object to `/orders/orderXXX` and shows the confirmation screen.

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

## Notes / things to know
- There's no authentication — anyone with the page can place an order.
- The Firebase config (API key, database URL, etc.) is hardcoded in `app.js`. This is normal for Firebase web apps (security is enforced via Firebase Database Rules, not by hiding the key), but it's worth confirming the project's database rules restrict writes appropriately (e.g., only allow writes to `/orders` and `/orderCounter`, never `/parking`, from client apps).
- Confirmation codes are 4 random digits and aren't checked for uniqueness against other open orders — only the order *number* (`orderCounter`) is guaranteed unique.
