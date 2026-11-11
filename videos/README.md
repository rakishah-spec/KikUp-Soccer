# Drill and skill move videos

Each drill and skill move shows a video when you swipe right on its card.

Every drill and move already has an **animated demo** here, made by `tools/make-videos.js`
from the animations in `tools/video-studio.html` (open that page in a browser to preview them).

To swap in real footage, upload a clip with the **same file name** below and it replaces the
animation in the app. (If you do, don't re-run `make-videos.js` for that id, or it will
overwrite your clip: run it with only the ids you want, e.g. `node tools/make-videos.js juggle`.)

## How to film
- 10–15 seconds, phone held **sideways** (landscape).
- Film from the side, 4–5 big steps away, whole body and the ball in the shot.
- Do the drill or move 3–4 times at a medium speed so it's easy to follow.
- Daylight, plain background if you can.
- Save as **.mp4** (on iPhone: Settings → Camera → Formats → Most Compatible). Keep each file under 25 MB.

## How to add one
On GitHub: open this `videos` folder → **Add file → Upload files** → drag the clip in → **Commit changes**.
The file name must match exactly (lowercase, with the dashes).

## Drills
| Drill | File name |
|---|---|
| Cone Dribble | `cone-dribble.mp4` |
| Find the Gap (on-screen) | `find-gap.mp4` |
| Scan & Turn | `scan-turn.mp4` |
| Gate Hunt | `gate-hunt.mp4` |
| Tight Box | `tight-box.mp4` |
| Wall Pass Rush | `wall-pass.mp4` |
| Receive & Open Up | `receive-turn.mp4` |
| Check Away, Check In | `check-away.mp4` |
| Weak Foot Wall | `weak-foot.mp4` |
| Juggle Ladder | `juggle.mp4` |
| Drop, Kick, Catch (Little Kickers version of Juggle Ladder) | `juggle-kids.mp4` |
| Juggle & Check | `juggle-check.mp4` |
| Toe Taps | `toe-taps.mp4` |
| Box-to-Box Repeats | `repeats.mp4` |

## Skill moves
| Move | File name |
|---|---|
| Sole Stop | `move-sole-stop.mp4` |
| Side-to-Side Taps | `move-side-taps.mp4` |
| Pull Back | `move-pull-back.mp4` |
| Inside Cut | `move-inside-cut.mp4` |
| Outside Cut | `move-outside-cut.mp4` |
| Body Feint | `move-body-feint.mp4` |
| Step-Over | `move-step-over.mp4` |
| Cruyff Turn | `move-cruyff.mp4` |
| Scissors | `move-scissors.mp4` |
| La Croqueta | `move-croqueta.mp4` |
| Roulette (360 Spin) | `move-roulette.mp4` |
| Ronaldo Chop | `move-chop.mp4` |
| Elastico | `move-elastico.mp4` |
| Rainbow Flick | `move-rainbow.mp4` |
| Combo Chain | `move-combo.mp4` |

## Using a YouTube video instead
In `index.html`, add the video's id to `VIDEO_LINKS`, e.g. `juggle:'abc123XYZ'`
(the part after `watch?v=` in the link). Or just send the link to Claude and say which drill it's for.
