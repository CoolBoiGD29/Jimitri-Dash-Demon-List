// One-time local tool. Run this on YOUR computer, never in the browser console —
// it uses a secret service account key that must never be shared or committed to GitHub.
//
// Setup (first time only):
//   1. npm install firebase-admin   (run inside this scripts/ folder)
//   2. Firebase console -> gear icon -> Project settings -> Service accounts
//      -> "Generate new private key" -> save the downloaded file right here as
//      serviceAccountKey.json
//   3. Add serviceAccountKey.json to your repo's .gitignore so it never gets pushed.
//
// Usage:
//   node set-role.js <uid> admin   -> full admin (staff + ban/promote/etc.)
//   node set-role.js <uid> mod     -> staff only (approve/reject, manage levels)
//   node set-role.js <uid> none    -> remove both, back to a normal user
//
// Find a user's uid in the Firebase console -> Firestore Database -> Data -> the
// "users" collection: the document ID shown for each user IS their uid.

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

const [, , uid, role] = process.argv;
if (!uid || !['admin', 'mod', 'none'].includes(role)) {
  console.log('Usage: node set-role.js <uid> <admin|mod|none>');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const claims = role === 'admin' ? { admin: true, staff: true }
             : role === 'mod'   ? { admin: false, staff: true }
             : { admin: false, staff: false };
const displayRole = role === 'none' ? 'user' : role;

(async () => {
  try {
    await admin.auth().setCustomUserClaims(uid, claims);
    // Also update the Firestore "role" field so the site's badges/leaderboard
    // display the same thing — this write uses the Admin SDK, which bypasses
    // the security rules, so it's safe even though the rules block clients
    // from setting this themselves.
    await admin.firestore().collection('users').doc(uid).set({ role: displayRole }, { merge: true });
    console.log('Done. ' + uid + ' is now: ' + role);
    console.log('That person must log out and log back in on the site for it to take effect.');
    process.exit(0);
  } catch (err) { console.error('Failed:', err.message); process.exit(1); }
})();
