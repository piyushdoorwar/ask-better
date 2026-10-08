// Loads the extension's classic (non-module) scripts into an isolated vm
// context so their top-level functions can be unit-tested without a browser.
// `chrome` is a permissive stub: any property chain resolves, and any call is a
// no-op returning undefined (or a resolved promise for storage reads), which is
// enough for the load-time listener registrations these files perform.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");

function permissiveStub() {
  const handler = {
    get(target, prop) {
      if (prop === "then") return undefined; // never look like a thenable
      if (!(prop in target)) target[prop] = new Proxy(function () {}, handler);
      return target[prop];
    },
    apply() {
      return undefined;
    }
  };
  return new Proxy(function () {}, handler);
}

function makeChrome(overrides = {}) {
  const store = {};
  const chrome = permissiveStub();
  chrome.storage = {
    local: {
      async get(keys) {
        if (keys == null) return { ...store };
        const list = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
      },
      async set(obj) { Object.assign(store, obj); },
      async remove(keys) { for (const k of [].concat(keys)) delete store[k]; },
      async clear() { for (const k of Object.keys(store)) delete store[k]; }
    },
    onChanged: { addListener() {} }
  };
  chrome.__store = store;
  return Object.assign(chrome, overrides);
}

/**
 * Runs the given repo-relative files, in order, in one fresh context and
 * returns that context (its globals are the scripts' top-level declarations).
 * Top-level `const`/`let`/`class` bindings are not context properties, so each
 * file is followed by a snippet that copies the requested names onto `exports`.
 */
function loadScripts(files, { expose = [], globals = {} } = {}) {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    structuredClone,
    fetch: async () => { throw new Error("network disabled in tests"); },
    chrome: makeChrome(),
    exports: {},
    ...globals
  };
  vm.createContext(context);
  const source = files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
  const exposeSnippet = expose
    .map((name) => `try { exports[${JSON.stringify(name)}] = ${name}; } catch (_e) {}`)
    .join("\n");
  vm.runInContext(`${source}\n;\n${exposeSnippet}`, context, { filename: files.join("+") });
  return { context, exports: crossRealm(context.exports) };
}

// Objects created inside the vm have that realm's Array/Object prototypes, so
// assert.deepStrictEqual rejects them even when the values match. Exposed
// functions are wrapped to hand back plain main-realm copies of their results.
function toMainRealm(value) {
  if (value === null || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_e) {
    return value; // DOM-like or cyclic: leave as is
  }
}

function crossRealm(exportsObj) {
  const out = {};
  for (const [name, value] of Object.entries(exportsObj)) {
    if (typeof value !== "function") {
      out[name] = value;
      continue;
    }
    out[name] = (...args) => {
      const result = value(...args);
      return result && typeof result.then === "function" ? result.then(toMainRealm) : toMainRealm(result);
    };
  }
  return out;
}

module.exports = { loadScripts, makeChrome, ROOT };
