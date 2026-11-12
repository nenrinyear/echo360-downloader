import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../content-script.js", import.meta.url), "utf8");

for (const mode of ["success", "throw", "reject"]) {
  test(`content script handles ${mode} during page load, title updates, and unload`, async () => {
    const messages = [];
    const events = new Map();
    const observers = [];
    const window = {};
    window.top = window;
    const context = vm.createContext({
      window,
      location: {
        pathname: "/lesson/example/classroom",
        href: "https://echo360.net.au/lesson/example/classroom"
      },
      document: {
        title: "Example lecture",
        querySelector: () => ({})
      },
      chrome: {
        runtime: {
          sendMessage(message) {
            messages.push(message);
            if (mode === "throw") throw new Error("Extension context invalidated.");
            if (mode === "reject") return Promise.reject(new Error("Receiving end does not exist."));
            return Promise.resolve();
          },
          onMessage: { addListener() {} }
        }
      },
      addEventListener: (name, callback) => events.set(name, callback),
      MutationObserver: class {
        constructor(callback) { observers.push(callback); }
        observe() {}
      }
    });

    assert.doesNotThrow(() => vm.runInContext(source, context));
    await assert.doesNotReject(async () => observers[0]());
    assert.doesNotThrow(() => events.get("pagehide")());
    // Let rejected promises surface as unhandled rejections if not caught.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(messages.map(({ type }) => type), ["PAGE_INFO", "PAGE_INFO", "PAGE_UNLOAD"]);
    assert.equal(messages[0].title, "Example lecture");
    assert.equal(messages[0].pageUrl, "https://echo360.net.au/lesson/example/classroom");
  });
}
