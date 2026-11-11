// KikUp live camera: runs body tracking + ball detection on each video frame
// and feeds the rep counters in reps.js. Everything runs on the device;
// no video leaves the phone.
import { FilesetResolver, PoseLandmarker, ObjectDetector } from '../vendor/mediapipe/vision_bundle.mjs';
import { COUNTERS, NEEDS_BALL, FrameStats } from './reps.js';
export { buildFeedback } from './feedback.js';

const here = (p) => new URL(p, import.meta.url).href;
let modelsPromise = null;

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;
}

export function loadModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(here('../vendor/mediapipe/wasm'));
      const make = async (delegate) => {
        const pose = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: here('../models/pose_landmarker_lite.task'), delegate },
          runningMode: 'VIDEO', numPoses: 1,
        });
        // Anything round counts as a candidate ball; shape, size and position checks pick the real one.
        const det = await ObjectDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: here('../models/efficientdet_lite0.tflite'), delegate },
          runningMode: 'IMAGE', scoreThreshold: 0.12, maxResults: 6, categoryAllowlist: ROUND,
        });
        return { pose, det };
      };
      try { return await make('GPU'); } catch (e) { return await make('CPU'); }
    })().catch((e) => { modelsPromise = null; throw e; });
  }
  return modelsPromise;
}

// Round things the detector knows. A soccer ball is often seen as one of these when it's small or blurry.
const ROUND = ['sports ball', 'orange', 'apple', 'clock', 'donut', 'frisbee'];

// Landmark numbers in the body-tracking model.
const LM = { nose: 0, ls: 11, rs: 12, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28, lf: 31, rf: 32 };

export class LiveCounter {
  constructor({ video, canvas, kind, opts = {}, facing = 'user', onCount, onStatus }) {
    Object.assign(this, { video, canvas, kind, opts, facing, onCount, onStatus });
    this.ctx = canvas.getContext('2d');
    this.counting = false; this.closed = false; this.lastT = 0; this.frame = 0;
    this.needsBall = NEEDS_BALL[kind];
    this.crop = document.createElement('canvas'); this.crop.width = this.crop.height = 320;
    this.cctx = this.crop.getContext('2d', { willReadFrequently: true });
    this.tc = document.createElement('canvas'); this.tctx = this.tc.getContext('2d', { willReadFrequently: true });
    this.track = null;   // last confirmed ball: position, size, appearance, speed
  }

  async open() {
    this.onStatus?.({ text: 'Starting camera…' });
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facing, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
    });
    if (this.closed) { this.stopTracks(); return; }
    this.video.srcObject = this.stream;
    this.video.classList.toggle('mirror', this.facing === 'user');
    this.canvas.classList.toggle('mirror', this.facing === 'user');
    await this.video.play();
    this.onStatus?.({ text: 'Loading the rep counter… (first time takes a few seconds)' });
    this.models = await loadModels();
    if (this.closed) return;
    this.onStatus?.({ text: this.kind === 'checks' ? 'Make sure your head and shoulders are in the picture.' : 'Make sure your feet and the ball are in the picture. Your whole body is fine too.' });
    this.tick();
  }

  setCounting(on) {
    if (on) { this.counter = new COUNTERS[this.kind](this.opts); this.stats = new FrameStats(); }
    this.counting = on;
  }

  tick() {
    if (this.closed) return;
    const next = () => this.video.requestVideoFrameCallback ? this.video.requestVideoFrameCallback(() => this.tick()) : requestAnimationFrame(() => this.tick());
    try { this.process(); } catch (e) { /* skip a bad frame */ }
    next();
  }

  process() {
    const v = this.video, W = v.videoWidth, H = v.videoHeight;
    if (!W || !H || v.readyState < 2) return;
    let t = performance.now(); if (t <= this.lastT) t = this.lastT + 1; this.lastT = t;
    this.frame++;

    // Pose every frame for body-only drills; every other frame when the ball matters,
    // so ball tracking keeps the higher frame rate on phones.
    let pose = this.lastPose || null;
    if (!this.needsBall || this.frame % 2 === 0 || !this.lastPose) {
      const pr = this.models.pose.detectForVideo(v, t);
      const lms = pr.landmarks && pr.landmarks[0];
      if (lms) {
        const P = (i) => ({ x: lms[i].x * W / H, y: lms[i].y, vis: lms[i].visibility ?? 1 });
        pose = {}; for (const [k, i] of Object.entries(LM)) pose[k] = P(i);
        pose.feet = Math.min(pose.la.vis, pose.ra.vis) > 0.5;                       // feet in the picture: enough to count
        pose.upper = Math.min(pose.ls.vis, pose.rs.vis, pose.nose.vis) > 0.5;      // head and shoulders too: a few extra checks
      } else pose = null;
      this.lastPose = pose;
    }

    const ball = this.needsBall ? this.findBall(v, W, H, pose, t) : null;

    const usable = pose && (this.kind === 'checks' ? pose.upper : pose.feet) ? pose : null;
    const obs = { t, pose: usable, ball };
    if (this.kind === 'taps' && ball && !usable) obs.tap = this.motionOnBall(v, H, ball);
    if (this.counting && this.counter) { this.stats.update(obs); this.onCount?.(this.counter.update(obs, W / H)); }

    this.draw(W, H, pose, ball);
    // Ready to count: shoulder checks need the head; everything else just needs the ball (feet-only framing is fine).
    const seen = !!usable, ready = this.kind === 'checks' ? seen : this.kind === 'trips' ? seen || !!ball : !!ball;
    this.onStatus?.({ body: seen, ball: this.needsBall ? !!ball : null, ready });
  }

  draw(W, H, pose, ball) {
    const c = this.canvas, ctx = this.ctx;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    ctx.clearRect(0, 0, W, H);
    const px = (p) => [p.x * H, p.y * H];
    if (pose) {
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(2, H / 160);
      const line = (a, b) => { const [x1, y1] = px(pose[a]), [x2, y2] = px(pose[b]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
      line('ls', 'rs'); line('lh', 'rh'); line('ls', 'lh'); line('rs', 'rh'); line('lh', 'la'); line('rh', 'ra'); line('la', 'lf'); line('ra', 'rf');
      for (const k of ['lf', 'rf']) { const [x, y] = px(pose[k]); ctx.fillStyle = '#FF8533'; ctx.beginPath(); ctx.arc(x, y, H / 45, 0, 7); ctx.fill(); }
      const [nx, ny] = px(pose.nose); ctx.fillStyle = '#FFC633'; ctx.beginPath(); ctx.arc(nx, ny, H / 60, 0, 7); ctx.fill();
    }
    if (ball) {
      const [x, y] = px(ball); ctx.strokeStyle = '#5BE08F'; ctx.lineWidth = Math.max(3, H / 120);
      if (ball.tracked) ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(x, y, ball.r * H + 4, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // Everything the feedback needs from this session.
  report() { return this.counter ? { events: this.counter.events, frames: this.stats.summary() } : null; }

  // ---- Ball finding ----------------------------------------------------------
  // 1) Look in a zoomed-in square around the player (where the ball usually is), so a small
  //    ball looks 2-3x bigger to the detector. Every 4th frame, look at the whole picture.
  // 2) Keep only round, ball-sized candidates that aren't the player's head.
  // 3) If nothing is found, follow the last ball by its appearance for up to 0.7 s.
  findBall(v, W, H, pose, t) {
    const cands = [], det = this.models.det;
    const add = (res, sx, sy, k) => { for (const d of res.detections || []) { const bb = d.boundingBox, c = d.categories[0]; if (!bb) continue;
      cands.push({ x: (sx + (bb.originX + bb.width / 2) * k) / H, y: (sy + (bb.originY + bb.height / 2) * k) / H, r: Math.max(bb.width, bb.height) * k / 2 / H,
        aspect: Math.min(bb.width, bb.height) / Math.max(bb.width, bb.height), score: c.score, name: c.categoryName }); } };
    const roi = this.frame % 4 === 0 ? null : this.roi(W, H, pose, t);
    if (roi) { this.cctx.drawImage(v, roi.x, roi.y, roi.s, roi.s, 0, 0, 320, 320); add(det.detect(this.crop), roi.x, roi.y, roi.s / 320); }
    else add(det.detect(v), 0, 0, 1);
    const found = this.pick(cands, pose, t);
    if (found) { this.remember(v, W, H, found, t); return found; }
    return this.follow(v, W, H, t);
  }

  // Toe taps without feet tracking: how much the picture changes in a band just above the ball.
  motionOnBall(v, H, b) {
    const w = 3 * b.r * H, h = 2.2 * b.r * H; if (w < 6) return null;
    this.tc.width = 24; this.tc.height = 16;
    this.tctx.drawImage(v, b.x * H - w / 2, (b.y - b.r) * H - h, w, h, 0, 0, 24, 16);
    const g = gray(this.tctx.getImageData(0, 0, 24, 16)), prev = this.prevTap; this.prevTap = g;
    if (!prev) return 0;
    let e = 0; for (let i = 0; i < g.length; i++) e += Math.abs(g[i] - prev[i]);
    return e / g.length;
  }

  bodyS(pose) {
    if (!pose) return this.track ? this.track.r * 9 : 0.6;
    const d = (a, b, c, e) => Math.hypot((a.x + b.x - c.x - e.x) / 2, (a.y + b.y - c.y - e.y) / 2);
    const s = pose.upper === false ? d(pose.lk, pose.rk, pose.la, pose.ra) * 3.2 : d(pose.ls, pose.rs, pose.la, pose.ra);
    return s > 0.05 ? s : 0.6;
  }

  // The square to zoom into, in video pixels.
  roi(W, H, pose, t) {
    let cx, cy, side;
    const recent = this.track && t - this.track.t < 1000 ? this.track : null;
    if (pose && pose.feet) {
      const S = this.bodyS(pose) * H, fx = (pose.lf.x + pose.rf.x) / 2 * H, fy = Math.max(pose.lf.y, pose.rf.y) * H;
      if (this.kind === 'juggle' || this.kind === 'flick') { const top = pose.upper ? pose.nose.y * H - 0.35 * S : (pose.lh.y + pose.rh.y) / 2 * H - 0.7 * S; cx = (pose.lh.x + pose.rh.x) / 2 * H; cy = (top + fy) / 2; side = (fy - top) * 1.25; }
      else { cx = fx; cy = fy - 0.2 * S; side = 1.4 * S; }
      if (recent) { const bx = recent.x * H, by = recent.y * H; if (Math.abs(bx - cx) > side * .4 || Math.abs(by - cy) > side * .4) { cx = (cx + bx) / 2; cy = (cy + by) / 2; side *= 1.3; } }
    } else if (recent) { cx = recent.x * H; cy = recent.y * H; side = Math.max(10 * recent.r * H, 0.45 * H); }
    else if (this.frame % 2) { cx = W / 2; cy = H * 0.68; side = H * 0.62; }        // no player yet: the lower middle, where balls usually are
    else return null;
    side = Math.min(side, W, H); if (side < 80) side = 80;
    return { x: Math.max(0, Math.min(W - side, cx - side / 2)), y: Math.max(0, Math.min(H - side, cy - side / 2)), s: side };
  }

  pick(cands, pose, t) {
    const S = this.bodyS(pose), prev = this.track && t - this.track.t < 1000 ? this.track : null;
    let best = null, bestScore = -1e9;
    this.fixed ??= [];   // round things that never move (cones, a clock on the wall): ignored once spotted
    for (const c of cands) {
      if (c.aspect < 0.6) continue;                                            // not round enough
      if (this.fixed.some((f) => f.n > 40 && Math.hypot(c.x - f.x, c.y - f.y) < Math.max(f.r, 0.01))) continue;
      if (pose && pose.feet && (c.r < 0.025 * S || c.r > 0.3 * S)) continue;                // wrong size for a ball next to this player
      if (pose && pose.upper && Math.hypot(c.x - pose.nose.x, c.y - pose.nose.y) < 0.15 * S && !(c.name === 'sports ball' && c.score > 0.4)) continue;  // that's the head
      const score = c.score * (c.name === 'sports ball' ? 1.6 : 1) + 0.2 * c.aspect - (prev ? 0.6 * Math.hypot(c.x - prev.x, c.y - prev.y) / S : 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    // Count how long each non-chosen candidate has sat in the same spot while the chosen ball moved.
    const moving = prev && best && Math.hypot(best.x - prev.x, best.y - prev.y) > 0.5 * best.r;
    for (const c of cands) { if (c === best) continue;
      const f = this.fixed.find((f) => Math.hypot(c.x - f.x, c.y - f.y) < Math.max(f.r, 0.01));
      if (f) { if (moving) f.n++; } else if (this.fixed.length < 20) this.fixed.push({ x: c.x, y: c.y, r: c.r, n: 0 }); }
    return best ? { x: best.x, y: best.y, r: best.r } : null;
  }

  // Remember what the ball looks like (a small grey patch) so it can be followed between detections.
  remember(v, W, H, b, t) {
    const vx = this.track && t - this.track.t < 500 ? (b.x - this.track.x) / ((t - this.track.t) / 1000) : 0;
    const vy = this.track && t - this.track.t < 500 ? (b.y - this.track.y) / ((t - this.track.t) / 1000) : 0;
    const box = 2.4 * b.r * H; if (box < 6) { this.track = { ...b, t, vx, vy, tpl: null }; return; }
    this.tc.width = this.tc.height = 24;
    this.tctx.drawImage(v, b.x * H - box / 2, b.y * H - box / 2, box, box, 0, 0, 24, 24);
    this.track = { ...b, t, vx, vy, tpl: gray(this.tctx.getImageData(0, 0, 24, 24)) };
  }

  follow(v, W, H, t) {
    const tr = this.track; if (!tr || !tr.tpl || t - tr.t > 700) return null;
    const dt = (t - tr.t) / 1000, ex = tr.x + tr.vx * dt, ey = tr.y + tr.vy * dt;   // where it should be by now
    const box = 2.4 * tr.r * H, k = 24 / box, range = Math.max(1.5 * tr.r * H, Math.hypot(tr.vx, tr.vy) * dt * H * 0.5 + tr.r * H);
    const win = box + 2 * range, n = Math.min(120, Math.ceil(win * k));
    this.tc.width = this.tc.height = n;
    this.tctx.drawImage(v, ex * H - win / 2, ey * H - win / 2, win, win, 0, 0, n, n);
    const g = gray(this.tctx.getImageData(0, 0, n, n)), tpl = tr.tpl;
    let best = -1, bx = 0, by = 0;
    for (let y = 0; y + 24 <= n; y += 2) for (let x = 0; x + 24 <= n; x += 2) { const c = ncc(g, n, x, y, tpl); if (c > best) { best = c; bx = x; by = y; } }
    if (best < 0.55) return null;
    const px = (ex * H - win / 2) + (bx + 12) / k, py = (ey * H - win / 2) + (by + 12) / k;
    return { x: px / H, y: py / H, r: tr.r, tracked: true };
  }

  stopTracks() { this.stream?.getTracks().forEach((tr) => tr.stop()); }
  close() { this.closed = true; this.counting = false; this.stopTracks(); if (this.video) this.video.srcObject = null; }
}

// Greyscale pixels of an ImageData.
function gray(img) { const d = img.data, g = new Float32Array(img.width * img.height); for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11; return g; }
// How closely a 24x24 patch of g (width n) at (x, y) matches the template, from -1 to 1.
function ncc(g, n, x, y, tpl) {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let j = 0; j < 24; j++) { const row = (y + j) * n + x; for (let i = 0; i < 24; i++) { const a = g[row + i], b = tpl[j * 24 + i]; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; } }
  const N = 576, cov = sab - sa * sb / N, va = saa - sa * sa / N, vb = sbb - sb * sb / N;
  return va > 1 && vb > 1 ? cov / Math.sqrt(va * vb) : 0;
}
