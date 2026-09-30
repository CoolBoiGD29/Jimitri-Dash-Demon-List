# Jimitri Demon List

A self-hosted demon list for Jimitri Dash: main/extended level lists, records,
verifications, a leaderboard, and an admin panel. Static files + Firebase
Firestore for shared data (accounts, levels, records, verifications).

## 1. Create a Firebase project (free)

1. Go to https://console.firebase.google.com → **Add project** → give it any
   name → you can skip Google Analytics.
2. In the left sidebar: **Build → Firestore Database → Create database**.
   Pick any region close to you, start in **production mode**.
3. In the left sidebar: **Build → Authentication → Get started → Sign-in
   method → Anonymous → Enable**. (The site uses its own username/password
   system for accounts; anonymous auth is only used behind the scenes so the
   database can tell "someone using the site" apart from a random script.)
4. Click the gear icon → **Project settings → General**, scroll to
   **Your apps**, click the **</>** (web) icon, register an app (no need for
   Firebase Hosting), and copy the `firebaseConfig` object it shows you.

## 2. Configure this repo

1. Open `firebase-config.js` and paste your real values in place of the
   `"PASTE_ME"` placeholders.
2. In the Firebase console, go to **Firestore Database → Rules**, replace
   the contents with what's in `firestore.rules` in this repo, and click
   **Publish**.

## 3. Put it on GitHub Pages

1. Push all the files in this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages**, set **Source** to your default
   branch and root folder, save.
3. GitHub gives you a URL (something like
   `https://yourname.github.io/repo-name/`) — that's your live site.
4. To update it later, just edit the files and push — Pages rebuilds
   automatically.

## How admin works

The **first account anyone signs up with becomes admin automatically.** Sign
up as yourself first, before sharing the link, so it's you. From the Admin
Panel you can approve/reject records and verifications, ban/unban users,
promote/demote mods, and remove levels from a level's page.

## Security — please read

- **Passwords** are hashed (SHA-256 + a random salt) before being stored, not
  stored as plain text, but this is still a client-side app with no real
  server. Anyone reasonably technical could read the Firestore database
  directly or tamper with requests. Don't reuse an important password here.
- **The Firestore rules in this repo only require "signed in anonymously,"
  not "is this specific admin."** That check happens in `app.js`, in the
  browser — which anyone can open and edit. A motivated person could grant
  themselves admin, forge approved records, or edit the leaderboard directly
  in the database. This is fine for a casual list among friends; it is not
  safe for anything where money, real prizes, or serious reputation are on
  the line.
- If you ever want this properly locked down, the fix is moving the
  password check and admin actions to a real backend (e.g. Firebase Cloud
  Functions) instead of trusting the browser — happy to help with that later
  if it matters to you.

## Files

- `index.html` — page structure
- `style.css` — all styling
- `app.js` — app logic (Firestore reads/writes, auth, rendering)
- `firebase-config.js` — your Firebase project keys (fill this in)
- `firestore.rules` — paste into the Firebase console's Rules tab
