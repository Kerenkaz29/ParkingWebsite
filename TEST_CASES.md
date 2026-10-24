| # | Case | Description (setup) | Accept criteria | Reject criteria |
|---|---|---|---|---|
| 1 | Lot full | `totalSpots = 6`, `occupiedSpots = 6`, 1 person orders | — | 1 rejected ("Parking is Full") |
| 2 | Single order | `totalSpots = 6`, `occupiedSpots = 3`, 1 person orders | 1 approved, gets a code | — |
| 3 | Race 2 vs 1 | `totalSpots = 6`, `occupiedSpots = 5` (1 free), 2 people order in the same second | 1 approved | 1 rejected |
| 4 | Race 3 vs 2 | `totalSpots = 6`, `occupiedSpots = 4` (2 free), 3 people order in the same second | 2 approved | 1 rejected |
| 5 | Race fits exactly | `totalSpots = 6`, `occupiedSpots = 4` (2 free), 2 people order in the same second | 2 approved | — |
| 6 | Sequential orders | `totalSpots = 6`, `occupiedSpots = 5` (1 free), person A orders, then person B orders after A is confirmed | A approved | B rejected |
| 7 | Reservations hold spots | `totalSpots = 6`, `occupiedSpots = 4`. A and B ordered earlier and were approved (still driving over). Then C orders | A and B stay approved | C rejected (`4 + 2 = 6`) |
| 8 | Reservation expires | `totalSpots = 6`, `occupiedSpots = 5`. A ordered more than 2.5 min ago and never arrived. B orders now | B approved (A's reservation expired) | — |
| 9 | Reservation still active | `totalSpots = 6`, `occupiedSpots = 5`. A ordered less than 2.5 min ago and hasn't arrived yet. B orders now | A stays approved | B rejected (`5 + 1 = 6`, the free spot is still held for A) |
