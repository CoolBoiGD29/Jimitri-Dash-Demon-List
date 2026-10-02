import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, getDoc,
  getDocs, query, where, addDoc, onSnapshot, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = getFirestore(app);
// Real usernames don't satisfy Firebase's "must be an email" requirement, so we
// build a fake, never-contacted address from the username behind the scenes.
// Users only ever see/type their username — this is invisible to them.
const FAKE_DOMAIN = '@jimitridemonlist.invalid';
const toEmail = u => u.trim().toLowerCase() + FAKE_DOMAIN;

/* ---------- state ---------- */
let STATE = { users: {}, levels: [], records: [], verifications: [] }; // STATE.users is keyed by uid
let ready = false;
const $ = id => document.getElementById(id);
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3000); }

/* ---------- points ---------- */
function pointsFor(position) { return Math.round(250 - (position - 1) * (245 / 149)); }
function levelById(id) { return STATE.levels.find(l => l.id === id); }
function userPoints(uid) {
  const byLevel = {};
  for (const r of STATE.records) {
    if (r.status !== 'approved' || r.uid !== uid) continue;
    const lvl = levelById(r.level); if (!lvl) continue;
    const pct = Math.max(0, Math.min(100, r.percent));
    const pts = Math.round(lvl.points * pct / 100);
    if (!byLevel[r.level] || byLevel[r.level] < pts) byLevel[r.level] = pts;
  }
  return Object.values(byLevel).reduce((a, b) => a + b, 0);
}

/* ---------- Firestore live sync ---------- */
function watchCollection(name) {
  onSnapshot(collection(fs, name), snap => {
    if (name === 'users') {
      const obj = {}; snap.forEach(d => obj[d.id] = { uid: d.id, ...d.data() }); STATE.users = obj;
    } else {
      const arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() })); STATE[name] = arr;
    }
    if (ready) render();
  }, err => toast('Sync error (' + name + '): ' + err.message));
}

let CLAIMS = { admin: false, staff: false }; // from the signed Firebase ID token — this is what Firestore rules actually trust
async function boot() {
  watchCollection('users');
  watchCollection('levels');
  watchCollection('records');
  watchCollection('verifications');
  onAuthStateChanged(auth, async user => {
    if (user) { const t = await user.getIdTokenResult(); CLAIMS = { admin: !!t.claims.admin, staff: !!t.claims.staff }; }
    else CLAIMS = { admin: false, staff: false };
    if (ready) render();
  });
  ready = true;
  render();
}

/* ---------- auth ----------
   isStaff()/isAdmin() check the REAL server-verified token claims (CLAIMS), set only by
   scripts/set-role.js. The Firestore "role" field on a user doc is just a display label
   kept in sync by that script — permissions never come from that field. */
function currentUser() { const u = auth.currentUser; return u ? STATE.users[u.uid] : null; }
function isStaff() { return !!auth.currentUser && CLAIMS.staff; }
function isAdmin() { return !!auth.currentUser && CLAIMS.admin; }

async function usernameTaken(username) {
  const q = query(collection(fs, 'users'), where('username', '==', username));
  const snap = await getDocs(q);
  return !snap.empty;
}

async function signup(username, pass) {
  username = username.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return 'Username must be 3-20 characters: letters, numbers, underscore only.';
  if (pass.length < 6) return 'Password must be at least 6 characters.';
  if (await usernameTaken(username)) return 'That username is taken.';
  let cred;
  try { cred = await createUserWithEmailAndPassword(auth, toEmail(username), pass); }
  catch (e) { return friendlyAuthError(e); }
  const isFirst = Object.keys(STATE.users).length === 0;
  try {
    await setDoc(doc(fs, 'users', cred.user.uid), { username, role: 'user', banned: false, created: serverTimestamp() });
  } catch (e) { return 'Account created but profile setup failed: ' + e.message; }
  if (isFirst) toast('Account created! You are the first user — ask an operator to grant you admin via scripts/set-role.js, then log out and back in.');
  else toast('Account created!');
  return null;
}
async function login(username, pass) {
  try { await signInWithEmailAndPassword(auth, toEmail(username.trim()), pass); return null; }
  catch (e) { return friendlyAuthError(e); }
}
function friendlyAuthError(e) {
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(e.code)) return 'Wrong username or password.';
  if (e.code === 'auth/email-already-in-use') return 'That username is taken.';
  if (e.code === 'auth/too-many-requests') return 'Too many attempts — wait a bit and try again.';
  return e.message;
}
function logout() { signOut(auth); }

/* ---------- rendering ---------- */
let curList = 'main';
function render() {
  renderAuth(); renderGrid();
  $('btnAdmin').style.display = isStaff() ? 'inline-block' : 'none';
}
function renderAuth() {
  const el = $('authArea'); const u = currentUser();
  if (!auth.currentUser || !u) { el.innerHTML = '<button id="btnLogin">Sign up / Log in</button>'; $('btnLogin').onclick = openAuth; return; }
  const roleClass = u.role === 'admin' ? 'role-admin' : (u.role === 'mod' ? 'role-mod' : '');
  el.innerHTML = `<div class="userpill"><b class="${roleClass}">${esc(u.username)}</b><span style="color:var(--sub)">${userPoints(u.uid)} pts</span></div><button class="ghost small" id="btnLogout">Log out</button>`;
  $('btnLogout').onclick = logout;
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderGrid() {
  const grid = $('grid');
  const main = STATE.levels.filter(l => l.position <= 75).sort((a, b) => a.position - b.position);
  const ext = STATE.levels.filter(l => l.position > 75).sort((a, b) => a.position - b.position);
  const list = curList === 'main' ? main : ext;
  $('tabMain').classList.toggle('active', curList === 'main');
  $('tabExt').classList.toggle('active', curList === 'ext');
  if (!list.length) { grid.innerHTML = '<div class="empty">No levels here yet. Approve a verification in the Admin Panel to add one.</div>'; return; }
  grid.innerHTML = '';
  for (const l of list) {
    const d = document.createElement('div');
    d.className = 'lvl ' + (l.position <= 75 ? 'main' : 'ext');
    d.innerHTML = `<div class="ic">#${l.position}</div><small>${esc(l.name)}</small>`;
    d.onclick = () => openLevel(l.id);
    grid.appendChild(d);
  }
}
$('tabMain').onclick = () => { curList = 'main'; renderGrid(); };
$('tabExt').onclick = () => { curList = 'ext'; renderGrid(); };

function videoEmbed(url) {
  if (!url) return '<div class="empty">No video provided</div>';
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe>`;
  return `<video src="${esc(url)}" controls></video>`;
}

function openLevel(id) {
  const l = levelById(id); if (!l) return;
  const recs = STATE.records.filter(r => r.level === id && r.status === 'approved').sort((a, b) => b.percent - a.percent);
  $('mLevelBody').innerHTML = `
    <span class="close" id="closeLevel">&times;</span>
    <h2>#${l.position} ${esc(l.name)} <span style="color:var(--sub);font-size:14px">(${l.points} pts)</span></h2>
    <p><b>Creator:</b> ${esc(l.creator)} &nbsp; <b>Verifier:</b> ${esc(l.verifier)}</p>
    ${videoEmbed(l.video)}
    <div class="section"><h3>Level code</h3>
    ${l.code ? `<textarea id="lvlCode" rows="2" readonly style="resize:vertical">${esc(l.code)}</textarea>
      <div class="rowflex"><button class="small" id="btnCopyCode">Copy code</button></div>`
      : '<div class="empty">No level code was saved for this level.</div>'}
    </div>
    <div class="section"><h3>Records (${recs.length})</h3>
    ${recs.length ? recs.map(r => `<div class="rec"><span>${esc(STATE.users[r.uid] ? STATE.users[r.uid].username : r.username || '?')}</span><span>${r.percent}%</span></div>`).join('') : '<div class="empty">No approved records yet.</div>'}
    </div>
    ${isAdmin() ? `<div class="section"><button class="danger small" id="btnRemoveLevel">Remove from list (hack verified)</button></div>` : ''}
  `;
  $('mLevel').classList.add('open');
  $('closeLevel').onclick = () => $('mLevel').classList.remove('open');
  if (l.code) $('btnCopyCode').onclick = async () => {
    try { await navigator.clipboard.writeText(l.code); toast('Code copied!'); }
    catch (e) { $('lvlCode').select(); toast('Select and press Ctrl+C to copy.'); }
  };
  if (isAdmin()) $('btnRemoveLevel').onclick = async () => {
    if (!confirm('Remove "' + l.name + '" from the list?')) return;
    await deleteDoc(doc(fs, 'levels', id));
    $('mLevel').classList.remove('open'); toast('Level removed.');
  };
}
$('mLevel').onclick = e => { if (e.target === $('mLevel')) $('mLevel').classList.remove('open'); };

/* ---------- leaderboard ---------- */
$('btnLb').onclick = () => {
  const rows = Object.values(STATE.users).filter(u => !u.banned).map(u => ({ u: u.username, p: userPoints(u.uid), role: u.role })).sort((a, b) => b.p - a.p);
  $('lbBody').innerHTML = rows.length ? rows.map((r, i) => `<div class="lb-row"><span>#${i + 1} ${esc(r.u)} ${r.role !== 'user' ? '<span class="badge">' + r.role + '</span>' : ''}</span><b>${r.p} pts</b></div>`).join('') : '<div class="empty">No users yet.</div>';
  $('mLb').classList.add('open');
};
$('closeLb').onclick = () => $('mLb').classList.remove('open');
$('mLb').onclick = e => { if (e.target === $('mLb')) $('mLb').classList.remove('open'); };

/* ---------- auth modal ---------- */
function openAuth() {
  $('authBody').innerHTML = `
    <h2>Sign up / Log in</h2>
    <div class="rowflex"><button class="small" id="modeSignup">Sign up</button><button class="small ghost" id="modeLogin">Log in</button></div>
    <label>Username</label><input id="authUser">
    <label>Password</label><input id="authPass" type="password">
    <div class="rowflex"><button id="authGo">Sign up</button></div>
    <div id="authMsg"></div>`;
  let mode = 'signup';
  $('modeSignup').onclick = () => { mode = 'signup'; $('authGo').textContent = 'Sign up'; };
  $('modeLogin').onclick = () => { mode = 'login'; $('authGo').textContent = 'Log in'; };
  $('authGo').onclick = async () => {
    $('authGo').disabled = true;
    const u = $('authUser').value, p = $('authPass').value;
    const err = mode === 'signup' ? await signup(u, p) : await login(u, p);
    $('authGo').disabled = false;
    const m = $('authMsg');
    if (err) { m.className = 'msg err'; m.textContent = err; }
    else { $('mAuth').classList.remove('open'); render(); }
  };
  $('mAuth').classList.add('open');
}
$('closeAuth').onclick = () => $('mAuth').classList.remove('open');
$('mAuth').onclick = e => { if (e.target === $('mAuth')) $('mAuth').classList.remove('open'); };

/* ---------- submit record ---------- */
$('btnSubmitRecord').onclick = () => {
  if (!currentUser()) { toast('Log in first.'); openAuth(); return; }
  const opts = STATE.levels.slice().sort((a, b) => a.position - b.position).map(l => `<option value="${l.id}">#${l.position} ${esc(l.name)}</option>`).join('');
  $('recordBody').innerHTML = `
    <label>Level</label><select id="rLevel">${opts || '<option disabled>No levels yet</option>'}</select>
    <label>Progress % (100 = completion)</label><input id="rPct" type="number" min="1" max="100" value="100">
    <label>Evidence — video URL or YouTube link</label><input id="rEvid" placeholder="https://youtube.com/watch?v=...">
    <label>Note for mods (optional)</label><textarea id="rNote" rows="2"></textarea>
    <div class="rowflex"><button id="rGo">Submit</button></div>
    <div id="rMsg"></div>`;
  $('rGo').onclick = async () => {
    const level = $('rLevel').value, pct = +$('rPct').value, evid = $('rEvid').value.trim(), note = $('rNote').value.trim();
    const m = $('rMsg');
    if (!level) { m.className = 'msg err'; m.textContent = 'Pick a level.'; return; }
    if (!pct || pct < 1 || pct > 100) { m.className = 'msg err'; m.textContent = 'Progress must be 1-100.'; return; }
    if (!evid) { m.className = 'msg err'; m.textContent = 'Evidence link is required.'; return; }
    const me = currentUser();
    await addDoc(collection(fs, 'records'), { level, uid: me.uid, username: me.username, percent: pct, evidence: evid, note, status: 'pending', created: serverTimestamp() });
    $('mRecord').classList.remove('open'); toast('Record submitted for review.');
  };
  $('mRecord').classList.add('open');
};
$('closeRecord').onclick = () => $('mRecord').classList.remove('open');
$('mRecord').onclick = e => { if (e.target === $('mRecord')) $('mRecord').classList.remove('open'); };

/* ---------- submit verification ---------- */
$('btnSubmitVerif').onclick = () => {
  if (!currentUser()) { toast('Log in first.'); openAuth(); return; }
  $('verifBody').innerHTML = `
    <label>Level name</label><input id="vName">
    <label>Level code</label><textarea id="vCode" rows="2" placeholder="Paste the level share code"></textarea>
    <label>Creator</label><input id="vCreator">
    <label>Evidence — video URL or YouTube link</label><input id="vEvid" placeholder="https://youtube.com/watch?v=...">
    <label>Note for mods (optional)</label><textarea id="vNote" rows="2"></textarea>
    <div class="rowflex"><button id="vGo">Submit</button></div>
    <div id="vMsg"></div>`;
  $('vGo').onclick = async () => {
    const name = $('vName').value.trim(), code = $('vCode').value.trim(), creator = $('vCreator').value.trim(), evid = $('vEvid').value.trim(), note = $('vNote').value.trim();
    const m = $('vMsg');
    if (!name || !code || !creator || !evid) { m.className = 'msg err'; m.textContent = 'Name, code, creator and evidence are required.'; return; }
    const me = currentUser();
    await addDoc(collection(fs, 'verifications'), { name, code, creator, video: evid, note, uid: me.uid, submitter: me.username, status: 'pending', created: serverTimestamp() });
    $('mVerif').classList.remove('open'); toast('Verification submitted for review.');
  };
  $('mVerif').classList.add('open');
};
$('closeVerif').onclick = () => $('mVerif').classList.remove('open');
$('mVerif').onclick = e => { if (e.target === $('mVerif')) $('mVerif').classList.remove('open'); };

/* ---------- admin panel ---------- */
function renderAdmin() {
  if (!isStaff()) return;
  const pendingRecs = STATE.records.filter(r => r.status === 'pending');
  const pendingVerifs = STATE.verifications.filter(v => v.status === 'pending');
  let html = '<h3>Pending records (' + pendingRecs.length + ')</h3>';
  html += pendingRecs.length ? pendingRecs.map(r => {
    const lvl = levelById(r.level);
    return `<div class="rec"><span>${esc(r.username)} — ${esc(lvl ? lvl.name : '?')} — ${r.percent}% — <a href="${esc(r.evidence)}" target="_blank">evidence</a>${r.note ? ' — "' + esc(r.note) + '"' : ''}</span>
      <span><button class="small" data-act="rec-approve" data-id="${r.id}">Approve</button> <button class="small danger" data-act="rec-reject" data-id="${r.id}">Reject</button></span></div>`;
  }).join('') : '<div class="empty">None</div>';

  html += '<h3>Pending verifications (' + pendingVerifs.length + ')</h3>';
  html += pendingVerifs.length ? pendingVerifs.map(v => `<div class="rec"><span>${esc(v.name)} by ${esc(v.creator)}, verified by ${esc(v.submitter)} — code: ${esc(v.code.slice(0, 24))}${v.code.length > 24 ? '…' : ''} — <a href="${esc(v.video)}" target="_blank">evidence</a>${v.note ? ' — "' + esc(v.note) + '"' : ''}</span>
      <span><button class="small" data-act="verif-approve" data-id="${v.id}">Approve</button> <button class="small danger" data-act="verif-reject" data-id="${v.id}">Reject</button></span></div>`).join('') : '<div class="empty">None</div>';

  html += '<h3>Users</h3>' + Object.values(STATE.users).map(u => `<div class="rec"><span>${esc(u.username)} <span class="badge">${u.role}</span>${u.banned ? ' <span class="badge rejected">banned</span>' : ''}</span>
    <span style="font-size:11px;color:var(--sub)">uid: ${u.uid}</span></div>`).join('');
  html += `<div class="msg ok" style="margin-top:8px">Promote, demote, and ban are done with the scripts/set-role.js tool (for promote/demote) and the banned switch below is still app-side for quick moderation — ban/unban stays available here; role changes require the script so they're server-verified.</div>`;
  html += Object.values(STATE.users).filter(u => isAdmin() && u.uid !== auth.currentUser.uid).map(u => `<div class="rec"><span>${esc(u.username)}</span><button class="small danger" data-act="ban" data-id="${u.uid}">${u.banned ? 'Unban' : 'Ban'}</button></div>`).join('');

  $('adminBody').innerHTML = html;
  $('adminBody').querySelectorAll('button[data-act]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.id, act = b.dataset.act;
      if (act === 'rec-approve') await updateDoc(doc(fs, 'records', id), { status: 'approved' });
      if (act === 'rec-reject') await updateDoc(doc(fs, 'records', id), { status: 'rejected' });
      if (act === 'verif-reject') await updateDoc(doc(fs, 'verifications', id), { status: 'rejected' });
      if (act === 'verif-approve') {
        const v = STATE.verifications.find(x => x.id === id);
        let pos = parseInt(prompt('Position on the list (1-150, 1 = hardest)?', '150'), 10);
        if (!pos || pos < 1) pos = 150; if (pos > 150) pos = 150;
        const batch = writeBatch(fs);
        for (const l of STATE.levels) {
          if (l.position >= pos) {
            const newPos = l.position + 1;
            if (newPos <= 150) batch.update(doc(fs, 'levels', l.id), { position: newPos, points: pointsFor(newPos) });
            else batch.delete(doc(fs, 'levels', l.id));
          }
        }
        const newRef = doc(collection(fs, 'levels'));
        batch.set(newRef, { name: v.name, creator: v.creator, verifier: v.submitter, video: v.video, code: v.code, position: pos, points: pointsFor(pos) });
        batch.update(doc(fs, 'verifications', id), { status: 'approved' });
        const recRef = doc(collection(fs, 'records'));
        batch.set(recRef, { level: newRef.id, uid: v.uid, username: v.submitter, percent: 100, evidence: v.video, note: 'auto: verification', status: 'approved', created: serverTimestamp() });
        await batch.commit();
      }
      if (act === 'ban') await updateDoc(doc(fs, 'users', id), { banned: !STATE.users[id].banned });
      renderAdmin();
    };
  });
}
$('closeAdmin').onclick = () => $('mAdmin').classList.remove('open');
$('mAdmin').addEventListener('click', e => { if (e.target.id === 'mAdmin') $('mAdmin').classList.remove('open'); });
$('btnAdmin').addEventListener('click', () => { $('mAdmin').classList.add('open'); renderAdmin(); });

boot();
