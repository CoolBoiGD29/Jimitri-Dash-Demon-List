// Community tab + new home page. Loaded by app.js; shares its state, helpers and click handlers.
import { collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDocs, query, where, orderBy, limit, onSnapshot, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export function initCommunity(C) {
  const { S, views, acts, fs, TABS, render, modal, closeModal, toast, esc, safe, msg, me, uid, need, isAdmin, isStaff, GAME_URL } = C;

  /* ====== EASY SETTINGS ====== */
  const MAX_IMAGES = 4, MAX_WORDS = 500, MAX_CHARS = 4000;
  const MAX_DIM = 1100, MAX_B64 = 300000;               // images are shrunk to fit inside the database (no paid storage needed)
  /* =========================== */

  const CATS = { showcase: 'Level showcase', verification: 'Verification', news: 'News', other: 'Other' };
  const REACT = [['fire', '🔥'], ['heart', '❤️'], ['laugh', '😂'], ['clap', '👏']];
  const $ = id => document.getElementById(id);
  const SAME_ORIGIN = new URL(GAME_URL, location.href).origin === location.origin;
  S.community = []; S.comments = []; S.reactions = [];
  const IMG = {}, loading = new Set();
  let fType = 'all', fCat = 'all', openId = null, picked = [];

  /* ---------- live data (newest first, capped so the site stays fast) ---------- */
  const watch = (name, q, key) => onSnapshot(q, snap => {
    const a = []; snap.forEach(d => a.push({ id: d.id, ...d.data() })); S[key] = a; render(); refreshPost();
  }, e => toast(name + ': ' + e.message));
  watch('community', query(collection(fs, 'community'), orderBy('created', 'desc'), limit(120)), 'community');
  // Comments and reactions are only loaded for the post that's open (keeps database reads low on the free plan).
  let unsub = [];
  function listenPost(id) {
    unsub.forEach(f => typeof f === 'function' && f()); S.comments = []; S.reactions = [];
    unsub = ['comments', 'reactions'].map(name => onSnapshot(query(collection(fs, name), where('postId', '==', id)), snap => {
      const a = []; snap.forEach(d => a.push({ id: d.id, ...d.data() })); S[name] = a; refreshPost();
    }, e => toast(name + ': ' + e.message)));
  }

  /* ---------- helpers ---------- */
  const secs = x => (x && x.created && x.created.seconds) || Date.now() / 1000;
  const newest = (a, b) => secs(b) - secs(a);
  const date = x => new Date(secs(x) * 1000).toLocaleDateString();
  const approved = t => S.community.filter(c => c.status === 'approved' && (!t || c.type === t)).sort(newest);
  const okImg = s => typeof s === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(s);   // only ever render safe image data

  // Which links can be embedded. Anything else is refused at submit time (and by the security rules).
  function parseVideo(url) {
    url = String(url || '').trim(); let m;
    if ((m = url.match(/^https:\/\/(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/i)))
      return { p: 'YouTube', cls: 'yt', embed: 'https://www.youtube.com/embed/' + m[1], thumb: 'https://i.ytimg.com/vi/' + m[1] + '/hqdefault.jpg' };
    if ((m = url.match(/^https:\/\/(?:www\.)?medal\.tv\/(?:[a-z]{2}\/)?(?:games\/[^\/]+\/)?clips?\/([A-Za-z0-9_-]+)/i)))
      return { p: 'Medal', cls: 'medal', embed: 'https://medal.tv/clip/' + m[1] + '?autoplay=0&loop=0&muted=0' };
    if ((m = url.match(/^https:\/\/clips\.twitch\.tv\/embed\?(?:[^#]*&)?clip=([\w-]+)/i)) || (m = url.match(/^https:\/\/clips\.twitch\.tv\/([\w-]+)/i)) || (m = url.match(/^https:\/\/(?:www\.)?twitch\.tv\/[^\/]+\/clip\/([\w-]+)/i)))
      return { p: 'Twitch', cls: 'twitch', embed: 'https://clips.twitch.tv/embed?clip=' + m[1] + '&parent=' + location.hostname + '&autoplay=false' };
    if ((m = url.match(/^https:\/\/(?:www\.)?twitch\.tv\/videos\/(\d+)/i)))
      return { p: 'Twitch', cls: 'twitch', embed: 'https://player.twitch.tv/?video=' + m[1] + '&parent=' + location.hostname + '&autoplay=false' };
    if (/^https:\/\/[^\s]+\.(mp4|webm)(\?[^\s]*)?$/i.test(url)) return { p: 'Video file', cls: 'file', src: url };
    return null;
  }
  const embedHtml = pv => pv.embed ? `<iframe src="${esc(pv.embed)}" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>` : `<video src="${esc(pv.src)}" controls></video>`;

  async function loadImages(id) {
    if (IMG[id] || loading.has(id)) return; loading.add(id);
    try {
      const snap = await getDocs(query(collection(fs, 'communityImages'), where('postId', '==', id)));
      const a = []; snap.forEach(d => a.push(d.data()));
      IMG[id] = a.sort((x, y) => x.n - y.n).map(x => x.data).filter(okImg);
    } catch (e) { IMG[id] = []; }
    render(); refreshPost();
  }

  /* ---------- cards ---------- */
  function thumb(c) {
    if (c.type === 'video') { const pv = parseVideo(c.url); return pv && pv.thumb ? `<img src="${esc(pv.thumb)}" alt="" loading="lazy"><span class="play">▶</span>` : `<div class="tile ${pv ? pv.cls : ''}">${pv ? esc(pv.p) : 'VIDEO'}<span class="play">▶</span></div>`; }
    if (c.imageCount && !IMG[c.id]) loadImages(c.id);
    const im = (IMG[c.id] || [])[0];
    return im ? `<img src="${esc(im)}" alt="">` : `<div class="tile post">POST</div>`;
  }
  const card = (c, big) => `<div class="ccard ${big ? 'big' : ''}" data-act="c-open" data-id="${c.id}"><div class="thumb">${thumb(c)}${c.featured ? '<span class="star">★ FEATURED</span>' : ''}${c.status !== 'approved' ? '<span class="pend">' + esc(c.status) + '</span>' : ''}</div>
    <div class="cbody"><b>${esc(c.title)}</b><div class="sub">${esc(c.username)} · ${esc(CATS[c.cat] || 'Other')} · ${date(c)}</div>
    ${c.type === 'post' ? `<p class="excerpt">${esc((c.text || '').slice(0, 130))}${(c.text || '').length > 130 ? '…' : ''}</p>` : ''}</div></div>`;

  /* ---------- Community tab ---------- */
  views.community = () => {
    const all = approved();
    const feat = all.filter(c => c.type === 'video' && c.featured).sort((a, b) => ((b.featuredAt && b.featuredAt.seconds) || 0) - ((a.featuredAt && a.featuredAt.seconds) || 0));
    const rest = all.filter(c => !(c.type === 'video' && c.featured) && (fType === 'all' || c.type === fType) && (fCat === 'all' || c.cat === fCat));
    const chip = (k, label, cur, act) => `<button class="small ${cur === k ? '' : 'ghost'}" data-act="${act}" data-id="${k}">${label}</button>`;
    const mine = uid() ? S.community.filter(c => c.uid === uid() && c.status !== 'approved') : [];
    return `<div class="rowflex pad"><button data-act="cv-form">Submit a video</button><button data-act="cp-form">New post</button></div>
      ${feat.length ? `<div class="pad"><h2>★ Featured</h2><div class="feed">${feat.map(c => card(c, true)).join('')}</div></div>` : ''}
      <div class="pad"><div class="rowflex" style="margin:0 0 10px">${chip('all', 'All', fType, 'c-type')}${chip('video', 'Videos', fType, 'c-type')}${chip('post', 'Posts', fType, 'c-type')}<span style="width:12px"></span>
        ${chip('all', 'Any topic', fCat, 'c-cat')}${Object.keys(CATS).map(k => chip(k, CATS[k], fCat, 'c-cat')).join('')}</div>
        <div class="feed">${rest.map(c => card(c)).join('') || '<div class="empty" style="grid-column:1/-1">Nothing here yet. Be the first to submit something!</div>'}</div></div>
      ${mine.length ? `<div class="pad"><h3>Your submissions</h3>${mine.map(c => `<div class="rec"><span>${esc(c.title)} <span class="badge ${c.status}">${c.status === 'pending' ? 'waiting for review' : esc(c.status)}</span></span><button class="small danger" data-act="c-del" data-id="${c.id}">Delete</button></div>`).join('')}</div>` : ''}`;
  };

  /* ---------- new Home page ---------- */
  views.home = () => {
    const top = [...S.levels].sort((a, b) => a.position - b.position).slice(0, 5);
    const vids = approved('video').slice(0, 3), posts = approved('post').slice(0, 2);
    const mods = S.mods.filter(m => m.status === 'approved').sort(newest).slice(0, 3);
    return `<div class="card"><h2>Welcome to Jimitri Hub</h2><p>A fan-made home for Jimitri Dash: play the game, climb the demon list, grab community mods, and learn to build levels.</p>
      <div class="rowflex"><a href="#play"><button>Play</button></a><a href="#list"><button class="ghost">Demon List</button></a><a href="#community"><button class="ghost">Community</button></a><a href="#mods"><button class="ghost">Mods</button></a><a href="#tutorials"><button class="ghost">Tutorials</button></a></div></div>
      <div class="card"><h2>Top 5 hardest levels</h2>${top.length ? top.map(l => `<div class="toprow" data-act="lvl" data-id="${l.id}"><div class="rank">#${l.position}</div><div class="tinfo"><b>${esc(l.name)}</b><div class="sub">by ${esc(l.creator)} · verified by ${esc(l.verifier)}</div></div><div class="pts">${l.points} pts</div></div>`).join('') : '<div class="empty">No levels on the list yet.</div>'}
        <div class="rowflex"><a href="#list"><button class="small ghost">Full demon list →</button></a></div></div>
      <div class="card"><h2>Latest from the community</h2>
        <h3 class="sub">Videos</h3><div class="feed three">${vids.map(c => card(c)).join('') || '<div class="empty" style="grid-column:1/-1">No videos yet.</div>'}</div>
        <h3 class="sub">Posts</h3><div class="feed two">${posts.map(c => card(c)).join('') || '<div class="empty" style="grid-column:1/-1">No posts yet.</div>'}</div>
        <div class="rowflex"><a href="#community"><button class="small ghost">Open Community →</button></a></div></div>
      <div class="card"><h2>Latest mods</h2><div class="feed three">${mods.map(m => `<div class="ccard"><div class="cbody"><b>${esc(m.name)} <small class="sub">v${esc(m.version)}</small></b><div class="sub">by ${esc(m.author)}</div><p class="excerpt">${esc(m.description)}</p>
        <div class="rowflex"><button class="small" data-act="copy-mod" data-id="${m.id}">Copy share code</button>${SAME_ORIGIN ? `<button class="small" data-act="inst-mod" data-id="${m.id}">Install</button>` : ''}</div></div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">No mods yet.</div>'}</div>
        <div class="rowflex"><a href="#mods"><button class="small ghost">All mods →</button></a></div></div>`;
  };

  /* ---------- post / video window ---------- */
  function postHtml(c) {
    const pv = c.type === 'video' ? parseVideo(c.url) : null;
    const media = c.type === 'video'
      ? (pv ? embedHtml(pv) + `<p class="sub">${esc(pv.p)} · <a href="${esc(safe(c.url))}" target="_blank" rel="noopener">open original</a></p>` : '<div class="empty">Unsupported link</div>')
      : `<div id="pcImgs"></div>`;
    const staffBtns = [];
    if (c.status === 'pending' && isStaff()) staffBtns.push(`<button class="small" data-act="c-ok" data-id="${c.id}">Approve</button>`, `<button class="small danger" data-act="c-no" data-id="${c.id}">Reject</button>`);
    if (c.type === 'video' && isAdmin()) staffBtns.push(`<button class="small" data-act="c-feat" data-id="${c.id}">${c.featured ? 'Unfeature' : '★ Feature'}</button>`);
    if (isStaff() || (uid() && c.uid === uid())) staffBtns.push(`<button class="small danger" data-act="c-del" data-id="${c.id}">Delete</button>`);
    return `<h2>${c.featured ? '★ ' : ''}${esc(c.title)}</h2><p class="sub">${esc(c.username)} · ${esc(CATS[c.cat] || 'Other')} · ${date(c)}${c.status !== 'approved' ? ' · <b>' + esc(c.status) + '</b>' : ''}</p>
      ${media}${c.text ? `<div class="ptext">${esc(c.text)}</div>` : ''}${staffBtns.length ? `<div class="rowflex">${staffBtns.join('')}</div>` : ''}
      <div class="section"><div id="pcReacts" class="reacts"></div></div>
      <div class="section"><h3>Comments</h3><div id="pcComments"></div>
        <div class="rowflex"><input id="cText" maxlength="300" placeholder="Write a comment…"><button class="small" data-act="c-comment">Post</button></div></div>`;
  }
  function refreshPost() {                       // update only the changing parts, so typing in the comment box is never lost
    if (!openId || !$('pcReacts') || !$('modal').classList.contains('open')) return;
    const c = S.community.find(x => x.id === openId); if (!c) return;
    const im = IMG[c.id];
    if ($('pcImgs')) $('pcImgs').innerHTML = c.imageCount ? (im ? im.map(s => `<img class="pimg" src="${esc(s)}" alt="">`).join('') : '<div class="sub">Loading images…</div>') : '';
    $('pcReacts').innerHTML = REACT.map(([k, e]) => { const n = S.reactions.filter(x => x.postId === c.id && x.r === k).length, mineR = uid() && S.reactions.some(x => x.id === c.id + '_' + uid() + '_' + k);
      return `<button class="rbtn ${mineR ? 'on' : ''}" data-act="c-react" data-id="${c.id}" data-r="${k}">${e} ${n}</button>`; }).join('');
    const cm = S.comments.filter(x => x.postId === c.id).sort((a, b) => secs(a) - secs(b));
    $('pcComments').innerHTML = cm.map(x => `<div class="cmt"><b>${esc(x.username)}</b> <span class="sub">${date(x)}</span>${(isStaff() || x.uid === uid()) ? ` <button class="small danger" data-act="c-cdel" data-id="${x.id}">✕</button>` : ''}<div>${esc(x.text)}</div></div>`).join('') || '<div class="sub">No comments yet.</div>';
  }

  /* ---------- forms ---------- */
  const catSelect = id => `<select id="${id}">${Object.keys(CATS).map(k => `<option value="${k}">${CATS[k]}</option>`).join('')}</select>`;
  const words = t => (t.trim().match(/\S+/g) || []).length;
  function shrink(file) {                        // resize + recompress so each image fits inside a database document
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read "' + file.name + '" as an image.')); };
      img.onload = () => {
        URL.revokeObjectURL(url);
        let scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        for (let tries = 0; tries < 8; tries++, scale *= 0.8) {
          const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.width * scale)); cv.height = Math.max(1, Math.round(img.height * scale));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          for (let q = 0.82; q >= 0.4; q -= 0.14) { const out = cv.toDataURL('image/jpeg', q); if (out.length <= MAX_B64) return res(out); }
        }
        rej(new Error('"' + file.name + '" is too detailed to shrink. Try a smaller image.'));
      };
      img.src = url;
    });
  }

  Object.assign(acts, {
    'c-type': id => { fType = id; render(); }, 'c-cat': id => { fCat = id; render(); },
    'c-open': id => { const c = S.community.find(x => x.id === id); if (!c) return; openId = id; if (c.type === 'post') loadImages(id); listenPost(id); modal(postHtml(c)); $('modalBody').style.maxWidth = '720px'; refreshPost(); },

    'cv-form': () => { if (!need()) return; modal(`<h2>Submit a video</h2><p class="sub">YouTube, Medal, Twitch (clips or videos), or a direct .mp4/.webm link. A mod reviews it before it appears. (Video files can't be uploaded here. Upload to one of those sites and paste the link.)</p>
      <label>Title</label><input id="cvT" maxlength="100"><label>Link</label><input id="cvU" placeholder="https://..."><label>Topic</label>${catSelect('cvC')}
      <label>Description (optional)</label><textarea id="cvD" rows="3" maxlength="500"></textarea><div class="rowflex"><button data-act="cv-go">Submit</button></div><div id="fMsg"></div>`); },
    'cv-go': async () => {
      const t = $('cvT').value.trim(), u = $('cvU').value.trim();
      if (!t) return msg('fMsg', 'Give it a title.');
      if (!parseVideo(u)) return msg('fMsg', 'That link can\'t be used. Use a https:// YouTube, Medal, Twitch or direct .mp4/.webm link.');
      await addDoc(collection(fs, 'community'), { type: 'video', status: 'pending', uid: uid(), username: me().username, title: t.slice(0, 100), cat: $('cvC').value, url: u, text: $('cvD').value.trim().slice(0, 500), imageCount: 0, created: serverTimestamp() });
      closeModal(); toast('Submitted! A mod will review it.');
    },

    'cp-form': () => { if (!need()) return; picked = [];
      modal(`<h2>New post</h2><p class="sub">Up to ${MAX_IMAGES} images and ${MAX_WORDS} words. A mod reviews it before it appears.</p>
      <label>Title</label><input id="cpT" maxlength="100"><label>Topic</label>${catSelect('cpC')}
      <label>Text <span id="cpW" class="sub">0 / ${MAX_WORDS} words</span></label><textarea id="cpX" rows="6"></textarea>
      <label>Images (up to ${MAX_IMAGES})</label><input id="cpI" type="file" accept="image/*" multiple><div id="cpP" class="prevs"></div>
      <div class="rowflex"><button id="cpGo" data-act="cp-go">Submit</button></div><div id="fMsg"></div>`);
      $('cpX').addEventListener('input', () => { const n = words($('cpX').value); $('cpW').textContent = n + ' / ' + MAX_WORDS + ' words'; $('cpW').style.color = n > MAX_WORDS ? '#f66' : ''; });
      $('cpI').addEventListener('change', e => {
        picked = [...e.target.files].filter(f => /^image\//.test(f.type)).slice(0, MAX_IMAGES);
        if (e.target.files.length > MAX_IMAGES) toast('Only the first ' + MAX_IMAGES + ' images are used.');
        $('cpP').innerHTML = picked.map(f => `<img src="${URL.createObjectURL(f)}" alt="">`).join('');
      });
    },
    'cp-go': async () => {
      const t = $('cpT').value.trim(), x = $('cpX').value.trim();
      if (!t) return msg('fMsg', 'Give your post a title.');
      if (!x && !picked.length) return msg('fMsg', 'Write something or add an image.');
      if (words(x) > MAX_WORDS) return msg('fMsg', 'Too long: ' + words(x) + ' words (limit ' + MAX_WORDS + ').');
      if (x.length > MAX_CHARS) return msg('fMsg', 'Too long: ' + x.length + ' characters (limit ' + MAX_CHARS + ').');
      const btn = $('cpGo'); btn.disabled = true; msg('fMsg', picked.length ? 'Preparing images…' : 'Submitting…', true);
      try {
        const imgs = []; for (const f of picked) imgs.push(await shrink(f));
        const b = writeBatch(fs), ref = doc(collection(fs, 'community'));
        b.set(ref, { type: 'post', status: 'pending', uid: uid(), username: me().username, title: t.slice(0, 100), cat: $('cpC').value, url: '', text: x, imageCount: imgs.length, created: serverTimestamp() });
        imgs.forEach((data, n) => b.set(doc(collection(fs, 'communityImages')), { postId: ref.id, n, data }));
        await b.commit(); closeModal(); toast('Submitted! A mod will review it.');
      } catch (e) { btn.disabled = false; msg('fMsg', e.code === 'permission-denied' ? 'Not allowed. Are you logged in and not banned?' : e.message); }
    },

    'c-react': async (id, el) => { if (!need()) return; const r = el.dataset.r, rid = id + '_' + uid() + '_' + r;
      if (S.reactions.some(x => x.id === rid)) await deleteDoc(doc(fs, 'reactions', rid));
      else await setDoc(doc(fs, 'reactions', rid), { postId: id, uid: uid(), r, created: serverTimestamp() }); },
    'c-comment': async () => { if (!need()) return; const t = $('cText').value.trim(); if (!t) return;
      await addDoc(collection(fs, 'comments'), { postId: openId, uid: uid(), username: me().username, text: t.slice(0, 300), created: serverTimestamp() }); $('cText').value = ''; },
    'c-cdel': id => deleteDoc(doc(fs, 'comments', id)),

    'c-ok': id => updateDoc(doc(fs, 'community', id), { status: 'approved' }),
    'c-no': id => updateDoc(doc(fs, 'community', id), { status: 'rejected' }),
    'c-okf': id => updateDoc(doc(fs, 'community', id), { status: 'approved', featured: true, featuredAt: serverTimestamp() }),   // approve AND feature
    'c-feat': id => { const c = S.community.find(x => x.id === id); return updateDoc(doc(fs, 'community', id), { featured: !c.featured, featuredAt: serverTimestamp() }); },
    'c-del': async id => { if (!confirm('Delete this for good?')) return;
      const b = writeBatch(fs); b.delete(doc(fs, 'community', id));
      try { (await getDocs(query(collection(fs, 'communityImages'), where('postId', '==', id)))).forEach(d => b.delete(d.ref)); } catch (e) {}
      await b.commit(); delete IMG[id]; if (openId === id) closeModal(); toast('Deleted.'); }
  });

  /* ---------- admin: pending community items join the review queue ---------- */
  const baseAdmin = views.admin;
  views.admin = () => {
    let h = baseAdmin();
    if (!isStaff()) return h;
    const pc = S.community.filter(c => c.status === 'pending').sort(newest);
    const block = `<h2>Pending community (${pc.length})</h2>` + (pc.map(c => `<div class="rec"><span>${c.type === 'video' ? '🎬' : '📝'} ${esc(c.title)} <span class="sub">by ${esc(c.username)} · ${esc(CATS[c.cat] || 'Other')}</span></span>
      <span><button class="small ghost" data-act="c-open" data-id="${c.id}">Preview</button> <button class="small" data-act="c-ok" data-id="${c.id}">Approve</button> ${c.type === 'video' && isAdmin() ? `<button class="small" data-act="c-okf" data-id="${c.id}">Approve + ★ Feature</button> ` : ''}<button class="small danger" data-act="c-no" data-id="${c.id}">Reject</button></span></div>`).join('') || '<div class="empty">None</div>');
    return h.includes('<h2>Users</h2>') ? h.replace('<h2>Users</h2>', block + '<h2>Users</h2>') : h.replace(/<\/div>$/, block + '</div>');
  };

  TABS.splice(3, 0, ['community', 'Community']);      // Home, Play, Demon List, Community, Mods, ...
}
