// Simulated-movement tests for the rep counters. Run: node tests/reps.test.mjs
import { JuggleCounter, TapCounter, TouchCounter, KickCounter, TripCounter, CheckCounter, MoveCounter, StopCounter, FlickCounter } from '../js/reps.js';
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = (a) => (rnd() - 0.5) * 2 * a;
const FPS = 15, dt = 1000 / FPS;
const pose = (o = {}) => ({ lf: { x: .45, y: .92 }, rf: { x: .55, y: .92 }, la: { x: .45, y: .9 }, ra: { x: .55, y: .9 },
  lh: { x: .45, y: .55 }, rh: { x: .55, y: .55 }, ls: { x: .42, y: .3 }, rs: { x: .58, y: .3 }, nose: { x: .5, y: .2 }, ...o });
let fails = 0;
const check = (name, got, want, tol = 0) => { const ok = Math.abs(got - want) <= tol; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: counted ${got}, expected ${want}${tol ? ' ±' + tol : ''}`); };

// Juggling: 12 juggles (~2.2/s), drop, rest on ground, then 7 more. Best streak = 12.
{ const c = new JuggleCounter(); let t = 0; const per = 450, run = (n, missRate) => {
    for (let i = 0; i < n * per / dt; i++, t += dt) { const ph = ((i * dt) % per) / per; const y = .85 - .3 * Math.sin(Math.PI * ph);
      c.update({ t, pose: pose(), ball: rnd() < missRate ? null : { x: .5 + noise(.01), y: y + noise(.006), r: .03 } }); } };
  run(12, 0.1);
  for (let i = 0; i < 25; i++, t += dt) c.update({ t, pose: pose(), ball: { x: .6, y: .89 + noise(.002), r: .03 } });
  run(7, 0.1); const r = c.update({ t, pose: pose(), ball: null });
  check('juggling best streak', r.best, 12, 1); check('juggling total touches', r.total, 19, 2); }

// Toe taps: alternate feet tap the ball top 40 times in 20s (2 per second).
{ const c = new TapCounter(); let t = 0, n = 0; const ball = { x: .5, y: .88, r: .035 };
  for (let k = 0; k < 40; k++) { const side = k % 2 ? 'r' : 'l';
    for (let i = 0; i < 7; i++, t += dt) { const down = i >= 2 && i <= 3; const p = pose();
      const f = down ? { x: .5 + noise(.005), y: ball.y - ball.r + noise(.005) } : { x: side === 'l' ? .42 : .58, y: .92 };
      p[side + 'f'] = f; n = c.update({ t, pose: p, ball: rnd() < .2 ? null : { ...ball, x: ball.x + noise(.004) } }).count; } }
  check('toe taps', n, 40, 1); }

// Tight box touches: ball shuttles between feet, 30 touches.
{ const c = new TouchCounter(); let t = 0, n = 0;
  for (let k = 0; k < 30; k++) { const from = k % 2 ? .58 : .42, to = k % 2 ? .42 : .58;
    for (let i = 0; i < 6; i++, t += dt) { const x = from + (to - from) * (i / 5);
      n = c.update({ t, pose: pose({ lf: { x: .42, y: .9 }, rf: { x: .58, y: .9 } }), ball: rnd() < .1 ? null : { x: x + noise(.005), y: .88, r: .03 } }).count; } }
  check('tight box touches', n, 30, 3); }

// Wall passes: 15 passes. Ball rolls in slowly, gets controlled, then kicked away fast.
const passes = (foot, strongKicks = 0) => { const c = new KickCounter({ foot }); let t = 0, n = 0;
  for (let k = 0; k < 15 + strongKicks; k++) { const kicker = k < 15 ? (foot || 'r') : 'r', fx = kicker === 'l' ? .42 : .58;
    const frames = [];
    for (let i = 0; i < 10; i++) frames.push({ x: fx + .6 - .6 * (i / 9), y: .88 });   // rolls back in
    for (let i = 0; i < 4; i++) frames.push({ x: fx + .01, y: .88 });                    // controlled
    for (let i = 0; i < 6; i++) frames.push({ x: fx + .15 * (i + 1), y: .88 });          // kicked away
    for (const b of frames) { t += dt; n = c.update({ t, pose: pose(), ball: { x: b.x + noise(.004), y: b.y, r: .03 } }).count; } }
  return n; };
check('wall passes (any foot)', passes(null), 15, 1);
check('weak foot only counts left foot (5 right-foot kicks ignored)', passes('l', 5), 15, 1);

// Cone dribble: 4 trips across the frame and back.
{ const c = new TripCounter(); let t = 0, n = 0;
  for (let k = 0; k < 8; k++) for (let i = 0; i < 30; i++, t += dt) { const p = i / 29, x = k % 2 ? .9 - .8 * p : .1 + .8 * p;
    n = c.update({ t, pose: pose({ lh: { x: x - .03, y: .55 }, rh: { x: x + .03, y: .55 } }) }).count; }
  check('cone dribble trips', n, 4); }

// Shoulder checks: 10 head turns, alternating sides.
{ const c = new CheckCounter(); let t = 0, n = 0;
  for (let k = 0; k < 10; k++) for (let i = 0; i < 12; i++, t += dt) { const turn = i >= 4 && i <= 7, dir = k % 2 ? 1 : -1;
    n = c.update({ t, pose: pose({ nose: { x: .5 + (turn ? dir * .07 : 0) + noise(.004), y: .2 } }) }).count; }
  check('shoulder checks', n, 10); }


// Skill moves (cuts, step-overs...): 6 reps of dribble forward, burst off sideways, stop, walk the ball back.
{ const c = new MoveCounter(); let t = 0, n = 0; const step = (x, y) => { t += dt; n = c.update({ t, pose: pose(), ball: { x: x + noise(.004), y: y + noise(.004), r: .03 } }).count; };
  for (let k = 0; k < 6; k++) { const side = k % 2 ? 1 : -1;
    for (let i = 0; i <= 15; i++) step(.5, .9 - .3 * i / 15);                      // dribble at the cone (1s)
    for (let i = 1; i <= 8; i++) step(.5 + side * .45 * i / 8, .6 - .05 * i / 8);   // the move: burst off sideways (0.5s)
    for (let i = 0; i < 30; i++) step(.5 + side * .45, .55);                        // stop the ball (2s)
    for (let i = 1; i <= 45; i++) step(.5 + side * .45 * (1 - i / 45), .55 + .35 * i / 45); } // walk it back (3s)
  check('skill moves (direction changes)', n, 6); }

// Sole stop: ball rolled in, stopped under the foot, 8 times.
{ const c = new StopCounter(); let t = 0, n = 0;
  for (let k = 0; k < 8; k++) { for (let i = 0; i <= 12; i++, t += dt) n = c.update({ t, pose: pose(), ball: { x: .55, y: .4 + .48 * i / 12, r: .03 } }).count;
    for (let i = 0; i < 20; i++, t += dt) n = c.update({ t, pose: pose(), ball: { x: .55 + noise(.002), y: .88 + noise(.002), r: .03 } }).count; }
  check('sole stops', n, 8); }

// Rainbow flick: ball goes over the head 5 times.
{ const c = new FlickCounter(); let t = 0, n = 0;
  for (let k = 0; k < 5; k++) for (let i = 0; i < 30; i++, t += dt) { const u = i / 29; n = c.update({ t, pose: pose(), ball: { x: .45 + .4 * u, y: .88 - .8 * Math.sin(Math.PI * u), r: .03 } }).count; }
  check('rainbow flicks', n, 5); }

// Standing still with a noisy ball should count nothing.
{ const cs = [new JuggleCounter(), new TapCounter(), new TouchCounter(), new KickCounter(), new MoveCounter(), new StopCounter(), new FlickCounter()]; let t = 0; const out = cs.map(() => 0);
  for (let i = 0; i < 300; i++, t += dt) cs.forEach((c, j) => out[j] = c.update({ t, pose: pose(), ball: { x: .7 + noise(.006), y: .88 + noise(.006), r: .03 } }).count);
  check('no false reps while idle (juggle)', out[0], 0); check('no false reps while idle (taps)', out[1], 0);
  check('no false reps while idle (touches)', out[2], 0); check('no false reps while idle (kicks)', out[3], 0);
  check('no false reps while idle (skill moves)', out[4], 0); check('no false reps while idle (sole stop)', out[5], 0); check('no false reps while idle (flick)', out[6], 0); }

console.log(fails ? `\n${fails} FAILED` : '\nAll passed'); process.exit(fails ? 1 : 0);
