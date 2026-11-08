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
// All coordinates are divided by the video HEIGHT, so x and y use the same unit
// (y grows downward). Thresholds are scaled by the player's body size, so it
// works whether they stand close to the camera or far away.

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Body size: shoulder centre to ankle centre (about 80% of standing height).
function bodySize(pose, fallback) {
  if (!pose) return fallback;
  const s = dist(mid(pose.ls, pose.rs), mid(pose.la, pose.ra));
  return s > 0.05 ? s : fallback;
}

class Base {
  constructor() { this.count = 0; this.S = 0.6; this.lastBall = null; this.lastBallT = -1e9; }
  scale(o) { this.S = 0.85 * this.S + 0.15 * bodySize(o.pose, this.S); return this.S; }
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

    // Ball resting on the ground near the feet ends the streak.
    if (o.pose) {
      const groundY = Math.max(o.pose.la.y, o.pose.ra.y);
      const still = this.prev && Math.abs(b.y - this.prev.y) < 0.01 * S;
      if (b.y > groundY - 0.02 * S && still) {
        this.groundSince ??= o.t;
        if (o.t - this.groundSince > 500) this.endStreak();
      } else this.groundSince = null;
    }
    this.prev = b;

    const down = 0.05 * S, up = 0.03 * S;
    if (this.state === 'idle') { this.state = 'falling'; this.ext = b.y; }
    else if (this.state === 'rising') {
      if (b.y < this.ext) this.ext = b.y;                 // new peak
      else if (b.y - this.ext > down) { this.state = 'falling'; this.ext = b.y; }
    } else if (this.state === 'falling') {
      if (b.y > this.ext) this.ext = b.y;                 // new low point
      else if (this.ext - b.y > up) {                      // turned upward: a touch
        this.state = 'rising'; this.ext = b.y;
        if (o.t - this.lastHit > 180) { this.lastHit = o.t; this.streak++; this.count++; if (this.streak > this.best) this.best = this.streak; }
      }
    }
    return this.result();
  }
  endStreak() { this.streak = 0; this.state = 'idle'; this.groundSince = null; }
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
  update(o) {
    const S = this.scale(o), b = this.ball(o, 3000);
    if (b) {
      const top = { x: b.x, y: b.y - b.r };
      const inR = Math.max(b.r * 0.9, 0.06 * S);
      if (this.contact(o, top, inR, inR * 1.7, 110)) this.count++;
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
      if (!side && o.pose && this.hist.length === 4 && o.t - this.lastTouch > 320) {
        const [a, , c, d] = this.hist, v1 = { x: c.x - a.x, y: c.y - a.y }, v2 = { x: d.x - c.x, y: d.y - c.y };
        const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
        const near = Math.min(dist(o.pose.lf, b), dist(o.pose.rf, b)) < b.r + 0.15 * S;
        if (near && m1 > 0.01 * S && m2 > 0.01 * S && (v1.x * v2.x + v1.y * v2.y) / (m1 * m2) < 0.35) side = 'x';
      }
      if (side) { this.count++; this.lastTouch = o.t; this.onTouch?.(side, o.t); }
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
    if (b) {
      this.hist.push({ t: o.t, x: b.x, y: b.y }); if (this.hist.length > 3) this.hist.shift();
      this.lastBall = b;
      if (this.pending && this.hist.length >= 2) {
        const a = this.hist[0], z = this.hist[this.hist.length - 1], dt = (z.t - a.t) / 1000;
        const speed = dt > 0 ? Math.hypot(z.x - a.x, z.y - a.y) / dt : 0;
        if (speed > 1.2 * S) {
          let side = this.pending.side;
          if (side === 'x' && o.pose) side = dist(o.pose.lf, this.pending.from || b) < dist(o.pose.rf, this.pending.from || b) ? 'l' : 'r';
          if (!this.foot || side === this.foot) this.count++;
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
    if (o.pose) {
      const h = mid(o.pose.lh, o.pose.rh), x = h.x / width;
      const zone = x < 0.3 ? 'a' : x > 0.7 ? 'b' : null;
      if (zone && this.side && zone !== this.side) this.crossings++;
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
        if (!this.out && off > 0.28) { this.out = true; this.count++; }
        else if (this.out && off < 0.12) this.out = false;
      }
    }
    return { count: this.count };
  }
}

export const COUNTERS = { juggle: JuggleCounter, taps: TapCounter, touches: TouchCounter, kicks: KickCounter, trips: TripCounter, checks: CheckCounter };
export const NEEDS_BALL = { juggle: true, taps: true, touches: true, kicks: true, trips: false, checks: false };
