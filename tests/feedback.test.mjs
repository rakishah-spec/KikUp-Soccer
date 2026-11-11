// Feedback tests: simulated drills -> counters -> buildFeedback. Run: node tests/feedback.test.mjs
import { JuggleCounter, TapCounter, TouchCounter, FrameStats } from '../js/reps.js';
import { buildFeedback } from '../js/feedback.js';
let fails = 0;
const has = (name, fb, part, re, want = true) => { const txt = fb[part].join(' | '); const ok = re.test(txt) === want; if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}\n      ${part}: ${txt}`); };
const dt = 1000 / 15;
const pose = (o = {}) => ({ lf: { x: .45, y: .92 }, rf: { x: .55, y: .92 }, la: { x: .45, y: .9 }, ra: { x: .55, y: .9 }, lk: { x: .45, y: .72 }, rk: { x: .55, y: .72 },
  lh: { x: .45, y: .55 }, rh: { x: .55, y: .55 }, ls: { x: .42, y: .3 }, rs: { x: .58, y: .3 }, nose: { x: .5, y: .2 }, ...o });
const run = (Counter, frameFn, n) => { const c = new Counter(), st = new FrameStats(); let t = 0;
  for (let i = 0; i < n; i++, t += dt) { const o = { t, ...frameFn(i, t) }; st.update(o); c.update(o); } return { events: c.events, frames: st.summary(), c }; };

// Juggling, all with the right foot, ball going way above the head.
{ const per = 600, r = run(JuggleCounter, (i) => { const ph = ((i * dt) % per) / per; return { pose: pose(), ball: { x: .55, y: .9 - .8 * Math.sin(Math.PI * ph), r: .03 } }; }, 12 * per / dt);
  const fb = buildFeedback({ kind: 'juggle', count: r.c.best, target: 40, seconds: 120, age: 2, report: r });
  has('juggling: right foot only -> tells them to use the left', fb, 'fix', /left foot/);
  has('juggling: balls above head -> softer touches', fb, 'fix', /above your head|softer/i); }

// Juggling with both feet, at a good height, kid level.
{ const per = 500; let k = 0; const r = run(JuggleCounter, (i) => { const ph = ((i * dt) % per) / per, n = Math.floor((i * dt + per / 2) / per);  // switch feet at the top of each juggle
    return { pose: pose(), ball: { x: n % 2 ? .45 : .55, y: .9 - .3 * Math.sin(Math.PI * ph), r: .03 } }; }, 10 * per / dt);
  const fb = buildFeedback({ kind: 'juggle', count: r.c.best, target: 6, seconds: 120, age: 0, report: r });
  has('kid juggling: both feet praised in simple words', fb, 'good', /both feet/i);
  has('kid juggling: hit goal', fb, 'good', /did it/i); }

// Toe taps: right foot does almost all of them.
{ const ball = { x: .5, y: .88, r: .035 }; const r = run(TapCounter, (i) => { const k = Math.floor(i / 7), ph = i % 7, side = k % 5 === 0 ? 'l' : 'r', p = pose();
    if (ph >= 2 && ph <= 3) p[side + 'f'] = { x: .5, y: ball.y - ball.r }; return { pose: p, ball }; }, 40 * 7);
  const fb = buildFeedback({ kind: 'taps', count: r.events.length, target: 70, seconds: 30, age: 1, report: r });
  has('toe taps: lazy left foot is called out', fb, 'fix', /left foot/); }

// Tight box: ball keeps rolling far from the feet, player looking down.
{ const r = run(TouchCounter, (i) => { const far = i % 3 !== 0, look = i < 30 ? 0 : 0.1;
    return { pose: pose({ nose: { x: .5, y: i < 30 ? .2 : .29 } }), ball: { x: far ? .9 : .5, y: .88, r: .03 } }; }, 300);
  const fb = buildFeedback({ kind: 'touches', count: 20, target: 110, seconds: 60, age: 2, report: r });
  has('tight box: ball getting away is flagged', fb, 'fix', /got away/);
  has('tight box: head down is flagged', fb, 'fix', /looking down/); }

// Slowing down in the second half.
{ const events = []; for (let i = 0; i < 20; i++) events.push({ t: i * 1500, type: 'rep', side: i % 2 ? 'l' : 'r' }); for (let i = 0; i < 6; i++) events.push({ t: 30000 + i * 5000, type: 'rep', side: 'l' });
  const fb = buildFeedback({ kind: 'kicks', count: 26, target: 40, seconds: 60, age: 2, weakFoot: null, report: { events, frames: { frames: 900, seenPct: .95 } } });
  has('wall passes: slowing down is flagged', fb, 'fix', /slowed down/); }

// Camera lost the player.
{ const fb = buildFeedback({ kind: 'touches', count: 5, target: 90, seconds: 60, age: 1, report: { events: [], frames: { frames: 600, seenPct: .4 } } });
  has('camera lost player: says to move the phone back', fb, 'fix', /move the phone back/i); }

// Perfect session: nothing to fix -> suggests next level, never empty.
{ const events = []; for (let i = 0; i < 40; i++) events.push({ t: i * 700, type: 'rep', side: i % 2 ? 'l' : 'r' });
  const fb = buildFeedback({ kind: 'taps', count: 40, target: 35, seconds: 30, age: 1, report: { events, frames: { frames: 450, seenPct: 1 } } });
  has('great session: suggests next level', fb, 'fix', /next skill level/);
  const ok = fb.good.length > 0 && fb.cue; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} always has praise and a cue: "${fb.cue}"`); }

console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
