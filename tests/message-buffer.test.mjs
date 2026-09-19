import test from "node:test";
import assert from "node:assert/strict";
import { MessageBuffer } from "../server/message-buffer.js";

function fixture() {
  let time = 0, serial = 0;
  const timers = new Map(), batches = [];
  const buffer = new MessageBuffer((messages) => batches.push(messages), {
    now: () => time,
    setTimer: (fn, ms) => { const id = ++serial; timers.set(id, { at: time + ms, fn }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const tick = (ms) => {
    time += ms;
    for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.fn(); }
  };
  return { buffer, batches, tick };
}
const msg = (id) => ({ key: { id } });
test("waits five seconds after the last message and deduplicates", () => {
  const { buffer, batches, tick } = fixture();
  buffer.add("a", msg("1")); tick(4000);
  buffer.add("a", msg("2")); buffer.add("a", msg("2")); tick(4999);
  assert.equal(batches.length, 0); tick(1);
  assert.deepEqual(batches[0].map((m) => m.key.id), ["1", "2"]);
});
test("typing extends wait to ten seconds without delaying other clients", () => {
  const { buffer, batches, tick } = fixture();
  buffer.add("a", msg("1")); buffer.add("b", msg("2")); tick(4000);
  buffer.presence("a", true); tick(1000);
  assert.equal(batches[0][0].key.id, "2"); tick(8999);
  assert.equal(batches.length, 1); tick(1);
  assert.equal(batches[1][0].key.id, "1");
});
test("typing before receipt is retained; disconnect cancels pending timers", () => {
  const { buffer, batches, tick } = fixture();
  buffer.presence("a", true); buffer.add("a", msg("1")); tick(5000);
  assert.equal(batches.length, 0);
  buffer.clear(); tick(10000); assert.equal(batches.length, 0);
});
