// KikUp rep counting logic.
// Pure functions of per-frame observations, so it can be tested without a camera.
//
// Each frame the camera code passes an observation:
//   { t: ms,
//     ball: {x, y, r} | null,             // ball centre and radius
//     pose: { lf, rf,                     // left / right foot tip  {x, y}
//             la, ra,                     // left / right ankle
//             lh, rh,                     // hips
//             ls, rs,                     // shoulders
//             nose } | null }
// pose is null when no body is found (e.g. only the feet are in the picture); counters then
// work from the ball alone. pose.upper is false when the head and shoulders are out of view.
// All coordinates are divided by the video HEIGHT, so x and y use the same unit
// (y grows downward). Thresholds are scaled by the player's body size, so it
// works whether they stand close to the camera or far away.

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Body size: shoulder centre to ankle centre (about 80% of standing height).
function bodySize(pose, fallback) {
  if (!pose) return fallback;
  let s = dist(mid(pose.ls, pose.rs), mid(pose.la, pose.ra));
  if (pose.upper === false) s = pose.lk && pose.rk ? dist(mid(pose.lk, pose.rk), mid(pose.la, pose.ra)) * 3.2 : dist(mid(pose.lh, pose.rh), mid(pose.la, pose.ra)) * 1.6;
  return s > 0.05 ? s : fallback;
}

class Base {
  constructor() { this.count = 0; this.S = 0.6; this.lastBall = null; this.lastBallT = -1e9; this.events = []; }
  // Player size sets every threshold. Feet-only framing with no body found: estimate it from the ball (about a tenth of it).
  scale(o) { const s = o.pose ? bodySize(o.pose, this.S) : o.ball ? o.ball.r * 9 : this.S; this.S = 0.85 * this.S + 0.15 * s; return this.S; }
  ball(o, holdMs = 400) {
    if (o.ball) { this.lastBall = o.ball; this.lastBallT = o.t; return o.ball; }
    return o.t - this.lastBallT < holdMs ? this.lastBall : null;
  }
}

// JUGGLING: a juggle is the ball falling, then rising again (it bounced off a
// foot, thigh or head). Uses hysteresis so detection noise doesn't add reps.
// The streak ends when the ball stops near the ground or disappears.
export class JuggleCounter extends Base {
  constructor() { super(); this.streak = 0; this.best = 0; this.state = 'idle'; this.ext = null; this.lastHit = -1e9; this.groundSince = null; }
  update(o) {
    const S = this.scale(o), b = o.ball;
    if (!b) {
      if (o.t - this.lastBallT > 1500) this.endStreak();
      return this.result();
    }
    if (this.lastBall && o.t - this.lastBallT > 1500) this.endStreak();
    this.lastBall = b; this.lastBallT = o.t;

    // Ball resting on the ground near the feet ends the streak. Feet not in view: any still ball does.
    if (!o.pose) {
      const still = this.prev && Math.abs(b.y - this.prev.y) < 0.01 * S && Math.abs(b.x - this.prev.x) < 0.01 * S;
      if (still) { this.groundSince ??= o.t; if (o.t - this.groundSince > 700) this.endStreak(); } else this.groundSince = null;
    } else {
      const groundY = Math.max(o.pose.la.y, o.pose.ra.y);
      const still = this.prev && Math.abs(b.y - this.prev.y) < 0.01 * S;
      if (b.y > groundY - 0.02 * S && still) {
        this.groundSince ??= o.t;
        if (o.t - this.groundSince > 500) this.endStreak();
      } else this.groundSince = null;
    }
    this.prev = b; if (o.pose) this.lastPose = o.pose;

    const down = 0.05 * S, up = 0.03 * S;
    if (this.state === 'idle') { this.state = 'falling'; this.ext = b.y; this.lowBall = b; }
    else if (this.state === 'rising') {
      if (b.y < this.ext) this.ext = b.y;                 // new peak
      else if (b.y - this.ext > down) {                  // peak passed: note how high the juggle went
        const ev = this.events[this.events.length - 1], P = o.pose || this.lastPose;
        if (ev && ev.type === 'rep' && ev.peak == null && P && P.upper !== false) ev.peak = { aboveHead: this.ext < P.nose.y, aboveHip: this.ext < mid(P.lh, P.rh).y };
        this.state = 'falling'; this.ext = b.y; this.lowBall = b;
      }
    } else if (this.state === 'falling') {
      if (b.y > this.ext) { this.ext = b.y; this.lowBall = b; } // new low point (where the touch happens)
      else if (this.ext - b.y > up) {                      // turned upward: a touch
        this.state = 'rising'; this.ext = b.y;
        if (o.t - this.lastHit > 180) { this.lastHit = o.t; this.streak++; this.count++; if (this.streak > this.best) this.best = this.streak;
          this.events.push({ t: o.t, type: 'rep', ...surfaceOf(o.pose || this.lastPose, this.lowBall || b) }); }
      }
    }
    return this.result();
  }
  endStreak() { if (this.streak > 0) this.events.push({ t: this.lastBallT, type: 'drop', streak: this.streak }); this.streak = 0; this.state = 'idle'; this.groundSince = null; }
  result() { return { count: this.best, streak: this.streak, best: this.best, total: this.count }; }
}

// Foot-near-ball detector shared by toe taps, touches and kicks.
class FootContact extends Base {
  constructor(opts = {}) { super(); this.inside = { l: false, r: false }; this.lastT = { l: -1e9, r: -1e9 }; this.opts = opts; }
  // Returns 'l' or 'r' when a foot newly arrives at the ball this frame.
  contact(o, target, inR, outR, cooldown) {
    if (!o.pose || !target) return null;
    let hit = null;
    for (const side of ['l', 'r']) {
      const f = o.pose[side + 'f'], d = dist(f, target);
      if (!this.inside[side] && d < inR) {
        this.inside[side] = true;
        if (o.t - this.lastT[side] > cooldown) { this.lastT[side] = o.t; hit = hit || side; }
      } else if (this.inside[side] && d > outR) this.inside[side] = false;
    }
    return hit;
  }
}

// TOE TAPS: the sole of a foot comes down onto the top of the ball.
export class TapCounter extends FootContact {
  constructor(o) { super(o); this.motion = false; this.lastMotion = -1e9; }
  update(o) {
    const S = this.scale(o), b = this.ball(o, 3000);
    if (b) {
      const top = { x: b.x, y: b.y - b.r };
      const inR = Math.max(b.r * 0.9, 0.06 * S);
      let side = this.contact(o, top, inR, inR * 1.7, 110);
      if (!o.pose && o.tap != null) {                       // no feet found: a burst of movement right on top of the ball is a tap
        if (!this.motion && o.tap > 16 && o.t - this.lastMotion > 110) { this.motion = true; this.lastMotion = o.t; side = 'x'; }
        else if (this.motion && o.tap < 7) this.motion = false;
      }
      if (side) { this.count++; this.events.push({ t: o.t, type: 'rep', side: side === 'x' ? null : side }); }
    }
    return { count: this.count };
  }
}

// TOUCHES (tight box): a foot arrives at the ball, or the ball changes
// direction sharply right next to a foot.
export class TouchCounter extends FootContact {
  constructor(o) { super(o); this.hist = []; this.lastTouch = -1e9; }
  update(o) {
    const S = this.scale(o), b = this.ball(o, 300);
    if (b) {
      const inR = b.r + 0.07 * S;
      let side = this.contact(o, b, inR, b.r + 0.12 * S, 150);
      this.hist.push({ t: o.t, x: b.x, y: b.y }); if (this.hist.length > 4) this.hist.shift();
      if (!side && this.hist.length === 4 && o.t - this.lastTouch > 320) {
        const [a, , c, d] = this.hist, v1 = { x: c.x - a.x, y: c.y - a.y }, v2 = { x: d.x - c.x, y: d.y - c.y };
        const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
        const near = !o.pose || Math.min(dist(o.pose.lf, b), dist(o.pose.rf, b)) < b.r + 0.15 * S;
        const minMove = (o.pose ? 0.01 : 0.03) * S;          // without feet to compare against, ignore small jitter
        if (near && m1 > minMove && m2 > minMove && (v1.x * v2.x + v1.y * v2.y) / (m1 * m2) < 0.35) side = 'x';
      }
      if (side) {
        if (side === 'x') side = o.pose ? (dist(o.pose.lf, b) < dist(o.pose.rf, b) ? 'l' : 'r') : null;
        this.count++; this.lastTouch = o.t; this.events.push({ t: o.t, type: 'rep', side }); this.onTouch?.(side, o.t);
      }
    }
    return { count: this.count };
  }
}

// PASSES / KICKS: a touch followed within 0.45s by the ball moving away fast.
// With opts.foot = 'l' or 'r', only kicks with that foot count (weak foot drill).
export class KickCounter extends Base {
  constructor(opts = {}) {
    super(); this.foot = opts.foot || null; this.touch = new TouchCounter(); this.pending = null; this.hist = [];
    this.touch.onTouch = (side, t) => { this.pending = { side, t, from: this.lastBall }; };
  }
  update(o) {
    const S = this.scale(o); this.touch.update(o);
    const b = o.ball;
    if (!o.pose && b) {                                   // feet not tracked: a pass is the ball bursting off after slowing or reversing
      (this.bh ??= []).push({ t: o.t, x: b.x, y: b.y }); while (this.bh.length > 2 && o.t - this.bh[0].t > 600) this.bh.shift();
      const near = (ms) => this.bh.reduce((a, p) => Math.abs(p.t - (o.t - ms)) < Math.abs(a.t - (o.t - ms)) ? p : a, this.bh[0]);
      const a0 = near(450), a1 = near(150);
      if (a1.t - a0.t > 100 && o.t - a1.t > 60) {
        const v0 = { x: (a1.x - a0.x) / ((a1.t - a0.t) / 1000), y: (a1.y - a0.y) / ((a1.t - a0.t) / 1000) }, v1 = { x: (b.x - a1.x) / ((o.t - a1.t) / 1000), y: (b.y - a1.y) / ((o.t - a1.t) / 1000) };
        // s0 from the distance actually travelled, so a bounce (out and back) doesn't look like a slow, controlled ball
        let path = 0, prev = null; for (const p of this.bh) { if (p.t < a0.t || p.t > a1.t) continue; if (prev) path += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
        const s0 = path / ((a1.t - a0.t) / 1000), s1 = Math.hypot(v1.x, v1.y), rev = Math.hypot(v0.x, v0.y) > 0.3 * S && (v0.x * v1.x + v0.y * v1.y) < 0;
        if (s0 < 0.5 * S) this.home = this.home ? { x: .9 * this.home.x + .1 * a1.x, y: .9 * this.home.y + .1 * a1.y } : { x: a1.x, y: a1.y };   // where the ball gets controlled = the player's end
        const atHome = this.home && Math.hypot(a1.x - this.home.x, a1.y - this.home.y) < 6 * b.r;
        if (s1 > 1.2 * S && (s0 < 0.5 * S || (rev && atHome)) && o.t - (this.lastKick || -1e9) > 400) { this.lastKick = o.t; this.count++; this.events.push({ t: o.t, type: 'rep', side: null }); }
      }
      return { count: this.count };
    }
    if (b) {
      this.hist.push({ t: o.t, x: b.x, y: b.y }); if (this.hist.length > 3) this.hist.shift();
      this.lastBall = b;
      if (this.pending && this.hist.length >= 2) {
        const a = this.hist[0], z = this.hist[this.hist.length - 1], dt = (z.t - a.t) / 1000;
        const speed = dt > 0 ? Math.hypot(z.x - a.x, z.y - a.y) / dt : 0;
        if (speed > 1.2 * S) {
          let side = this.pending.side;
          if (side === 'x' && o.pose) side = dist(o.pose.lf, this.pending.from || b) < dist(o.pose.rf, this.pending.from || b) ? 'l' : 'r';
          if (!this.foot || side === this.foot || side == null) { this.count++; this.events.push({ t: o.t, type: 'rep', side }); }
          else this.events.push({ t: o.t, type: 'other-foot', side });
          this.pending = null;
        }
      }
    }
    if (this.pending && o.t - this.pending.t > 450) this.pending = null;
    return { count: this.count };
  }
}

// CONE DRIBBLE TRIPS: with the camera side-on, the player crosses from one end
// of the picture to the other and back. One trip = there and back.
export class TripCounter extends Base {
  constructor() { super(); this.side = null; this.crossings = 0; }
  update(o, width = 1) {
    const at = o.pose ? mid(o.pose.lh, o.pose.rh) : o.ball;     // feet-only framing: follow the ball instead
    if (at) {
      const x = at.x / width;
      const zone = x < 0.3 ? 'a' : x > 0.7 ? 'b' : null;
      if (zone && this.side && zone !== this.side) { this.crossings++; this.events.push({ t: o.t, type: 'cross' }); if (this.crossings % 2 === 0) this.events.push({ t: o.t, type: 'rep' }); }
      if (zone) this.side = zone;
      this.count = Math.floor(this.crossings / 2);
    }
    return { count: this.count, half: this.crossings % 2 === 1 };
  }
}

// SHOULDER CHECKS: facing the camera, turning the head moves the nose toward
// one shoulder. Each turn out (and back) is one check.
export class CheckCounter extends Base {
  constructor() { super(); this.out = false; }
  update(o) {
    if (o.pose) {
      const m = mid(o.pose.ls, o.pose.rs), w = Math.abs(o.pose.ls.x - o.pose.rs.x);
      if (w > 0.02) {
        const off = Math.abs(o.pose.nose.x - m.x) / w;
        if (!this.out && off > 0.28) { this.out = true; this.count++; this.events.push({ t: o.t, type: 'rep', dir: o.pose.nose.x < m.x ? 'a' : 'b' }); }
        else if (this.out && off < 0.12) this.out = false;
      }
    }
    return { count: this.count };
  }
}


// SKILL MOVES that change direction (cuts, step-overs, elastico, pull-back...):
// a rep is the ball travelling one way, then bursting off at least 60° another way.
// A pause after each rep stops the walk back with the ball from counting.
export class MoveCounter extends Base {
  constructor() { super(); this.hist = []; this.lastRep = -1e9; }
  // Ball displacement between two moments ago (ms), from the recent history.
  at(t) { const h = this.hist; let best = h[0]; for (const p of h) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; return best; }
  update(o) {
    const S = this.scale(o), b = o.ball; if (!b) return { count: this.count };
    this.hist.push({ t: o.t, x: b.x, y: b.y }); while (this.hist.length > 2 && o.t - this.hist[0].t > 600) this.hist.shift();
    if (o.t - this.hist[0].t < 450) return { count: this.count };
    const a = this.at(o.t - 500), m = this.at(o.t - 250);
    const v1 = { x: (m.x - a.x) / .25, y: (m.y - a.y) / .25 }, v2 = { x: (b.x - m.x) / .25, y: (b.y - m.y) / .25 };
    const s1 = Math.hypot(v1.x, v1.y), s2 = Math.hypot(v2.x, v2.y);
    if (s1 > 0.15 * S && s2 > 0.8 * S && o.t - this.lastRep > 1200) {      // was moving, now bursting away fast...
      const turn = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (s1 * s2)))) * 180 / Math.PI;
      if (turn > 60) { this.count++; this.lastRep = o.t; this.events.push({ t: o.t, type: 'rep', turn: Math.round(turn) }); }   // ...in a new direction
    }
    return { count: this.count };
  }
}

// SOLE STOP: the ball is rolling, then stops dead next to a foot.
export class StopCounter extends Base {
  constructor() { super(); this.hist = []; this.moving = false; this.stopSince = null; }
  update(o) {
    const S = this.scale(o), b = o.ball; if (!b) return { count: this.count };
    this.hist.push({ t: o.t, x: b.x, y: b.y }); while (this.hist.length > 2 && o.t - this.hist[0].t > 300) this.hist.shift();
    const a = this.hist[0], dt = (o.t - a.t) / 1000, speed = dt > 0 ? Math.hypot(b.x - a.x, b.y - a.y) / dt : 0;
    if (speed > 0.5 * S) { this.moving = true; this.stopSince = null; }
    else if (this.moving && speed < 0.08 * S) {
      this.stopSince ??= o.t;
      const nearFoot = !o.pose || Math.min(dist(o.pose.lf, b), dist(o.pose.rf, b)) < b.r + 0.12 * S;
      if (o.t - this.stopSince > 250 && nearFoot) { this.count++; this.moving = false; this.events.push({ t: o.t, type: 'rep' }); }
    }
    return { count: this.count };
  }
}

// RAINBOW FLICK: the ball goes up over the player's head.
export class FlickCounter extends Base {
  constructor() { super(); this.up = false; }
  update(o) {
    const b = o.ball, P = o.pose || this.lastPose; if (o.pose) this.lastPose = o.pose;
    if (b && (!P || P.upper === false)) {                  // head not in view: ball rising far above where it rests
      if (this.rest == null || b.y > this.rest) this.rest = b.y; else this.rest -= 0.0005;   // resting level = lowest the ball goes, slowly forgotten
      if (!this.up && b.y < this.rest - 12 * b.r) { this.up = true; this.count++; this.events.push({ t: o.t, type: 'rep' }); }
      else if (this.up && b.y > this.rest - 3 * b.r) this.up = false;
    } else if (b && P) {
      const headY = P.nose.y;
      if (!this.up && b.y < headY) { this.up = true; this.count++; this.events.push({ t: o.t, type: 'rep' }); }
      else if (this.up && b.y > mid(P.lh, P.rh).y) this.up = false;          // back down below the hips: ready for the next one
    }
    return { count: this.count };
  }
}

// Which body part hit the ball: the closest of foot, thigh (knee) or head.
function surfaceOf(P, b) {
  if (!P) return { surface: 'foot', side: null };
  const c = [['foot', 'l', P.lf], ['foot', 'r', P.rf]]; if (P.upper !== false) c.push(['head', null, P.nose]);
  if (P.lk) c.push(['thigh', 'l', P.lk]); if (P.rk) c.push(['thigh', 'r', P.rk]);
  let best = c[0], bd = 1e9;
  for (const x of c) { const d = dist(x[2], b); if (d < bd) { bd = d; best = x; } }
  return { surface: best[0], side: best[1] };
}

// Per-frame stats for feedback: was the player in view, did the ball stay close
// to the feet, and how often was the head down.
export class FrameStats {
  constructor() { this.frames = 0; this.seen = 0; this.ballSeen = 0; this.near = 0; this.far = 0; this.heads = []; this.S = 0.6; }
  update(o) {
    this.frames++;
    if (o.ball) this.ballSeen++;
    if (o.pose || o.ball) this.seen++;
    const P = o.pose; if (!P) return;
    this.S = 0.9 * this.S + 0.1 * bodySize(P, this.S);
    if (o.ball && o.ball.y > mid(P.lh, P.rh).y) {        // ball at ground level
      const d = Math.min(dist(P.lf, o.ball), dist(P.rf, o.ball)) / this.S;
      if (d > 0.45) this.far++; else this.near++;
    }
    const w = Math.abs(P.ls.x - P.rs.x);
    if (w > 0.02 && P.upper !== false) this.heads.push((mid(P.ls, P.rs).y - P.nose.y) / w);
  }
  summary() {
    let headDown = null;
    if (this.heads.length > 20) {                         // head-up height = 85th percentile of the session
      // A floor of 0.45 catches players who looked down the whole time.
      const h = [...this.heads].sort((a, b) => a - b), up = Math.max(0.45, h[Math.floor(h.length * 0.85)]);
      headDown = this.heads.filter((r) => r < up - 0.25).length / this.heads.length;
    }
    const low = this.near + this.far;
    return { frames: this.frames, seenPct: this.frames ? this.seen / this.frames : 0, ballSeenPct: this.frames ? this.ballSeen / this.frames : 0,
      farPct: low > 20 ? this.far / low : null, headDownPct: headDown };
  }
}

export const COUNTERS = { juggle: JuggleCounter, taps: TapCounter, touches: TouchCounter, kicks: KickCounter, trips: TripCounter, checks: CheckCounter,
  cut: MoveCounter, stop: StopCounter, flick: FlickCounter };
export const NEEDS_BALL = { juggle: true, taps: true, touches: true, kicks: true, trips: true, checks: false, cut: true, stop: true, flick: true };
