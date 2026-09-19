export class MessageBuffer {
  constructor(deliver, { now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.deliver = deliver;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.chats = new Map();
    this.typing = new Map();
  }
  add(jid, message) {
    const state = this.chats.get(jid) || { messages: new Map(), typingUntil: this.typing.get(jid) || 0 };
    if (state.messages.has(message.key.id)) return;
    state.messages.set(message.key.id, message);
    state.messageUntil = this.now() + 5000;
    this.chats.set(jid, state);
    this.schedule(jid, state);
  }
  presence(jid, composing) {
    if (!composing) return;
    for (const [key, until] of this.typing) if (until <= this.now()) this.typing.delete(key);
    this.typing.set(jid, this.now() + 10000);
    const state = this.chats.get(jid);
    if (!state) return;
    state.typingUntil = this.now() + 10000;
    this.schedule(jid, state);
  }
  schedule(jid, state) {
    this.clearTimer(state.timer);
    state.timer = this.setTimer(() => {
      this.chats.delete(jid);
      this.deliver([...state.messages.values()]);
    }, Math.max(state.messageUntil, state.typingUntil) - this.now());
  }
  clear() {
    for (const state of this.chats.values()) this.clearTimer(state.timer);
    this.chats.clear();
    this.typing.clear();
  }
  async waitForSilence(jid) {
    while (true) {
      const deadline = Math.max(this.chats.get(jid)?.messageUntil || 0, this.typing.get(jid) || 0);
      const remaining = deadline - this.now();
      if (remaining <= 0) return;
      await new Promise((resolve) => this.setTimer(resolve, remaining));
    }
  }
}
