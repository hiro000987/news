const DAY = 86_400_000;
function instant(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid review time');
  return date;
}
function count(value) { return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0; }

export function initialSchedule(now = new Date()) {
  return { dueAt: instant(now).toISOString(), intervalDays: 0, streak: 0, lapses: 0, reviews: 0, status: 'new' };
}

/** A small, replaceable scheduling policy, not a scientifically optimal interval model. */
export function scheduleReview(previous, rating, now = new Date()) {
  if (!['forgot', 'unsure', 'remembered'].includes(rating)) throw new TypeError('Invalid rating');
  const date = instant(now);
  const reviews = count(previous.reviews) + 1;
  const lapses = count(previous.lapses) + (rating === 'forgot' ? 1 : 0);
  const streak = rating === 'remembered' ? count(previous.streak) + 1 : 0;
  let intervalDays;
  if (rating === 'forgot') intervalDays = 10 / 1440;
  else if (rating === 'unsure') intervalDays = 1;
  else {
    const prior = Math.max(0, Number(previous.intervalDays) || 0);
    const growth = Math.max(1.4, 2.2 + Math.min(streak, 4) * 0.15 - Math.min(lapses, 5) * 0.15);
    intervalDays = prior < 1 ? 1 : Math.min(180, Math.max(prior + 1, Math.round(prior * growth)));
  }
  return {
    dueAt: new Date(date.getTime() + intervalDays * DAY).toISOString(),
    intervalDays, streak, lapses, reviews,
    status: streak >= 3 && intervalDays >= 7 ? 'mastered' : 'learning',
  };
}
