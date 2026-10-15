import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshController } from '../public/refresh-controller.mjs';

function setup({ visible = true, read = async () => ({ stars: 20, fetchedAt: 'new' }) } = {}) {
  let nextTimer = 0;
  const timers = new Map();
  const applied = [];
  const controller = createRefreshController({
    read, apply: (value) => applied.push(value), isVisible: () => visible,
    setTimer(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { timers.delete(id); },
  });
  return {
    controller, timers, applied,
    setVisible(value) { visible = value; },
    fireTimer() { const [id, timer] = timers.entries().next().value; timers.delete(id); return timer.callback(); },
  };
}

test('visible pages read and apply shared data after each sixty-second interval', async () => {
  const app = setup();
  app.controller.start();
  assert.equal(app.applied.length, 0);
  assert.equal(app.timers.size, 1);
  assert.equal([...app.timers.values()][0].delay, 60000);
  await app.fireTimer();
  assert.deepEqual(app.applied, [{ stars: 20, fetchedAt: 'new' }]);
  assert.equal(app.timers.size, 1);
  await app.fireTimer();
  assert.equal(app.applied.length, 2);
});

test('hidden pages stop polling and returning visible reads shared data immediately', async () => {
  const app = setup();
  app.controller.start();
  app.setVisible(false);
  await app.controller.visibilityChanged();
  assert.equal(app.timers.size, 0);
  await app.controller.online();
  assert.equal(app.applied.length, 0);
  app.setVisible(true);
  await app.controller.visibilityChanged();
  assert.equal(app.applied.length, 1);
  assert.equal(app.timers.size, 1);
});

test('pages initially hidden start without a timer and online refreshes only when visible', async () => {
  const app = setup({ visible: false });
  app.controller.start();
  assert.equal(app.timers.size, 0);
  await app.controller.online();
  assert.equal(app.applied.length, 0);
  app.setVisible(true);
  await app.controller.online();
  assert.equal(app.applied.length, 1);
});

test('timer visibility and online events share a single in-flight read', async () => {
  let resolveRead;
  let reads = 0;
  const app = setup({ read: () => { reads++; return new Promise((resolve) => { resolveRead = resolve; }); } });
  app.controller.start();
  const timerRead = app.fireTimer();
  const foregroundRead = app.controller.visibilityChanged();
  const onlineRead = app.controller.online();
  await Promise.resolve();
  assert.equal(reads, 1);
  resolveRead({ stars: 30 });
  await Promise.all([timerRead, foregroundRead, onlineRead]);
  assert.deepEqual(app.applied, [{ stars: 30 }]);
  assert.equal(app.timers.size, 1);
});

test('a failed read preserves the displayed data and acquisition time and retries next interval', async () => {
  let fail = true;
  const app = setup({ read: async () => { if (fail) throw new Error('offline'); return { stars: 40, fetchedAt: 'new' }; } });
  app.applied.push({ stars: 10, fetchedAt: 'original' });
  app.controller.start();
  await app.fireTimer();
  assert.deepEqual(app.applied, [{ stars: 10, fetchedAt: 'original' }]);
  assert.equal(app.timers.size, 1);
  fail = false;
  await app.fireTimer();
  assert.deepEqual(app.applied.at(-1), { stars: 40, fetchedAt: 'new' });
});

test('stop clears the timer and invalidates pending data without applying or rescheduling it', async () => {
  let resolveRead;
  const app = setup({ read: () => new Promise((resolve) => { resolveRead = resolve; }) });
  app.controller.start();
  const pending = app.fireTimer();
  await Promise.resolve();
  app.controller.stop();
  resolveRead({ stars: 99 });
  await pending;
  await app.controller.online();
  assert.equal(app.applied.length, 0);
  assert.equal(app.timers.size, 0);
  app.controller.start();
  assert.equal(app.timers.size, 1);
  app.controller.stop();
  assert.equal(app.timers.size, 0);
});

test('a page hidden during a read does not apply results or schedule another hidden read', async () => {
  let resolveRead;
  const app = setup({ read: () => new Promise((resolve) => { resolveRead = resolve; }) });
  app.controller.start();
  const pending = app.fireTimer();
  await Promise.resolve();
  app.setVisible(false);
  await app.controller.visibilityChanged();
  resolveRead({ stars: 99 });
  await pending;
  assert.equal(app.applied.length, 0);
  assert.equal(app.timers.size, 0);
});

test('restoring a stopped page waits for its old read then immediately fetches current data', async () => {
  for (const failOldRead of [false, true]) {
    let finishOldRead;
    let reads = 0;
    const app = setup({ read: () => {
      reads++;
      if (reads === 1) return new Promise((resolve, reject) => { finishOldRead = () => failOldRead ? reject(new Error('old offline read')) : resolve({ stars: 10 }); });
      return Promise.resolve({ stars: 50 });
    } });
    app.controller.start();
    const pending = app.fireTimer();
    await Promise.resolve();
    app.controller.stop();
    app.controller.start();
    const restored = app.controller.online();
    assert.equal(reads, 1);
    finishOldRead();
    await Promise.all([pending, restored]);
    assert.equal(reads, 2);
    assert.deepEqual(app.applied, [{ stars: 50 }]);
    assert.equal(app.timers.size, 1);
  }
});
