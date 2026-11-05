import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, getDocs, query, where, addDoc, onSnapshot, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { initCommunity } from './community.js';

/* ====== EASY SETTINGS ====== */
const GAME_URL = './game/'; // the game folder inside this repo (use the full original URL here if you don't host a copy)
const MAX_VIDEOS = 5;                                                 // tutorial video limit
/* =========================== */

const app = initializeApp(firebaseConfig), auth = getAuth(app), fs = getFirestore(app);
const toEmail = u => u.trim().toLowerCase() + '@jimitridemonlist.invalid'; // hidden; users only see usernames

const S = { users: {}, admins: {}, staff: {}, levels: [], records: [], verifications: [], mods: [], tutorials: [] };
const keyed = ['users', 'admins', 'staff'];
for (const n of Object.keys(S)) onSnapshot(collection(fs, n), snap => {
  if (keyed.includes(n)) { const o = {}; snap.forEach(d => o[d.id] = { uid: d.id, ...d.data() }); S[n] = o; }
  else { const a = []; snap.forEach(d => a.push({ id: d.id, ...d.data() })); S[n] = a; }
  render();
}, e => toast(n + ': ' + e.message));
onAuthStateChanged(auth, () => render());

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safe = u => /^https?:\/\//i.test(u) ? u : '#';
const toast = m => { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 3500); };
const modal = h => { $('modalBody').style.maxWidth = ''; $('modalBody').innerHTML = '<span class="close" data-act="close">&times;</span>' + h; $('modal').classList.add('open'); };
const closeModal = () => $('modal').classList.remove('open');
const msg = (id, t, ok) => { const m = $(id); m.className = 'msg ' + (ok ? 'ok' : 'err'); m.textContent = t; };
const copy = async (t, ok) => { try { await navigator.clipboard.writeText(t); toast(ok); } catch (e) { prompt('Copy this:', t); } };
const pointsFor = p => Math.round(250 - (p - 1) * (245 / 149));
const lvl = id => S.levels.find(l => l.id === id);
const ytId = u => (String(u).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/) || [])[1];
const embed = u => ytId(u) ? `<iframe src="https://www.youtube.com/embed/${ytId(u)}" allowfullscreen></iframe>` : (/^https?:/i.test(u) ? `<video src="${esc(u)}" controls></video>` : '<div class="empty">No video</div>');
const userPts = u => { const b = {}; for (const r of S.records) { if (r.status !== 'approved' || r.uid !== u) continue; const l = lvl(r.level); if (!l) continue; const p = Math.round(l.points * Math.min(100, Math.max(0, r.percent)) / 100); if (!(b[r.level] >= p)) b[r.level] = p; } return Object.values(b).reduce((a, c) => a + c, 0); };
const uid = () => auth.currentUser && auth.currentUser.uid;
const me = () => S.users[uid()];
const isAdmin = () => !!(uid() && S.admins[uid()]);
const isStaff = () => isAdmin() || !!(uid() && S.staff[uid()]);
const pending = () => S.records.filter(r => r.status === 'pending').length + S.verifications.filter(v => v.status === 'pending').length + S.mods.filter(m => m.status === 'pending').length + (S.community || []).filter(c => c.status === 'pending').length;
const need = () => { if (me()) return true; toast('Log in first.'); acts['open-auth'](); return false; };

/* mods use the same share-code format as the Jimitri Mod Loader */
const modObj = m => { let code = m.code; try { if (code.trim().startsWith('{')) { const j = JSON.parse(code); if (j.code) code = j.code; } } catch (e) {}
  return { format: 1, id: (m.name || 'mod').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mod', name: m.name, version: m.version || '1.0.0', author: m.author, description: m.description || '', code }; };
const SAME_ORIGIN = new URL(GAME_URL, location.href).origin === location.origin; // true when the game is hosted next to this site
const shareCode = m => 'JDMOD:' + btoa(unescape(encodeURIComponent(JSON.stringify(modObj(m)))));

/* ---------- views ---------- */
let tab = 'home', listTab = 'main';
const TABS = [['home', 'Home'], ['play', 'Play'], ['list', 'Demon List'], ['mods', 'Mods'], ['tutorials', 'Tutorials'], ['leaderboard', 'Leaderboard']];
const views = {
  home: () => `<div class="card"><h2>Welcome to Jimitri Hub</h2><p>A fan-made home for Jimitri Dash: play the game, climb the demon list, grab community mods, and learn to build levels.</p>
    <div class="rowflex"><a href="#play"><button>Play</button></a><a href="#list"><button class="ghost">Demon List</button></a><a href="#mods"><button class="ghost">Mods</button></a><a href="#tutorials"><button class="ghost">Tutorials</button></a></div></div>
    <div class="card"><h2>Credits</h2><p><b>turkball</b> created Jimitri Dash.<br><b>specta</b> gave me the idea to remake this site.<br>This is an unofficial fan site.</p></div>`,
  play: () => `<div class="pad"><iframe class="gamebox" src="${esc(GAME_URL)}" allow="fullscreen; autoplay"></iframe>
    <p class="sub">Game not loading? <a href="${esc(GAME_URL)}" target="_blank" rel="noopener">Open it in its own tab</a>. Log in inside the game (ACCOUNT button) to upload levels.</p></div>`,
  list: () => { const all = [...S.levels].sort((a, b) => a.position - b.position), L = listTab === 'main' ? all.filter(l => l.position <= 75) : all.filter(l => l.position > 75);
    return `<div class="tabs"><div class="tab main ${listTab === 'main' ? 'active' : ''}" data-act="ltab" data-id="main">MAIN LIST</div><div class="tab ext ${listTab === 'ext' ? 'active' : ''}" data-act="ltab" data-id="ext">EXTENDED LIST</div></div>
    <div class="grid">${L.length ? L.map(l => `<div class="lvl ${l.position <= 75 ? 'main' : 'ext'}" data-act="lvl" data-id="${l.id}"><div class="ic">#${l.position}</div><small>${esc(l.name)}</small></div>`).join('') : '<div class="empty">No levels here yet.</div>'}</div>
    <div class="rowflex pad"><button data-act="rec-form">Submit Record</button><button class="ghost" data-act="ver-form">Submit Verification</button></div>`; },
  mods: () => { const L = S.mods.filter(m => m.status === 'approved');
    return `<div class="rowflex pad"><button data-act="mod-form">Submit a mod</button></div><div class="cards">${L.length ? L.map(m => `<div class="card"><h3>${esc(m.name)} <small class="sub">v${esc(m.version)}</small></h3><p class="sub">by ${esc(m.author)}</p><p>${esc(m.description)}</p>
      <div class="rowflex"><button class="small" data-act="copy-mod" data-id="${m.id}">Copy share code</button>${SAME_ORIGIN ? `<button class="small" data-act="inst-mod" data-id="${m.id}">Install to game</button>` : ''}<button class="small ghost" data-act="dl-mod" data-id="${m.id}">Download .jdmod</button>${isStaff() ? `<button class="small danger" data-act="mod-del" data-id="${m.id}">Delete</button>` : ''}</div></div>`).join('') : '<div class="empty" style="grid-column:1/-1">No approved mods yet.</div>'}</div>
    <p class="sub pad">To install: press Install to game, then reload the game. (Or open the game, click MODS, then IMPORT CODE with a share code.) Only install mods you trust.</p>`; },
  tutorials: () => { const L = [...S.tutorials].sort((a, b) => (a.order || 0) - (b.order || 0));
    return `${isAdmin() ? `<div class="rowflex pad"><button data-act="vid-form" ${L.length >= MAX_VIDEOS ? 'disabled' : ''}>Add video (${L.length}/${MAX_VIDEOS})</button></div>` : ''}
    <div class="cards">${L.length ? L.map(t => `<div class="card"><h3>${esc(t.title)}</h3>${embed(t.url)}${isAdmin() ? `<div class="rowflex"><button class="small danger" data-act="vid-del" data-id="${t.id}">Remove</button></div>` : ''}</div>`).join('') : '<div class="empty" style="grid-column:1/-1">Tutorials coming soon: level creation, triggers, custom blocks, and effects.</div>'}</div>`; },
  leaderboard: () => { const R = Object.values(S.users).filter(u => !u.banned).map(u => ({ n: u.username, p: userPts(u.uid), id: u.uid })).sort((a, b) => b.p - a.p);
    return `<div class="pad"><h2>Leaderboard</h2>${R.length ? R.map((r, i) => `<div class="lb-row"><span>#${i + 1} ${esc(r.n)} ${S.admins[r.id] ? '<span class="badge">admin</span>' : S.staff[r.id] ? '<span class="badge">mod</span>' : ''}</span><b>${r.p} pts</b></div>`).join('') : '<div class="empty">No players yet.</div>'}</div>`; },
  admin: () => { if (!isStaff()) return '<div class="empty">Staff only.</div>';
    const pr = S.records.filter(r => r.status === 'pending'), pv = S.verifications.filter(v => v.status === 'pending'), pm = S.mods.filter(m => m.status === 'pending');
    const row = (t, a, id, extra = '') => `<div class="rec"><span>${t}</span><span>${extra}<button class="small" data-act="${a}-ok" data-id="${id}">Approve</button> <button class="small danger" data-act="${a}-no" data-id="${id}">Reject</button></span></div>`;
    const none = '<div class="empty">None</div>';
    let h = `<div class="pad"><h2>Pending records (${pr.length})</h2>` + (pr.map(r => row(`${esc(r.username)}: ${esc(lvl(r.level) ? lvl(r.level).name : '?')} ${r.percent}% <a href="${esc(safe(r.evidence))}" target="_blank" rel="noopener">evidence</a>${r.note ? ' “' + esc(r.note) + '”' : ''}`, 'rec', r.id)).join('') || none)
      + `<h2>Pending verifications (${pv.length})</h2>` + (pv.map(v => row(`${esc(v.name)} by ${esc(v.creator)}, verified by ${esc(v.submitter)} <a href="${esc(safe(v.video))}" target="_blank" rel="noopener">evidence</a>${v.note ? ' “' + esc(v.note) + '”' : ''}`, 'ver', v.id)).join('') || none)
      + `<h2>Pending mods (${pm.length})</h2><p class="sub">Read the code before approving. Approved mods run inside players' browsers.</p>` + (pm.map(m => row(`${esc(m.name)} v${esc(m.version)} by ${esc(m.author)}`, 'mod', m.id, `<button class="small ghost" data-act="mod-view" data-id="${m.id}">View code</button> `)).join('') || none);
    if (isAdmin()) h += '<h2>Users</h2>' + Object.values(S.users).map(u => `<div class="rec"><span>${esc(u.username)} ${S.admins[u.uid] ? '<span class="badge">admin</span>' : S.staff[u.uid] ? '<span class="badge">mod</span>' : ''}${u.banned ? ' <span class="badge rejected">banned</span>' : ''}</span>
      <span>${S.admins[u.uid] ? '' : `<button class="small ghost" data-act="staff" data-id="${u.uid}">${S.staff[u.uid] ? 'Remove mod' : 'Make mod'}</button> <button class="small danger" data-act="ban" data-id="${u.uid}">${u.banned ? 'Unban' : 'Ban'}</button>`}</span></div>`).join('');
    return h + '</div>'; }
};
function render() {
  $('nav').innerHTML = TABS.map(([k, n]) => `<a href="#${k}" class="${tab === k ? 'on' : ''}">${n}</a>`).join('') + (isStaff() ? `<a href="#admin" class="${tab === 'admin' ? 'on' : ''}">Admin${pending() ? ' (' + pending() + ')' : ''}</a>` : '');
  const u = me();
  $('authArea').innerHTML = auth.currentUser && u ? `<div class="userpill"><b class="${isAdmin() ? 'role-admin' : isStaff() ? 'role-mod' : ''}">${esc(u.username)}</b><span class="sub">${userPts(u.uid)} pts</span></div><button class="ghost small" data-act="logout">Log out</button>` : '<button data-act="open-auth">Sign up / Log in</button>';
  $('view').innerHTML = (views[tab] || views.home)();
}
addEventListener('hashchange', () => { tab = location.hash.slice(1) || 'home'; render(); scrollTo(0, 0); });
tab = location.hash.slice(1) || 'home';

/* ---------- actions ---------- */
let authMode = 'signup';
const setStatus = (col, id, status) => updateDoc(doc(fs, col, id), { status });
const acts = {
  close: closeModal,
  ltab: id => { listTab = id; render(); },
  logout: () => signOut(auth),
  'open-auth': () => { authMode = 'signup'; modal(`<h2>Sign up / Log in</h2><div class="rowflex"><button class="small" data-act="auth-mode" data-id="signup">Sign up</button><button class="small ghost" data-act="auth-mode" data-id="login">Log in</button></div>
    <label>Username (3-20 letters, numbers, _)</label><input id="aUser"><label>Password (6+ characters)</label><input id="aPass" type="password"><div class="rowflex"><button id="aGo" data-act="auth-go">Sign up</button></div><div id="aMsg"></div>`); },
  'auth-mode': id => { authMode = id; $('aGo').textContent = id === 'signup' ? 'Sign up' : 'Log in'; },
  'auth-go': async () => {
    const name = $('aUser').value.trim(), pass = $('aPass').value;
    try {
      if (authMode === 'signup') {
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) return msg('aMsg', 'Username must be 3-20 letters, numbers or _.');
        if (pass.length < 6) return msg('aMsg', 'Password must be at least 6 characters.');
        if (!(await getDocs(query(collection(fs, 'users'), where('username', '==', name)))).empty) return msg('aMsg', 'That username is taken.');
        const c = await createUserWithEmailAndPassword(auth, toEmail(name), pass);
        await setDoc(doc(fs, 'users', c.user.uid), { username: name, banned: false, created: serverTimestamp() });
      } else await signInWithEmailAndPassword(auth, toEmail(name), pass);
      closeModal(); toast(authMode === 'signup' ? 'Account created!' : 'Logged in.');
    } catch (e) { msg('aMsg', ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(e.code) ? 'Wrong username or password.' : e.code === 'auth/email-already-in-use' ? 'That username is taken.' : e.message); }
  },
  lvl: id => { const l = lvl(id); if (!l) return; const R = S.records.filter(r => r.level === id && r.status === 'approved').sort((a, b) => b.percent - a.percent);
    modal(`<h2>#${l.position} ${esc(l.name)} <span class="sub">(${l.points} pts)</span></h2><p><b>Creator:</b> ${esc(l.creator)} &nbsp; <b>Verifier:</b> ${esc(l.verifier)}</p>${embed(l.video)}
      <div class="section"><h3>Level code</h3>${l.code ? `<textarea readonly rows="2">${esc(l.code)}</textarea><div class="rowflex"><button class="small" data-act="copy-level" data-id="${l.id}">Copy code</button></div>` : '<div class="empty">No code saved.</div>'}</div>
      <div class="section"><h3>Records (${R.length})</h3>${R.map(r => `<div class="rec"><span>${esc(S.users[r.uid] ? S.users[r.uid].username : r.username)}</span><span>${r.percent}%</span></div>`).join('') || '<div class="empty">No approved records yet.</div>'}</div>
      ${isStaff() ? `<div class="section"><button class="danger small" data-act="lvl-del" data-id="${l.id}">Remove from list (hack verified)</button></div>` : ''}`); },
  'copy-level': id => copy(lvl(id).code, 'Level code copied!'),
  'lvl-del': async id => { if (confirm('Remove "' + lvl(id).name + '" from the list?')) { await deleteDoc(doc(fs, 'levels', id)); closeModal(); toast('Level removed.'); } },
  'rec-form': () => { if (!need()) return; modal(`<h2>Submit Record</h2><label>Level</label><select id="rLevel">${[...S.levels].sort((a, b) => a.position - b.position).map(l => `<option value="${l.id}">#${l.position} ${esc(l.name)}</option>`).join('') || '<option value="">No levels yet</option>'}</select>
    <label>Progress % (100 = completion)</label><input id="rPct" type="number" min="1" max="100" value="100"><label>Evidence (YouTube or video link)</label><input id="rEvid" placeholder="https://youtube.com/...">
    <label>Note for mods (optional)</label><textarea id="rNote" rows="2"></textarea><div class="rowflex"><button data-act="rec-go">Submit</button></div><div id="fMsg"></div>`); },
  'rec-go': async () => { const level = $('rLevel').value, p = +$('rPct').value, ev = $('rEvid').value.trim();
    if (!level || !(p >= 1 && p <= 100) || !/^https?:\/\//i.test(ev)) return msg('fMsg', 'Pick a level, a progress from 1 to 100, and a link starting with http.');
    await addDoc(collection(fs, 'records'), { level, uid: uid(), username: me().username, percent: Math.round(p), evidence: ev, note: $('rNote').value.trim().slice(0, 300), status: 'pending', created: serverTimestamp() }); closeModal(); toast('Record submitted for review.'); },
  'ver-form': () => { if (!need()) return; modal(`<h2>Submit Verification</h2><label>Level name</label><input id="vName"><label>Level code</label><textarea id="vCode" rows="2"></textarea><label>Creator</label><input id="vCreator">
    <label>Evidence (YouTube or video link)</label><input id="vEvid" placeholder="https://youtube.com/..."><label>Note for mods (optional)</label><textarea id="vNote" rows="2"></textarea><div class="rowflex"><button data-act="ver-go">Submit</button></div><div id="fMsg"></div>`); },
  'ver-go': async () => { const name = $('vName').value.trim(), code = $('vCode').value.trim(), cr = $('vCreator').value.trim(), ev = $('vEvid').value.trim();
    if (!name || !code || !cr || !/^https?:\/\//i.test(ev)) return msg('fMsg', 'Name, code, creator, and an http evidence link are required.');
    await addDoc(collection(fs, 'verifications'), { name, code, creator: cr, video: ev, note: $('vNote').value.trim().slice(0, 300), uid: uid(), submitter: me().username, status: 'pending', created: serverTimestamp() }); closeModal(); toast('Verification submitted for review.'); },
  'mod-form': () => { if (!need()) return; modal(`<h2>Submit a mod</h2><p class="sub">An admin reads and approves every mod before it appears.</p><label>Name</label><input id="mName"><label>Version</label><input id="mVer" value="1.0.0"><label>Description</label><textarea id="mDesc" rows="2"></textarea>
    <label>Mod file (.js or .jdmod)</label><input id="mFile" type="file" accept=".js,.jdmod,.json"><label>...or paste the code</label><textarea id="mCode" rows="4"></textarea><div class="rowflex"><button data-act="mod-go">Submit</button></div><div id="fMsg"></div>`); },
  'mod-go': async () => { const f = $('mFile').files[0]; const code = (f ? await f.text() : $('mCode').value).trim(), name = $('mName').value.trim();
    if (!name || !code) return msg('fMsg', 'A name and a mod file or code are required.'); if (code.length > 99000) return msg('fMsg', 'That mod is too big (limit about 99 KB).');
    await addDoc(collection(fs, 'mods'), { name: name.slice(0, 79), version: $('mVer').value.trim().slice(0, 20) || '1.0.0', description: $('mDesc').value.trim().slice(0, 300), code, uid: uid(), author: me().username, status: 'pending', created: serverTimestamp() }); closeModal(); toast('Mod submitted. An admin will review it.'); },
  'copy-mod': id => copy(shareCode(S.mods.find(m => m.id === id)), 'Share code copied! Paste it into the mod loader.'),
  'inst-mod': id => { const m = S.mods.find(x => x.id === id), o = modObj(m); if (!confirm('Install "' + o.name + '" into the game? It runs with full access to the game page.')) return;
    let L = []; try { L = JSON.parse(localStorage.getItem('jdmods:v1') || '[]'); } catch (e) {}
    L = L.filter(x => x.id !== o.id); L.push({ id: o.id, name: o.name, version: o.version, author: o.author, description: o.description, code: o.code, enabled: true });
    localStorage.setItem('jdmods:v1', JSON.stringify(L)); toast('Installed! Reload the game to use it.'); },
  'dl-mod': id => { const m = S.mods.find(x => x.id === id), o = modObj(m), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' })); a.download = o.id + '.jdmod'; a.click(); },
  'mod-view': id => modal(`<h2>Code review</h2><textarea readonly rows="16" style="font-family:monospace">${esc(S.mods.find(m => m.id === id).code)}</textarea>`),
  'mod-del': async id => { if (confirm('Delete this mod?')) await deleteDoc(doc(fs, 'mods', id)); },
  'vid-form': () => modal(`<h2>Add tutorial video</h2><label>Title</label><input id="tTitle" placeholder="How triggers work"><label>YouTube link</label><input id="tUrl"><div class="rowflex"><button data-act="vid-go">Add</button></div><div id="fMsg"></div>`),
  'vid-go': async () => { const t = $('tTitle').value.trim(), u = $('tUrl').value.trim(); if (!t || !ytId(u)) return msg('fMsg', 'Enter a title and a valid YouTube link.');
    if (S.tutorials.length >= MAX_VIDEOS) return msg('fMsg', 'Video limit reached. Remove one first.'); await addDoc(collection(fs, 'tutorials'), { title: t.slice(0, 80), url: u, order: Date.now() }); closeModal(); },
  'vid-del': async id => { if (confirm('Remove this video?')) await deleteDoc(doc(fs, 'tutorials', id)); },
  'rec-ok': id => setStatus('records', id, 'approved'), 'rec-no': id => setStatus('records', id, 'rejected'),
  'mod-ok': id => setStatus('mods', id, 'approved'), 'mod-no': id => setStatus('mods', id, 'rejected'),
  'ver-no': id => setStatus('verifications', id, 'rejected'),
  'ver-ok': async id => { const v = S.verifications.find(x => x.id === id); let pos = parseInt(prompt('Position on the list (1-150, 1 = hardest)?', '150'), 10); if (!pos || pos < 1 || pos > 150) pos = 150;
    const b = writeBatch(fs); for (const l of S.levels) if (l.position >= pos) { const np = l.position + 1; np <= 150 ? b.update(doc(fs, 'levels', l.id), { position: np, points: pointsFor(np) }) : b.delete(doc(fs, 'levels', l.id)); }
    const lr = doc(collection(fs, 'levels')); b.set(lr, { name: v.name, creator: v.creator, verifier: v.submitter, video: v.video, code: v.code, position: pos, points: pointsFor(pos) });
    b.update(doc(fs, 'verifications', id), { status: 'approved' }); b.set(doc(collection(fs, 'records')), { level: lr.id, uid: v.uid, username: v.submitter, percent: 100, evidence: v.video, note: 'auto: verification', status: 'approved', created: serverTimestamp() }); await b.commit(); },
  ban: id => updateDoc(doc(fs, 'users', id), { banned: !S.users[id].banned }),
  staff: id => S.staff[id] ? deleteDoc(doc(fs, 'staff', id)) : setDoc(doc(fs, 'staff', id), { created: serverTimestamp() })
};
document.addEventListener('click', async e => {
  if (e.target.id === 'modal') return closeModal();
  const el = e.target.closest('[data-act]'); if (!el || !acts[el.dataset.act]) return;
  try { await acts[el.dataset.act](el.dataset.id, el); }
  catch (err) { toast(err.code === 'permission-denied' ? 'Not allowed. Are you logged in, not banned, and approved for that?' : err.message); }
});
initCommunity({ S, views, acts, fs, TABS, render, modal, closeModal, toast, esc, safe, msg, me, uid, need, isAdmin, isStaff, GAME_URL });
render();
