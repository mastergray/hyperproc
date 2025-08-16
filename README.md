# HyperProc

Chainable, async pipeline over an explicit state object.

* Linear ops: `applyTo`, `transform`, `augment`, `noop/log`, `chain`
* Per-instance `env` injected into every op
* Clear error semantics via `HyperProcError`
* Subclassable policy (e.g., bubbling vs. swallowing errors)

> **Default error policy:** `onError` logs and **returns the last good state** (swallow). Override or subclass to bubble.

---

## Table of Contents

* [Why](#why)
* [Quick Start](#quick-start)
* [Semantics](#semantics)
* [API](#api)
* [Errors (`HyperProcError`)](#errors-hyperprocerror)
* [Examples](#examples)
* [Notes](#notes)
* [TODO](#todo)
* [License](#license)

---

## Why

You often need a precise, deterministic pipeline over a single state object, with explicit control of mutation vs. replacement and predictable error behavior. HyperProc gives you that with a minimal surface.

---

## Quick Start

```js
import HyperProc from "hyperproc"; // adjust name/path if different

const hp = HyperProc.init({ inc: n => n + 1 });

const out = await hp
  .augment("a", async () => 1)                          // state.a = 1
  .transform("a", async (v) => v + 1)                   // state.a = 2
  .applyTo(async (s, env) => ({ ...s, b: env.inc(1) })) // replace state (must be a plain object)
  .log(s => `a=${s.a}, b=${s.b}`)
  .run({});                                             // => { a: 2, b: 2 }
```

---

## Semantics

* **State contract:** state is a **plain object** (prototype is `Object.prototype` or `null`).
  Replacement steps (`applyTo`, `chain`) must also return a plain object.
* **Mutation model:**

  * `transform(id, f)` **updates an existing key** (throws if missing).
  * `augment(id, f)` **creates a new key** (throws if it already exists).
  * `applyTo(f)` may **replace** the state; result is validated.
* **Env:** per-instance object passed into every op.
* **Chaining:** `chain(child)` runs the child pipeline using the **child’s** `env` and `onError`.
* **Errors:** any thrown error inside ops is normalized to `HyperProcError` before your `onError` runs.

---

## API

Types: `STATE := PlainObject`, `ENV := Object`, `ID := String`, `VALUE := any`.
`T*` means `T | Promise<T>`.

### Constructor & Statics

```
new HyperProc           :: ENV -> this
HyperProc.init          :: ENV -> this         // subclass-friendly factory
HyperProc.isState       :: * -> BOOL           // plain-object check
APPLY_TO, TRANSFORM, AUGMENT, CHAIN, NOOP :: Symbol
```

### Instance methods

```
applyTo   :: (STATE, ENV) -> STATE* -> this
transform :: ID -> (VALUE, STATE, ENV) -> VALUE* -> this
augment   :: ID -> (STATE, ENV) -> VALUE* -> this
noop      :: (STATE, ENV) -> any* -> this
log       :: (STATE, ENV) -> STRING*  |  STRING -> this
onError   :: (HyperProcError, STATE, ENV) -> (STATE | undefined)* -> this
chain     :: HyperProc -> this
run       :: STATE -> Promise<STATE>
```

**Operational notes**

* `applyTo` **validates** its return; throws if not a plain object.
* `transform` **requires** the key to exist; throws if missing.
* `augment` **requires** the key to not exist; throws if present.
* `chain` uses the child’s `env` and `onError`; the parent validates the child’s returned state (must be plain object).
* `run` throws if the input is not a plain object.
* `onError` contract:

  * **return `STATE`** → recover with that state (must be plain object).
  * **return `undefined`** → keep the last good state (swallow).
  * **throw** → bubble to caller (or to parent pipeline).

---

## Errors (`HyperProcError`)

Normalized error passed to your `onError` and used for bubbling.

Core fields:

* `name: "HyperProcError"`
* `message: string`
* `op: Symbol | undefined` (serialized to a string; absent appears as `"UNDEFINED"` in `toJSON()`)
* `id: string | undefined`
* `cause?: Error` (native `Error.cause` used; stack chain preserved)
* `state` may be attached as non-enumerable (not emitted via `toJSON()`)

Example handling:

```js
try {
  await HyperProc.init()
    .applyTo(() => { throw new TypeError("bad"); })
    .run({});
} catch (e) {
  if (e.name === "HyperProcError") {
    console.error(e.message, String(e.op), e.id, e.cause?.name);
  }
}
```

---

## Examples

### Error recovery (override default swallow)

```js
const out = await HyperProc.init()
  .augment("n", () => 5)
  .transform("n", (v) => { if (v > 3) throw new Error("too big"); return v; })
  .onError((err, s) => ({ ...s, n: 3, recovered: true }))
  .run({});
// => { n: 3, recovered: true }
```

### Bubbling child via subclass

```js
import HyperProc from "hyperproc";

export class HyperSubProc extends HyperProc {
  constructor(env = {}) { super(env); this._onError = (err) => { throw err; }; }
}

const child = HyperSubProc.init()
  .augment("x", () => 1)
  .applyTo(() => { throw new Error("boom"); });   // bubbles

const parent = HyperProc.init()
  .chain(child)
  .onError((err, s) => ({ ...s, parentRecovered: true }));

const res = await parent.run({});
// => { x: 1, parentRecovered: true }
```

### ETL-style

```js
const etl = HyperProc.init({ parse: JSON.parse })
  .applyTo((s) => ({ raw: '{"a":1,"b":2}', ...s }))
  .augment("doc", (s, env) => env.parse(s.raw))
  .augment("sum", (s) => s.doc.a + s.doc.b);

await etl.run({}); // => { raw:'...', doc:{a:1,b:2}, sum:3 }
```

---

## Notes

* Reusing the same instance **accumulates ops**; treat an instance as a small program.
* In a chain, the parent continues after the child completes; subsequent parent ops see the child’s mutations/replacement.
* To assert on thrown errors in tests, use a bubbling policy (`.onError(e => { throw e; })` or a subclass like `HyperSubProc`).
* Docs were created by AI. Because that's the world we live in now...

---

## TODO

---

- pause :: NUMBER, (state, env) -> PROMISE(STRING)|STRING|VOID -> this
- startTimer ::  (state, env) -> PROMISE(STRING)-> this
- stopTimer :: (timeElapsed, state, env) -> PROMISE(STRING) -> this
- branch :: (state, env) -> PROMISE(BOOL), {TRUE:HYPERPROC|VOID, FALSE:HYPERPROCVOID} -> this
- batch :: [HyperProc], (([STATE], STATE, ENV) -> STATE*) ?, { clone?: 'structured'|'shallow'|(STATE->STATE), settle?: 'fail-fast'|'all' } ? -> this


---

## License

MIT
