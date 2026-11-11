// Renders every animation in tools/video-studio.html to videos/<id>.mp4.
// Needs Playwright (Chromium) and ffmpeg.  Run:  node tools/make-videos.js [id ...]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const FPS = 24, ROOT = path.resolve(__dirname, '..');

function encode(out) {
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c ? rej(new Error('ffmpeg ' + c)) : res())));
  return { write: (buf) => new Promise((r) => (ff.stdin.write(buf) ? r() : ff.stdin.once('drain', r))), end: () => { ff.stdin.end(); return done; } };
}

(async () => {
  const browser = await chromium.launch(), page = await browser.newPage();
  await page.goto('file://' + path.join(ROOT, 'tools/video-studio.html'));
  let list = await page.evaluate(() => SCENE_LIST);
  const only = process.argv.slice(2); if (only.length) list = list.filter((s) => only.includes(s.id));
  for (const s of list) {
    const out = path.join(ROOT, 'videos', s.id + '.mp4'), enc = encode(out), n = Math.round(s.dur * FPS);
    for (let i = 0; i < n; i++) {
      const url = await page.evaluate(([id, t]) => renderFrame(id, t), [s.id, i / FPS]);
      await enc.write(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
    await enc.end();
    console.log(`${s.id}.mp4  ${s.dur}s`);
  }
  await browser.close();
})();
