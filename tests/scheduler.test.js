import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSchedule, scheduleReview } from '../src/scheduler.js';

const now = new Date('2026-10-28T00:00:00Z');
test('new knowledge is due immediately and unmeasured', () => {
  assert.deepEqual(initialSchedule(now), {dueAt:now.toISOString(), intervalDays:0, streak:0, lapses:0, reviews:0, status:'new'});
});
test('forgotten knowledge returns in ten minutes, preserving all prior review counts', () => {
  const next = scheduleReview({intervalDays:12,streak:3,lapses:1,reviews:5}, 'forgot', now);
  assert.equal(next.dueAt, '2026-10-28T00:10:00.000Z');
  assert.equal(next.streak, 0); assert.equal(next.lapses,2); assert.equal(next.reviews,6);
});
test('uncertain knowledge is due tomorrow and does not count as mastery', () => {
  const next = scheduleReview({intervalDays:9,streak:3,lapses:0,reviews:3}, 'unsure', now);
  assert.equal(next.dueAt,'2026-10-29T00:00:00.000Z'); assert.equal(next.status,'learning'); assert.equal(next.streak,0);
});
test('recall intervals grow, prior lapses temper growth, and cap at 180 days', () => {
  const a = scheduleReview(initialSchedule(now),'remembered',now);
  const b = scheduleReview(a,'remembered',now);
  assert.equal(a.intervalDays,1); assert.ok(b.intervalDays > a.intervalDays);
  const healthy = scheduleReview({intervalDays:10,streak:2,lapses:0,reviews:3},'remembered',now);
  const lapsed = scheduleReview({intervalDays:10,streak:2,lapses:4,reviews:7},'remembered',now);
  assert.ok(lapsed.intervalDays < healthy.intervalDays);
  assert.equal(scheduleReview({intervalDays:180,streak:20,lapses:0,reviews:20},'remembered',now).intervalDays,180);
});
test('mastered is a declared operational threshold, not inferred scientific retention', () => {
  const next = scheduleReview({intervalDays:7,streak:2,lapses:0,reviews:2},'remembered',now);
  assert.equal(next.status,'mastered');
});
test('invalid ratings and timestamps are rejected', () => {
  assert.throws(()=>scheduleReview({},'perfect',now));
  assert.throws(()=>initialSchedule(new Date('invalid')));
});
