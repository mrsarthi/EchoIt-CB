// events-shim.js: EventEmitter browser fallback using CommonJS for SDK compatibility

class EventEmitter {
  constructor() {
    this.listeners = {};
  }

  on(event, fn) {
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(fn);
    return this;
  }

  off(event, fn) {
    if (!this.listeners[event]) return this;
    this.listeners[event] = this.listeners[event].filter(l => l !== fn);
    return this;
  }

  emit(event, ...args) {
    if (!this.listeners[event]) return false;
    this.listeners[event].forEach(fn => {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[EventEmitter] Error in listener for ${event}:`, err);
      }
    });
    return true;
  }
}

module.exports = EventEmitter;
