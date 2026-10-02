Jimitri Demon List
A self-hosted demon list for Jimitri Dash: main/extended level lists, records,
verifications, a leaderboard, and an admin panel. Static files + Firebase
(Authentication + Firestore) for shared, secured data.
1. Create a Firebase project (free)
Go to https://console.firebase.google.com → Add project.
Build → Firestore Database → Create database → any region → production mode.
Build → Authentication → Get started → Sign-in method → Email/Password → Enable.
(Yes, "Email/Password" — the site still only asks people for a username, see
below for why.)
Gear icon → Project settings → General → Your apps → </> (add a web app)
→ copy the `firebaseConfig` object it gives you.
2. Configure this repo
Paste your real values into `firebase-config.js`, replacing the `"PASTE_ME"`s.
Firebase console → Firestore Database → Rules → paste in the contents
of `firestore.rules` from this repo → Publish.
3. Put it on GitHub Pages
Push all files (including the `scripts/` folder, minus any key file — see
below) to a GitHub repo.
Settings → Pages → set Source to your branch/root → save.
Your live URL appears on that same page, something like
`https://yourname.github.io/repo-name/`.
To update later: edit, push, Pages rebuilds automatically.
4. Become admin (do this once, right after your first deploy)
Accounts now use Firebase's real authentication — secure, but it means
nobody, including you, is automatically admin anymore. Here's how to grant it:
Sign up on your live site like anyone else, with whatever username you want.
Open Firestore Database → Data → `users` collection in the Firebase
console. Find your account; the document ID shown is your uid. Copy it.
On your own computer (not the browser console — this step needs a real
secret key that must never touch the website):
Install Node.js if you don't have it.
Firebase console → gear icon → Project settings → Service accounts
→ Generate new private key → save the file as
`scripts/serviceAccountKey.json` in this repo.
Open a terminal in the `scripts/` folder and run `npm install firebase-admin`.
Run: `node set-role.js <your-uid> admin`
Log out and back in on the site. You're now admin, with the Admin Panel
button showing.
Never commit `serviceAccountKey.json` to GitHub — the included
`scripts/.gitignore` already excludes it, but double check before pushing.
Use the same script to promote a mod (`node set-role.js <uid> mod`) or remove
someone's staff access (`node set-role.js <uid> none`). Banning and unbanning,
by contrast, can be done right from the Admin Panel on the site, since the
security rules let a verified admin do that safely without the script.
What changed, and why (for anyone reading this after the September 2026 raid)
The original version stored a username/password pair in Firestore and checked
them in the browser. The Firestore rules only checked "is this request signed
in," with no way to tell a legitimate request from someone calling the
Firestore SDK directly from the browser console — so anyone could write
themselves into the `admin` role, or flood the `records`/`verifications`
collections, without ever creating an account the normal way.
This version fixes that at the root:
Passwords are handled entirely by Firebase, not by this app's own code.
Nothing password-related is ever stored in Firestore.
Admin/mod status lives in a signed token (a "custom claim"), which only a
script running on a trusted computer with a private service-account key can
set — never the browser, never the website's own code, and never anyone
who only has access to the live site or its database viewer.
Firestore's security rules enforce all of this server-side. A record or
verification can only ever be created by the signed-in user it claims to be
from, always starts as "pending," and only a real staff/admin token can
approve, reject, or edit it. A user's own `role`/`banned` fields can't be
changed by that user, or by anyone without a verified admin token.
This is the kind of security a normal web app would just expect from its
backend — it's doable here specifically because Firestore's rules run on
Google's servers, not in anyone's browser, so they can't be read or bypassed
the way the old app's client-side checks could.
Files
`index.html`, `style.css` — page structure and styling
`app.js` — app logic (auth, Firestore reads/writes, rendering)
`firebase-config.js` — your Firebase project keys (fill this in)
`firestore.rules` — paste into the Firebase console's Rules tab
`scripts/set-role.js` — local, one-time tool to grant/revoke admin or mod
