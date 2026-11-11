// KikUp feedback: turns what the camera measured during a drill into coaching tips.
// Pure function, no AI and no network, so it is instant, free and private.
//
// buildFeedback({ kind, count, target, seconds, age, weakFoot, report })
//   kind:   'juggle' | 'taps' | 'touches' | 'kicks' | 'trips' | 'checks'
//   age:    0 = Little Kickers (4–8), 1 = Juniors (9–12), 2 = Teens (13+)
//   report: { events, frames } from LiveCounter.report()
// Returns { good: [..], fix: [..], cue } or null when there is too little to go on.

const pct = (x) => Math.round(x * 100);
const FOOT = { l: 'left', r: 'right' };

const CUES = {
  juggle: ['Soft kicks, catch it high!', 'Toes up, soft touch, waist height.', 'Locked ankle, laces, waist height, both feet.'],
  taps: ['Tiny taps, happy feet!', 'Light feet, steady beat.', 'Light feet, steady beat, eyes up.'],
  touches: ['Little touches!', 'Small touches, eyes up.', 'Small touches, eyes up, every surface.'],
  kicks: ['Kick with the inside of your foot!', 'Lock the ankle, strike through the middle.', 'Open body, locked ankle, pass with purpose.'],
  trips: ['Little touches around the cones!', 'Close touches at the cones, burst on the straight.', 'Close control at the cones, explode out of the turn.'],
  checks: ['Look around!', 'Look before the ball comes.', 'Check both shoulders before every touch.'],
  cut: ['Fake it, then go fast!', 'Sell the fake, then explode away.', 'Sell the fake, change speed, explode into space.'],
  stop: ['Step on the ball gently!', 'Toes up, soft sole, ball dead.', 'Stop it dead, then go again straight away.'],
  flick: ['Roll it up, flick it over!', 'Roll, flick, then run onto it.', 'Smooth roll, sharp flick, sprint onto it.'],
};

// Reps in the first half of the drill vs the second half.
function halves(reps) {
  if (reps.length < 6) return null;
  const mid = (reps[0].t + reps[reps.length - 1].t) / 2;   // halfway through the time they were actually doing reps
  const a = reps.filter((e) => e.t <= mid).length, b = reps.length - a;
  return { a, b };
}

// Left/right balance for events that have a side.
function sides(evs) {
  const l = evs.filter((e) => e.side === 'l').length, r = evs.filter((e) => e.side === 'r').length;
  return { l, r, n: l + r };
}

export function buildFeedback({ kind, count, target, seconds, age = 1, weakFoot = 'l', report }) {
  if (!report) return null;
  const kid = age === 0, { events = [], frames = {} } = report;
  const reps = events.filter((e) => e.type === 'rep');
  const good = [], fix = [];

  // Camera couldn't see the player for much of the drill: say so first, since counts may be low.
  if (frames.frames > 30 && frames.seenPct < 0.7) {
    fix.push(kid ? 'The camera lost the ball a lot. Ask a grown-up to move the phone.'
      : `The camera could only follow you and the ball ${pct(frames.seenPct)}% of the time, so some reps may not have counted. Move the phone so your feet and the ball stay in the picture.`);
  }

  // Goal
  if (count >= target) good.push(kid ? `You did it! ${count} — that beats your goal!` : `You hit your goal: ${count} (goal was ${target}).`);
  else if (count >= target * 0.7) good.push(kid ? `So close! ${count}. Your goal is ${target}.` : `Close to your goal: ${count} of ${target}.`);

  // Pace: did they slow down? (not for juggling, where streaks matter, or best-of drills)
  if (kind !== 'juggle') {
    const h = halves(reps);
    if (h && h.b < h.a * 0.75) fix.push(kid ? 'You got slower at the end. Keep going fast to the end!' : `You slowed down in the second half (${h.a} reps, then ${h.b}). Keep your pace to the end.`);
    else if (h && h.b >= h.a) good.push(kid ? 'You stayed fast the whole time!' : 'You kept your pace the whole time.');
  }

  if (kind === 'juggle') {
    const drops = events.filter((e) => e.type === 'drop');
    const streaks = drops.map((d) => d.streak);
    const feet = sides(reps.filter((e) => e.surface === 'foot'));
    if (feet.n >= 8) {
      const weak = feet.l < feet.r ? 'l' : 'r', share = Math.min(feet.l, feet.r) / feet.n;
      if (share < 0.25) fix.push(kid ? `You kicked mostly with your ${FOOT[weak === 'l' ? 'r' : 'l']} foot. Try your ${FOOT[weak]} foot too!`
        : `${pct(1 - share)}% of your juggles were with your ${FOOT[weak === 'l' ? 'r' : 'l']} foot. Mix in your ${FOOT[weak]} foot to get comfortable with both.`);
      else if (share >= 0.35) good.push(kid ? 'You used both feet. Awesome!' : 'You used both feet well.');
    }
    const withPeak = reps.filter((e) => e.peak);
    if (withPeak.length >= 6) {
      const high = withPeak.filter((e) => e.peak.aboveHead).length / withPeak.length;
      if (high > 0.35) fix.push(kid ? 'The ball went really high. Kick it softer!' : `${pct(high)}% of your juggles went above your head. Softer touches keep the ball around waist height, where it's easier to control.`);
      else if (high < 0.15) good.push(kid ? 'Nice soft kicks!' : 'Good touch: you kept the ball at a controllable height.');
    }
    if (drops.length >= 3 && Math.max(0, ...streaks) < target * 0.5) {
      fix.push(kid ? 'Try to catch it before it falls, then start again.' : `You dropped it ${drops.length} times. When a streak breaks, reset calmly: drop it onto your laces with your toes pointed up.`);
    }
    const thighs = reps.filter((e) => e.surface === 'thigh').length;
    if (age === 2 && reps.length >= 15 && thighs === 0) fix.push('Every juggle was with your feet. At your level, work your thighs into the streak too.');
  }

  if (kind === 'taps') {
    const s = sides(reps);
    if (s.n >= 8 && Math.min(s.l, s.r) / s.n < 0.35) {
      const lazy = s.l < s.r ? 'l' : 'r';
      fix.push(kid ? `Your ${FOOT[lazy]} foot needs more taps. Take turns, one foot then the other!` : `Your ${FOOT[lazy]} foot only did ${Math.min(s.l, s.r)} of ${s.n} taps. Keep it strictly alternating.`);
    }
    if (reps.length >= 8) {
      const gaps = reps.slice(1).map((e, i) => e.t - reps[i].t), m = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const cv = Math.sqrt(gaps.reduce((a, g) => a + (g - m) ** 2, 0) / gaps.length) / m;
      if (cv > 0.5) fix.push(kid ? 'Try a steady beat: tap, tap, tap!' : 'Your rhythm was uneven. Aim for a steady tap-tap-tap beat, then speed it up.');
      else if (cv < 0.3) good.push(kid ? 'Great rhythm!' : 'Nice steady rhythm.');
    }
  }

  if (kind === 'touches') {
    if (frames.farPct != null) {
      if (frames.farPct > 0.25) fix.push(kid ? 'The ball rolled away a lot. Use little touches!' : `The ball got away from your feet ${pct(frames.farPct)}% of the time. Smaller touches keep it close, even when you go faster.`);
      else if (frames.farPct < 0.1) good.push(kid ? 'You kept the ball close!' : 'You kept the ball close to your feet.');
    }
    const s = sides(reps);
    if (s.n >= 10 && Math.min(s.l, s.r) / s.n < 0.3) {
      const lazy = s.l < s.r ? 'l' : 'r';
      fix.push(kid ? `Use your ${FOOT[lazy]} foot more!` : `${Math.min(s.l, s.r) ? `Only ${pct(Math.min(s.l, s.r) / s.n)}%` : 'None'} of your touches were with your ${FOOT[lazy]} foot. In a tight space you need both.`);
    }
  }

  if (kind === 'trips' || kind === 'touches') {
    if (!kid && frames.headDownPct != null) {
      if (frames.headDownPct > 0.7) fix.push('You were looking down at the ball most of the time. Glance up every couple of touches, like you would to find a pass in a game.');
      else if (frames.headDownPct < 0.4) good.push('Good job keeping your head up.');
    }
  }

  if (kind === 'trips') {
    const crosses = events.filter((e) => e.type === 'cross');
    if (crosses.length >= 4) {
      const legs = crosses.slice(1).map((e, i) => e.t - crosses[i].t);
      const first = legs[0], last = legs[legs.length - 1];
      if (last > first * 1.3) fix.push(kid ? 'Your last trip was slower. Keep going fast!' : `Your last length took ${(last / 1000).toFixed(1)}s vs ${(first / 1000).toFixed(1)}s on the first. Push the pace on every length.`);
    }
  }

  if (kind === 'kicks') {
    const other = events.filter((e) => e.type === 'other-foot').length;
    if (weakFoot && other > 0 && other >= reps.length * 0.3) {
      fix.push(`${other} passes were with your strong foot and didn't count. Keep it weak foot only, even if it means going slower.`);
    }
    const s = sides(reps);
    if (!weakFoot && s.n >= 10 && Math.min(s.l, s.r) / s.n < 0.25) {
      const lazy = s.l < s.r ? 'l' : 'r';
      fix.push(kid ? `Try kicking with your ${FOOT[lazy]} foot too!` : `Almost every pass was with your ${FOOT[lazy === 'l' ? 'r' : 'l']} foot. Mix in your ${FOOT[lazy]} foot.`);
    }
  }

  if (kind === 'checks') {
    const a = reps.filter((e) => e.dir === 'a').length, b = reps.length - a;
    if (reps.length >= 6 && Math.min(a, b) / reps.length < 0.3) fix.push('You mostly checked over one shoulder. Check both sides: the danger can come from either.');
    else if (reps.length >= 6) good.push('You checked over both shoulders.');
  }

  // Nothing to fix? Point them up a level.
  if (!fix.length) fix.push(count >= target
    ? (kid ? 'You\'re ready for something harder. Ask to try the next level!' : 'You\'ve got this one. Try the next skill level up.')
    : (kid ? 'Keep practicing, you\'re getting better!' : `Keep at it: ${target - count} more to reach your goal.`));
  if (!good.length) good.push(kid ? 'Great effort today!' : 'You finished the whole drill. That\'s how you get better.');

  const n = kid ? 2 : 3;
  return { good: good.slice(0, n), fix: fix.slice(0, n), cue: (CUES[kind] || CUES.touches)[Math.max(0, Math.min(2, age))] };
}
