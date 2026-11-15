// KikUp friends: accounts, player profiles, friend codes, friend streaks, leaderboard, challenges.
// Uses Firebase Auth (sign-in) and Firestore (data). Security is enforced by firestore.rules.
//
// Accounts
//   Teen (13+):   signs up with a username + password. Firebase needs an email, so the
//                 username becomes "<username>@players.kikup.app" (not a real inbox).
//   Parent:       signs up with a real email + password, gives consent, then adds each
//                 child as a player with a generated nickname (no real names, no free text).
// Profiles        profiles/{pid}  (teen: pid = account uid; child: random id)
// Friends         friendships/{a_b} holds both players' names and shared stats, plus the
//                 friend streak (days in a row you BOTH trained).
// Challenges      challenges/{id}: "Beat my 25 juggles!" with preset messages only.
import { firebaseConfig } from './firebase-config.js';

const here = (p) => new URL(p, import.meta.url).href;
const TEEN_DOMAIN = 'players.kikup.app';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MESSAGES = ['Beat my score!', 'Bet you can\'t beat this!', 'Let\'s both do this today!', 'Your turn!'];
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'sex', 'porn', 'nazi', 'nigg', 'fag', 'slut', 'whore', 'rape', 'kill', 'ass', 'damn', 'hell', 'piss', 'penis', 'vagina', 'boob'];
const ADJ = ['Speedy', 'Mighty', 'Golden', 'Rocket', 'Lucky', 'Brave', 'Flying', 'Super', 'Turbo', 'Swift', 'Clever', 'Thunder', 'Blazing', 'Happy', 'Silver', 'Cosmic'];
const NOUN = ['Striker', 'Keeper', 'Kicker', 'Dribbler', 'Winger', 'Goalie', 'Captain', 'Champ', 'Falcon', 'Tiger', 'Panther', 'Comet', 'Dragon', 'Rocket', 'Lion', 'Fox'];

let fb = null, auth = null, db = null, ready = null;
export const configured = () => !!firebaseConfig;

function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); }); }

// Load Firebase and restore the signed-in account (if any). Resolves to the user or null.
export function init(opts = {}) {
  if (!configured()) return Promise.resolve(null);
  if (!ready) ready = (async () => {
    if (!window.firebase) { await loadScript(here('../vendor/firebase/firebase-app-compat.js')); await loadScript(here('../vendor/firebase/firebase-auth-compat.js')); await loadScript(here('../vendor/firebase/firebase-firestore-compat.js')); }
    fb = window.firebase; if (!fb.apps.length) fb.initializeApp(firebaseConfig);
    auth = fb.auth(); db = fb.firestore();
    const emu = opts.emulator || window.__KIKUP_EMULATOR;   // local testing only
    if (emu) { auth.useEmulator(emu.auth, { disableWarnings: true }); db.useEmulator(emu.host, emu.port); }
    return new Promise((res) => { const off = auth.onAuthStateChanged((u) => { off(); res(u); }); });
  })();
  return ready;
}
export const user = () => auth && auth.currentUser;
export function onAuth(fn) { return auth ? auth.onAuthStateChanged(fn) : () => {}; }

// ---------- helpers ----------
export const dayStr = (dt) => `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`;
const today = () => dayStr(new Date());
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dayStr(d); };
export function weekKey(dt = new Date()) { const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate())); const n = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - n);
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return `${d.getUTCFullYear()}-W${Math.ceil(((d - y) / 864e5 + 1) / 7)}`; }
export const pairId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const now = () => Date.now();
export function randomCode() { let c = ''; const r = crypto.getRandomValues(new Uint32Array(6)); for (const x of r) c += CODE_CHARS[x % CODE_CHARS.length]; return c; }
export function nicknameIdeas(n = 6) { const out = new Set(); while (out.size < n) out.add(`${ADJ[Math.floor(Math.random() * ADJ.length)]} ${NOUN[Math.floor(Math.random() * NOUN.length)]} ${10 + Math.floor(Math.random() * 90)}`); return [...out]; }
export function checkUsername(u) {
  u = (u || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,15}$/.test(u)) return { ok: false, msg: 'Use 3–15 letters, numbers or _ (no spaces).' };
  if (BLOCKED.some((w) => u.includes(w))) return { ok: false, msg: 'Pick a different username.' };
  return { ok: true, u };
}
export function friendlyError(e) {
  const c = (e && e.code) || '';
  return ({ 'auth/email-already-in-use': 'That name or email is already taken.', 'auth/invalid-email': 'Check the email address.', 'auth/weak-password': 'Use a password with at least 8 characters.',
    'auth/wrong-password': 'Wrong username or password.', 'auth/user-not-found': 'Wrong username or password.', 'auth/invalid-credential': 'Wrong username or password.', 'auth/invalid-login-credentials': 'Wrong username or password.',
    'auth/too-many-requests': 'Too many tries. Wait a few minutes and try again.', 'auth/network-request-failed': 'No internet connection. Try again when you\'re online.',
    'auth/requires-recent-login': 'For safety, log out and back in, then try again.', 'permission-denied': 'That isn\'t allowed.' })[c] || (e && e.message) || 'Something went wrong. Try again.';
}

// ---------- accounts ----------
async function newCode(pid, name) {
  for (let i = 0; i < 5; i++) { const code = randomCode(), ref = db.collection('codes').doc(code);
    try { await db.runTransaction(async (tx) => { if ((await tx.get(ref)).exists) throw new Error('taken'); tx.set(ref, { pid, name, owner: auth.currentUser.uid }); }); return code; } catch (e) { if (e.message !== 'taken') throw e; } }
  throw new Error('Could not make a friend code. Try again.');
}
async function createProfile(pid, data) {
  const ref = db.collection('profiles').doc(pid), uid = auth.currentUser.uid;
  await ref.set({ owner: uid, name: data.name, kid: !!data.kid, age: data.age, tier: data.tier ?? 0, stars: 0, streak: 0, bestStreak: 0, lastDay: null, weekKey: weekKey(), weekStars: 0, createdAt: now() });
  const code = await newCode(pid, data.name);
  await ref.update({ friendCode: code });   // set once; the rules stop it changing later
  return { id: pid, ...(await ref.get()).data() };
}

// Teen (13+): username + password.
export async function signUpTeen({ username, password, age, tier }) {
  const chk = checkUsername(username); if (!chk.ok) throw new Error(chk.msg);
  if ((password || '').length < 8) throw Object.assign(new Error(), { code: 'auth/weak-password' });
  const cred = await auth.createUserWithEmailAndPassword(`${chk.u}@${TEEN_DOMAIN}`, password);
  await db.collection('users').doc(cred.user.uid).set({ kind: 'teen', username: chk.u, createdAt: now() });
  return createProfile(cred.user.uid, { name: chk.u, kid: false, age, tier });
}
// Parent: email + password + consent. Children are added afterwards.
export async function signUpParent({ email, password, consent }) {
  if (!consent) throw new Error('Please confirm you\'re the parent or guardian and agree.');
  const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);
  await db.collection('users').doc(cred.user.uid).set({ kind: 'parent', consentAt: now(), createdAt: now() });
  return cred.user;
}
export async function addChild({ name, age, tier }) {
  const ref = db.collection('profiles').doc();
  const p = await createProfile(ref.id, { name, kid: true, age, tier });
  return p;
}
export async function logIn(id, password) {
  id = (id || '').trim();
  const email = id.includes('@') ? id : `${id.toLowerCase()}@${TEEN_DOMAIN}`;
  return (await auth.signInWithEmailAndPassword(email, password)).user;
}
export const logOut = () => auth.signOut();
export async function resetParentPassword(email) { await auth.sendPasswordResetEmail(email.trim()); }
export async function account() {
  const u = auth.currentUser; if (!u) return null;
  const doc = await db.collection('users').doc(u.uid).get();
  const profiles = (await db.collection('profiles').where('owner', '==', u.uid).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  return { uid: u.uid, kind: doc.exists ? doc.data().kind : 'teen', profiles: profiles.sort((a, b) => a.createdAt - b.createdAt) };
}
export async function renameChild(pid, name) { await db.collection('profiles').doc(pid).update({ name }); }

// Delete everything this account owns (parents can remove their child's data at any time).
export async function deleteAccount() {
  const uid = auth.currentUser.uid, acc = await account();
  const fr = await db.collection('friendships').where('owners', 'array-contains', uid).get();
  const chFrom = await db.collection('challenges').where('fromOwner', '==', uid).get(), chTo = await db.collection('challenges').where('toOwner', '==', uid).get();
  const batch = db.batch(); [...fr.docs, ...chFrom.docs, ...chTo.docs].forEach((d) => batch.delete(d.ref)); await batch.commit();
  for (const p of acc.profiles) { if (p.friendCode) await db.collection('codes').doc(p.friendCode).delete().catch(() => {}); await db.collection('profiles').doc(p.id).collection('private').doc('state').delete().catch(() => {}); await db.collection('profiles').doc(p.id).delete(); }
  await db.collection('users').doc(uid).delete();
  await auth.currentUser.delete();
}

// ---------- training record sync (between your own devices) ----------
export async function loadPrivate(pid) { const d = await db.collection('profiles').doc(pid).collection('private').doc('state').get(); return d.exists ? d.data() : null; }
export async function savePrivate(pid, st) { await db.collection('profiles').doc(pid).collection('private').doc('state').set({ stars: st.stars || {}, best: st.best || {}, days: st.days || {}, history: (st.history || []).slice(0, 100), streak: st.streak || 0, bestStreak: st.bestStreak || 0, lastDay: st.lastDay || null, savedAt: now() }); }
// Combine what's on this device with what's in the account: best stars win, days and history are merged.
export function merge(local, cloud) {
  if (!cloud) return local;
  const out = { ...local }, stars = { ...(cloud.stars || {}) };
  for (const [k, v] of Object.entries(local.stars || {})) stars[k] = Math.max(stars[k] || 0, v);
  const days = { ...(cloud.days || {}) }; for (const [k, v] of Object.entries(local.days || {})) days[k] = Math.max(days[k] || 0, v);
  const seen = new Set(), history = [...(local.history || []), ...(cloud.history || [])].filter((h) => { const key = h.t + h.id; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => b.t - a.t).slice(0, 200);
  const newer = (cloud.lastDay && (!local.lastDay || new Date(cloud.lastDay) > new Date(local.lastDay))) ? cloud : local;
  Object.assign(out, { stars, days, history, best: { ...(cloud.best || {}), ...(local.best || {}) }, streak: newer.streak || 0, lastDay: newer.lastDay || null, bestStreak: Math.max(local.bestStreak || 0, cloud.bestStreak || 0) });
  return out;
}

// ---------- friends ----------
export async function lookupCode(code) {
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^KIK/, '');
  const d = await db.collection('codes').doc(code).get();
  return d.exists ? { code, ...d.data() } : null;
}
export async function sendRequest(me, code) {
  const other = await lookupCode(code);
  if (!other) throw new Error('No player has that friend code. Check it and try again.');
  if (other.pid === me.id) throw new Error('That\'s your own friend code!');
  const id = pairId(me.id, other.pid), ref = db.collection('friendships').doc(id);
  const ex = await ref.get().catch(() => null);
  if (ex && ex.exists) throw new Error(ex.data().status === 'accepted' ? `You're already friends with ${other.name}.` : 'A friend request is already waiting.');
  await ref.set({ members: [me.id, other.pid].sort(), owners: [me.owner, other.owner], names: { [me.id]: me.name, [other.pid]: other.name }, status: 'pending',
    requestedBy: me.id, requestedByOwner: me.owner, createdAt: now(), trained: {}, streak: 0, streakDay: null, stats: { [me.id]: statsOf(me) } });
  return other;
}
const statsOf = (p) => ({ stars: p.stars || 0, streak: p.streak || 0, lastDay: p.lastDay || null, weekKey: p.weekKey || weekKey(), weekStars: p.weekStars || 0 });
export async function accept(me, f) { await db.collection('friendships').doc(f.id).update({ status: 'accepted', acceptedAt: now(), [`stats.${me.id}`]: statsOf(me) }); }
export async function removeFriend(f) { await db.collection('friendships').doc(f.id).delete(); }
// All friendships for one of my players. listen=true keeps the list live.
export function friendships(me, cb) {
  return db.collection('friendships').where('owners', 'array-contains', me.owner).onSnapshot((snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((f) => f.members.includes(me.id)).map((f) => decorate(me, f)));
  }, () => cb([]));
}
// One-off fresh read (for after a drill or when opening the page).
export async function getFriendships(me) {
  const snap = await db.collection('friendships').where('owners', 'array-contains', me.owner).get({ source: 'server' });
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((f) => f.members.includes(me.id)).map((f) => decorate(me, f));
}
// Friend streak as of today: kept alive if you both trained today or yesterday.
export function decorate(me, f) {
  const other = f.members.find((m) => m !== me.id), t = today(), y = yesterday(), tr = f.trained || {};
  const alive = f.streakDay === t || f.streakDay === y, streak = alive ? f.streak || 0 : 0;
  const st = (f.stats || {})[other] || {}, wk = weekKey();
  return { ...f, other, otherName: (f.names || {})[other] || 'Friend', incoming: f.status === 'pending' && f.requestedBy !== me.id,
    streakNow: streak, meToday: tr[me.id] === t, themToday: tr[other] === t, atRisk: alive && f.streakDay === y,
    friend: { stars: st.stars || 0, streak: st.lastDay === t || st.lastDay === y ? st.streak || 0 : 0, weekStars: st.weekKey === wk ? st.weekStars || 0 : 0 } };
}

// ---------- after every finished drill ----------
// Updates my profile summary, every friendship (shared stats + friend streak), and any open challenge for this drill.
export async function recordSession(me, local, session) {
  const t = today(), y = yesterday(), wk = weekKey(), total = Object.values(local.stars || {}).reduce((a, n) => a + n, 0);
  const weekStars = (me.weekKey === wk ? me.weekStars || 0 : 0) + (session.stars || 0);
  const summary = { stars: total, streak: local.streak || 0, bestStreak: Math.max(me.bestStreak || 0, local.bestStreak || 0, local.streak || 0), lastDay: t, weekKey: wk, weekStars, updatedAt: now() };
  await db.collection('profiles').doc(me.id).update(summary);
  Object.assign(me, summary);
  const snap = await db.collection('friendships').where('owners', 'array-contains', me.owner).get();
  const batch = db.batch();
  snap.docs.forEach((d) => { const f = d.data(); if (!f.members.includes(me.id) || f.status !== 'accepted') return;
    const other = f.members.find((m) => m !== me.id), upd = { [`trained.${me.id}`]: t, [`stats.${me.id}`]: statsOf(me) };
    if ((f.trained || {})[other] === t && f.streakDay !== t) { upd.streak = f.streakDay === y ? (f.streak || 0) + 1 : 1; upd.streakDay = t; }
    batch.update(d.ref, upd); });
  await batch.commit();
  // challenges sent to me for this drill
  const done = [];
  const ch = await db.collection('challenges').where('toOwner', '==', me.owner).get();
  for (const d of ch.docs) { const c = d.data(); if (c.to !== me.id || c.status !== 'open' || c.drillId !== session.drillId) continue;
    const beat = session.count != null && session.count >= c.target;
    await d.ref.update(beat ? { status: 'done', result: session.count, doneAt: now() } : { tries: (c.tries || 0) + 1, best: Math.max(c.best || 0, session.count || 0) });
    if (beat) done.push({ id: d.id, ...c, result: session.count }); }
  return { done };
}

// ---------- challenges ----------
export async function sendChallenge(me, f, { drillId, drillName, target, unit, msg }) {
  if (!MESSAGES.includes(msg)) msg = MESSAGES[0];
  const other = f.members.find((m) => m !== me.id), otherOwner = f.owners.find((o) => o !== me.owner) || me.owner;
  await db.collection('challenges').add({ from: me.id, to: other, fromOwner: me.owner, toOwner: otherOwner, fromName: me.name, toName: f.names[other], drillId, drillName, target, unit, msg, status: 'open', createdAt: now() });
}
export function challenges(me, cb) {
  let inc = [], out = [];
  const emit = () => cb({ incoming: inc.filter((c) => c.to === me.id), sent: out.filter((c) => c.from === me.id) });
  const a = db.collection('challenges').where('toOwner', '==', me.owner).onSnapshot((s) => { inc = s.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); }, () => {});
  const b = db.collection('challenges').where('fromOwner', '==', me.owner).onSnapshot((s) => { out = s.docs.map((d) => ({ id: d.id, ...d.data() })); emit(); }, () => {});
  return () => { a(); b(); };
}
export async function getChallenges(me) {
  const [a, b] = await Promise.all([db.collection('challenges').where('toOwner', '==', me.owner).get({ source: 'server' }), db.collection('challenges').where('fromOwner', '==', me.owner).get({ source: 'server' })]);
  return { incoming: a.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.to === me.id), sent: b.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.from === me.id) };
}
export async function dismissChallenge(c) { await db.collection('challenges').doc(c.id).delete(); }
