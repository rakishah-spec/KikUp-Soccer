# KikUp Soccer

Soccer training for kids: drills and skill moves matched to age group and skill level,
plus a live camera rep counter.

## What's here
- `index.html` — the whole app (drills, skill moves, levels, stars, timers).
- `js/reps.js` — the rep counting logic (juggles, toe taps, touches, passes, cone trips, shoulder checks).
- `js/camera.js` — runs body tracking and ball detection on the live camera, all on the device.
- `vendor/mediapipe/` — Google MediaPipe Tasks Vision 0.10.14 (Apache 2.0), stored here so the site has no outside dependencies.
- `models/` — the body-tracking model (Pose Landmarker Lite) and ball detector (EfficientDet-Lite0).
- `tests/reps.test.mjs` — simulated-movement tests for the counters: `node tests/reps.test.mjs`.

## Run it locally
```
python3 -m http.server 8000
```
Then open http://localhost:8000. The camera only works on `localhost` or an `https://` address.

## Publish
Hosted as a static site (GitHub Pages: Settings → Pages → Deploy from branch → `main`, root folder).
No video ever leaves the device.
