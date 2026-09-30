import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, getDoc,
  addDoc, onSnapshot, writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs = getFirestore(app);

/* ---------- state ---------- */
let STATE = { users: {}, levels: [], records: [], verifications: [] };
let CUR = null; // logged-in app username (custom auth, separate from Firebase anon auth)
let ready = false;
const $ = id => document.getElementById(id);
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3000); }

/* ---------- crypto ---------- */
async function hashPass(pass, salt) {
  const enc = new TextEncoder().encode(salt + ':' + pass);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randSalt() { return crypto.getRandomValues(new Uint32Array(4)).join('-'); }

/* ---------- points ---------- */
function pointsFor(position) { return Math.round(250 - (position - 1) * (245 / 149)); }
function levelById(id) { return STATE.levels.find(l => l.id === id); }
function userPoints(username) {
  const byLevel = {};
  for (const r of STATE.records) {
    if (r.status !== 'approved' || r.username !== username) continue;
    const lvl = levelById(r.level); if (!lvl) continue;
    const pct = Math.max(0, Math.min(100, r.percent));
    const pts = Math.round(lvl.points * pct / 100);
    if (!byLevel[r.level] || byLevel[r.level] < pts) byLevel[r.level] = pts;
  }
  return Object.values(byLevel).reduce((a, b) => a + b, 0);
}

/* ---------- Firestore live sync ---------- */
function watch(name, target) {
  onSnapshot(collection(fs, name), snap => {
    if (Array.isArray(target())) {
      const arr = []; snap.forEach(d => arr.push({ id: d.id, ...d.data() })); STATE[name] = arr;
    } else {
      const obj = {}; snap.forEach(d => obj[d.id] = { username: d.id, ...d.data() }); STATE[name] = obj;
    }
    if (ready) render();
  }, err => toast('Sync error (' + name + '): ' + err.message));
}

async function boot() {
  try { await signInAnonymously(auth); }
  catch (e) { toast('Could not connect to Firebase: ' + e.message + ' — check firebase-config.js and that Anonymous sign-in is enabled.'); return; }
  onAuthStateChanged(auth, u => { if (!u) return; });
  watch('users', () => STATE.users);
  watch('levels', () => STATE.levels);
  watch('records', () => STATE.records);
  watch('verifications', () => STATE.verifications);
  const s = loadSession();
  if (s) { const d = await getDoc(doc(fs, 'users', s)); if (d.exists() && !d.data().banned) CUR = s; }
  ready = true;
  render();
}

/* ---------- session (which app-username this browser is logged in as) ---------- */
function saveSession(u) { try { localStorage.setItem('jdl_session', u); } catch (e) {} }
function loadSession() { try { return localStorage.getItem('jdl_session'); } catch (e) { return null; } }

/* ---------- auth ---------- */
function currentUser() { return CUR ? STATE.users[CUR] : null; }
function isStaff() { const u = currentUser(); return u && (u.role === 'admin' || u.role === 'mod'); }
function isAdmin() { const u = currentUser(); return u && u.role === 'admin'; }

async function signup(username, pass) {
  username = username.trim();
  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (STATE.users[username]) return 'That username is taken.';
  if (pass.length < 4) return 'Password must be at least 4 characters.';
  const salt = randSalt();
  const hash = await hashPass(pass, salt);
  const isFirst = Object.keys(STATE.users).length === 0;
  await setDoc(doc(fs, 'users', username), { salt, hash, role: isFirst ? 'admin' : 'user', banned: false, created: serverTimestamp() });
  CUR = username; saveSession(username);
  return null;
}
async function login(username, pass) {
  username = username.trim();
  const snap = await getDoc(doc(fs, 'users', username));
  if (!snap.exists()) return 'No such user.';
  const u = snap.data();
  if (u.banned) return 'This account is banned.';
  const hash = await hashPass(pass, u.salt);
  if (hash !== u.hash) return 'Wrong password.';
  CUR = username; saveSession(username);
  return null;
}
function logout() { CUR = null; saveSession(''); render(); }

/* ---------- rendering ---------- */
let curList = 'main';
function render() {
  renderAuth(); renderGrid();
  $('btnAdmin').style.display = isStaff() ? 'inline-block' : 'none';
}
function renderAuth() {
  const el = $('authArea'); const u = currentUser();
  if (!u) { el.innerHTML = '<button id="btnLogin">Sign up / Log in</button>'; $('btnLogin').onclick = openAuth; return; }
  const roleClass = u.role === 'admin' ? 'role-admin' : (u.role === 'mod' ? 'role-mod' : '');
  el.innerHTML = `<div class="userpill"><b class="${roleClass}">${esc(CUR)}</b><span style="color:var(--sub)">${userPoints(CUR)} pts</span></div><button class="ghost small" id="btnLogout">Log out</button>`;
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
    <div class="section"><h3>Records (${recs.length})</h3>
    ${recs.length ? recs.map(r => `<div class="rec"><span>${esc(r.username)}</span><span>${r.percent}%</span></div>`).join('') : '<div class="empty">No approved records yet.</div>'}
    </div>
    ${isAdmin() ? `<div class="section"><button class="danger small" id="btnRemoveLevel">Remove from list (hack verified)</button></div>` : ''}
  `;
  $('mLevel').classList.add('open');
  $('closeLevel').onclick = () => $('mLevel').classList.remove('open');
  if (isAdmin()) $('btnRemoveLevel').onclick = async () => {
    if (!confirm('Remove "' + l.name + '" from the list?')) return;
    await deleteDoc(doc(fs, 'levels', id));
    $('mLevel').classList.remove('open'); toast('Level removed.');
  };
}
$('mLevel').onclick = e => { if (e.target === $('mLevel')) $('mLevel').classList.remove('open'); };

/* ---------- leaderboard ---------- */
$('btnLb').onclick = () => {
  const rows = Object.values(STATE.users).filter(u => !u.banned).map(u => ({ u: u.username, p: userPoints(u.username), role: u.role })).sort((a, b) => b.p - a.p);
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
    const u = $('authUser').value, p = $('authPass').value;
    const err = mode === 'signup' ? await signup(u, p) : await login(u, p);
    const m = $('authMsg');
    if (err) { m.className = 'msg err'; m.textContent = err; }
    else { $('mAuth').classList.remove('open'); toast(mode === 'signup' ? 'Account created!' : 'Logged in.'); render(); }
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
    await addDoc(collection(fs, 'records'), { level, username: CUR, percent: pct, evidence: evid, note, status: 'pending', created: serverTimestamp() });
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
    await addDoc(collection(fs, 'verifications'), { name, code, creator, video: evid, note, submitter: CUR, status: 'pending', created: serverTimestamp() });
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
    <span>
      ${isAdmin() && u.role !== 'admin' ? `<button class="small ghost" data-act="promote" data-id="${u.username}">${u.role === 'mod' ? 'Demote' : 'Promote to mod'}</button>` : ''}
      ${isAdmin() && u.username !== CUR ? `<button class="small danger" data-act="ban" data-id="${u.username}">${u.banned ? 'Unban' : 'Ban'}</button>` : ''}
    </span></div>`).join('');

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
        batch.set(recRef, { level: newRef.id, username: v.submitter, percent: 100, evidence: v.video, note: 'auto: verification', status: 'approved', created: serverTimestamp() });
        await batch.commit();
      }
      if (act === 'ban') await updateDoc(doc(fs, 'users', id), { banned: !STATE.users[id].banned });
      if (act === 'promote') await updateDoc(doc(fs, 'users', id), { role: STATE.users[id].role === 'mod' ? 'user' : 'mod' });
      renderAdmin();
    };
  });
}
$('closeAdmin').onclick = () => $('mAdmin').classList.remove('open');
$('mAdmin').addEventListener('click', e => { if (e.target.id === 'mAdmin') $('mAdmin').classList.remove('open'); });
$('btnAdmin').addEventListener('click', () => { $('mAdmin').classList.add('open'); renderAdmin(); });

boot();
