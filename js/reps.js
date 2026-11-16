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

// TOE TAPS: each foot keeps lifting up onto the top of the ball and back down.
// Feet tracked: a tap is a foot rising by about half the ball's height above where that foot
// rests, close to the ball (the toe point can land anywhere on top of it).
// Feet not tracked: each burst of movement just above the ball is a tap (peaks, not "calm then busy",
// because during fast taps there are no calm moments).
export class TapCounter extends FootContact {
  constructor(o) { super(o); this.feet = { l: null, r: null }; this.e = []; this.lastPeak = -1e9; }
  update(o) {
    const S = this.scale(o), b = this.ball(o, 3000);
    if (!b) return { count: this.count };
    let side = null;
    if (o.pose) {
      for (const sd of ['l', 'r']) {
        const f = o.pose[sd + 'f'], st = this.feet[sd] ??= { y: f.y, hist: [], up: false, last: -1e9 };
        st.y = 0.5 * st.y + 0.5 * f.y;                                             // smooth the tracker's jitter
        st.hist.push({ t: o.t, y: st.y }); while (st.hist.length > 2 && o.t - st.hist[0].t > 1200) st.hist.shift();
        const ground = Math.max(...st.hist.map((h) => h.y)), lift = ground - st.y, near = Math.abs(f.x - b.x) < 3.5 * b.r;
        if (!st.up && lift > 1.0 * b.r && near) { st.up = true; if (o.t - st.last > 140) { st.last = o.t; side = side || sd; } }
        else if (st.up && lift < 0.45 * b.r) st.up = false;
      }
    } else if (o.tap != null) {
      this.e.push({ t: o.t, v: o.tap }); while (this.e.length > 40) this.e.shift();
      const n = this.e.length;
      if (n >= 3) {
        const prev = this.e[n - 2].v, base = [...this.e].map((x) => x.v).sort((a, c) => a - c)[Math.floor(n * 0.3)];   // typical quiet level
        if (prev > this.e[n - 3].v && prev >= this.e[n - 1].v && prev > Math.max(12, base * 1.35) && o.t - this.lastPeak > 150) { this.lastPeak = o.t; side = 'x'; }
      }
    }
    if (side) { this.count++; this.events.push({ t: o.t, type: 'rep', side: side === 'x' ? null : side }); }
    return { count: this.count };
  }
}

// SOLE ROLLS and SIDE-TO-SIDE TAPS: the ball goes left and right between the feet.
// Each change of direction (by at least half the ball's width) is one roll or tap.
export class RollCounter extends Base {
  constructor() { super(); this.x = null; this.dir = 0; this.ext = null; this.lastRep = -1e9; }
  update(o) {
    this.scale(o); const b = o.ball; if (!b) return { count: this.count };
    this.x = this.x == null ? b.x : 0.5 * this.x + 0.5 * b.x;
    const k = 0.5 * b.r;
    if (this.ext == null) { this.ext = this.x; return { count: this.count }; }
    if (this.dir === 1 && this.x > this.ext) this.ext = this.x;            // furthest point so far this way
    if (this.dir === -1 && this.x < this.ext) this.ext = this.x;
    if (this.dir === 0 && Math.abs(this.x - this.ext) > k) { this.dir = this.x > this.ext ? 1 : -1; this.ext = this.x; }
    else if ((this.dir === 1 && this.ext - this.x > k) || (this.dir === -1 && this.x - this.ext > k)) {
      this.dir = -this.dir; this.ext = this.x;
      if (o.t - this.lastRep > 120) { this.lastRep = o.t; this.count++; this.events.push({ t: o.t, type: 'rep' }); }
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

// PASSES / KICKS / SHOTS / THROWS.
// A pass counts when the ball (1) was settled at the player's feet, or turned around right at them
// (one-touch), then (2) travels a real distance away (about 4-5 ball widths), moving away the whole time.
// It can't count again until the ball has come back and settled. Ball positions are median-filtered
// first, so a single jumpy detection can't look like a kick, and a short set-up touch isn't a pass.
// With opts.foot = 'l' or 'r', only passes by that foot count (weak foot drill).
export class KickCounter extends Base {
  constructor(opts = {}) { super(); this.foot = opts.foot || null; this.sideways = !!opts.sideways; this.raw = []; this.hist = []; this.armed = false; this.anchor = null; this.home = null; this.lastKick = -1e9; this.near = []; }
  update(o) {
    const S = this.scale(o), b = o.ball;
    if (!b) return { count: this.count };
    // median of the last 3 detections: removes single-frame jumps
    this.raw.push(b); if (this.raw.length > 3) this.raw.shift();
    const med = (k) => [...this.raw].map((p) => p[k]).sort((a, c) => a - c)[Math.floor(this.raw.length / 2)];
    const p = { t: o.t, x: med('x'), y: med('y') }, r = Math.max(med('r'), 0.01);
    this.hist.push(p); while (this.hist.length > 2 && o.t - this.hist[0].t > 600) this.hist.shift();
    // which foot is closest to the ball right now (for the weak-foot check)
    if (o.pose) { const dl = dist(o.pose.lf, p), dr = dist(o.pose.rf, p); this.near.push({ t: o.t, side: dl < dr ? 'l' : 'r', d: Math.min(dl, dr) }); while (this.near.length > 1 && o.t - this.near[0].t > 500) this.near.shift(); }
    const recent = this.hist.filter((h) => o.t - h.t <= 260);
    let path = 0; for (let k = 1; k < recent.length; k++) path += Math.hypot(recent[k].x - recent[k - 1].x, recent[k].y - recent[k - 1].y);
    const span = recent.length > 1 ? (recent[recent.length - 1].t - recent[0].t) / 1000 : 0, speed = span > 0 ? path / span : 0;
    const settled = recent.length >= 3 && span >= 0.15 && speed < 1.0 * S;   // a real moment of (near) stillness, not just the first frame
    // at the feet: judged on the raw detections, since smoothing can hide the instant the ball bounces off a foot
    const atFeet = o.pose && this.raw.some((q) => Math.min(dist(o.pose.lf, q), dist(o.pose.rf, q)) < 3.5 * r);
    // (1) get ready: the ball is settled, or at the player's feet, or at their usual spot (feet not tracked).
    //     While it's there, keep the starting point up to date: the pass is measured from where it leaves.
    const atHome = this.home && Math.hypot(p.x - this.home.x, p.y - this.home.y) < 4 * r;
    // Once the ball is on its way out, the starting point stays put (so passing the other foot doesn't move it).
    const refNow = o.pose ? (this.armed && this.armSide ? o.pose[this.armSide + 'f'] : (dist(o.pose.lf, p) < dist(o.pose.rf, p) ? o.pose.lf : o.pose.rf)) : this.home, prevH = this.hist[this.hist.length - 2];
    const coming = !refNow || !prevH || Math.hypot(p.x - refNow.x, p.y - refNow.y) <= Math.hypot(prevH.x - refNow.x, prevH.y - refNow.y) + 0.2 * r;
    // A ball resting far from a tracked player (by the wall, in the net, in their hands) isn't ready to be passed.
    const nearPlayer = !o.pose || Math.min(dist(o.pose.lf, p), dist(o.pose.rf, p)) < 6 * r;
    if ((settled && nearPlayer) || ((atFeet || atHome) && (coming || !this.armed))) {
      this.armed = true; this.anchor = { x: p.x, y: p.y };
      if (o.pose) this.armSide = dist(o.pose.lf, p) < dist(o.pose.rf, p) ? 'l' : 'r';   // the foot it's at = the foot that passes
      if (settled) this.home = this.home ? { x: .8 * this.home.x + .2 * p.x, y: .8 * this.home.y + .2 * p.y } : { x: p.x, y: p.y };
    }
    // (2) fire: far from where it was settled, and still moving away
    if (this.armed && this.anchor && this.hist.length >= 3 && o.t - this.lastKick > 400) {
      const d = (h) => Math.hypot(h.x - this.anchor.x, h.y - this.anchor.y), n = this.hist.length;
      const away = n >= 3 && d(this.hist[n - 1]) > d(this.hist[n - 2]) && d(this.hist[n - 2]) > d(this.hist[n - 3]);
      // ...and moving away from the player: their feet, or where they usually control the ball (a rebound coming back never counts)
      const ref = o.pose ? (dist(o.pose.lf, p) < dist(o.pose.rf, p) ? o.pose.lf : o.pose.rf) : this.home;
      const fromPlayer = !ref || (Math.hypot(p.x - ref.x, p.y - ref.y) > Math.hypot(this.hist[n - 2].x - ref.x, this.hist[n - 2].y - ref.y) && Math.hypot(p.x - ref.x, p.y - ref.y) > 3 * r);
      const forward = !this.sideways || Math.abs(p.x - this.anchor.x) > 3 * r;   // volleys: tossing it straight up isn't the kick
      if (d(p) > 4.5 * r && away && fromPlayer && forward) {
        this.armed = false; this.lastKick = o.t;
        const side = o.pose ? (this.armSide || null) : null;
        if (!this.foot || side == null || side === this.foot) { this.count++; this.events.push({ t: o.t, type: 'rep', side }); }
        else this.events.push({ t: o.t, type: 'other-foot', side });
      }
    }
    return { count: this.count };
  }
}

// CONE DRIBBLE TRIPS: with the camera side-on, the player crosses from one end
// of the picture to the other and back. One trip = there and back.
export class TripCounter extends Base {
  constructor(opts = {}) { super(); this.side = null; this.crossings = 0; this.lo = null; this.hi = null; this.followBall = !!opts.followBall; }
  update(o, width = 1) {
    // Follow the hips (or the ball when no body is found, or always for figure 8s)
    const at = this.followBall ? (o.ball || (o.pose && mid(o.pose.lh, o.pose.rh))) : (o.pose ? mid(o.pose.lh, o.pose.rh) : o.ball);
    if (at) {
      const x = at.x / width;
      // Learn how far left and right they actually go, so short courses (two close cones) still count.
      if (this.lo == null) { this.lo = this.hi = x; } else { this.lo = Math.min(this.lo + 0.0004, x); this.hi = Math.max(this.hi - 0.0004, x); }
      const span = this.hi - this.lo, wide = span > 0.12;
      const zone = wide ? (x < this.lo + span * 0.25 ? 'a' : x > this.hi - span * 0.25 ? 'b' : null) : (x < 0.3 ? 'a' : x > 0.7 ? 'b' : null);
      if (zone && this.side && zone !== this.side) { this.crossings++; this.events.push({ t: o.t, type: 'cross' }); if (this.crossings % 2 === 0) this.events.push({ t: o.t, type: 'rep' }); }
      if (zone) this.side = zone;
      this.count = Math.floor(this.crossings / 2);
    }
    return { count: this.count, half: this.crossings % 2 === 1 };
  }
}

// FIGURE 8s: the ball goes around the left cone and the right cone. Same idea as a trip, following the ball.
export class EightCounter extends TripCounter { constructor() { super({ followBall: true }); } }

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
  constructor() { super(); this.hist = []; this.moving = false; this.stopSince = null; this.stillBelow = 0.08; }
  // A stop counts next to a foot (sole stop / cushion); CatchCounter changes this to "held above the knees".
  stopOk(o, b, S) { return !o.pose || Math.min(dist(o.pose.lf, b), dist(o.pose.rf, b)) < b.r + 0.12 * S; }
  update(o) {
    const S = this.scale(o), b = o.ball; if (!b) return { count: this.count };
    this.hist.push({ t: o.t, x: b.x, y: b.y }); while (this.hist.length > 2 && o.t - this.hist[0].t > 300) this.hist.shift();
    // speed from the distance actually travelled, so a bounce off a wall (out and back) never looks "stopped"
    let path = 0; for (let i = 1; i < this.hist.length; i++) path += Math.hypot(this.hist[i].x - this.hist[i - 1].x, this.hist[i].y - this.hist[i - 1].y);
    const dt = (o.t - this.hist[0].t) / 1000, net = dt > 0 ? Math.hypot(b.x - this.hist[0].x, b.y - this.hist[0].y) / dt : 0, speed = dt > 0 ? Math.max(net, path / dt * 0.5) : 0;
    if (net > 0.5 * S) { this.moving = true; this.stopSince = null; }
    else if (this.moving && speed < this.stillBelow * S) {
      this.stopSince ??= o.t;
      if (o.t - this.stopSince > 250 && this.stopOk(o, b, S)) { this.count++; this.moving = false; this.events.push({ t: o.t, type: 'rep' }); }
    }
    return { count: this.count };
  }
}

// GOALKEEPER CATCHES: a moving ball stops dead and stays up in the hands (above the knees).
// Hands are never perfectly still, so "stopped" is looser than for a sole stop.
export class CatchCounter extends StopCounter {
  constructor() { super(); this.stillBelow = 0.2; }
  stopOk(o, b) { return !o.pose || !o.pose.lk || b.y < mid(o.pose.lk, o.pose.rk).y; }
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
  cut: MoveCounter, stop: StopCounter, flick: FlickCounter, eights: EightCounter, catch: CatchCounter, rolls: RollCounter };
export const NEEDS_BALL = { juggle: true, taps: true, touches: true, kicks: true, trips: true, checks: false, cut: true, stop: true, flick: true, eights: true, catch: true, rolls: true };
