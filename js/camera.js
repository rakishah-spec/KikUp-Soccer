// KikUp live camera: runs body tracking + ball detection on each video frame
// and feeds the rep counters in reps.js. Everything runs on the device;
// no video leaves the phone.
import { FilesetResolver, PoseLandmarker, ObjectDetector } from '../vendor/mediapipe/vision_bundle.mjs';
import { COUNTERS, NEEDS_BALL } from './reps.js';

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
        const det = await ObjectDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: here('../models/efficientdet_lite0.tflite'), delegate },
          runningMode: 'VIDEO', scoreThreshold: 0.25, maxResults: 1, categoryAllowlist: ['sports ball'],
        });
        return { pose, det };
      };
      try { return await make('GPU'); } catch (e) { return await make('CPU'); }
    })().catch((e) => { modelsPromise = null; throw e; });
  }
  return modelsPromise;
}

// Landmark numbers in the body-tracking model.
const LM = { nose: 0, ls: 11, rs: 12, lh: 23, rh: 24, la: 27, ra: 28, lf: 31, rf: 32 };

export class LiveCounter {
  constructor({ video, canvas, kind, opts = {}, facing = 'user', onCount, onStatus }) {
    Object.assign(this, { video, canvas, kind, opts, facing, onCount, onStatus });
    this.ctx = canvas.getContext('2d');
    this.counting = false; this.closed = false; this.lastT = 0; this.frame = 0;
    this.needsBall = NEEDS_BALL[kind];
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
    this.onStatus?.({ text: 'Step back until your whole body' + (this.needsBall ? ' and the ball are' : ' is') + ' in the picture.' });
    this.tick();
  }

  setCounting(on) {
    if (on) this.counter = new COUNTERS[this.kind](this.opts);
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
        pose.full = Math.min(pose.la.vis, pose.ra.vis, pose.ls.vis, pose.rs.vis) > 0.5;
      } else pose = null;
      this.lastPose = pose;
    }

    let ball = null;
    if (this.needsBall) {
      const dr = this.models.det.detectForVideo(v, t);
      const d = dr.detections && dr.detections[0];
      if (d && d.boundingBox) {
        const b = d.boundingBox;
        ball = { x: (b.originX + b.width / 2) / H, y: (b.originY + b.height / 2) / H, r: Math.max(b.width, b.height) / 2 / H };
      }
    }

    const obs = { t, pose: pose && pose.full ? pose : (pose && this.kind === 'checks' ? pose : null), ball };
    if (this.counting && this.counter) this.onCount?.(this.counter.update(obs, W / H));

    this.draw(W, H, pose, ball);
    const seen = !!(pose && (pose.full || this.kind === 'checks'));
    this.onStatus?.({ body: seen, ball: this.needsBall ? !!ball : null });
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
      ctx.beginPath(); ctx.arc(x, y, ball.r * H + 4, 0, 7); ctx.stroke();
    }
  }

  stopTracks() { this.stream?.getTracks().forEach((tr) => tr.stop()); }
  close() { this.closed = true; this.counting = false; this.stopTracks(); if (this.video) this.video.srcObject = null; }
}
