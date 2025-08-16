// test/hyperproc.test.js
import { HyperProc, HyperSubProc, HyperProcError } from "../index.js";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("HyperProc core", () => {
  let hp;
  beforeEach(() => { hp = new HyperProc(); });

  test("run() rejects non-object state", async () => {
    await assert.rejects(() => hp.run(null), /expects an OBJECT as state/i);
    await assert.rejects(() => hp.run([]), /expects an OBJECT as state/i);
  });

  test("applyTo replaces state when fn returns new object", async () => {
    const out = await hp.applyTo(async s => ({ ...s, a: 1 })).run({});
    assert.deepEqual(out, { a: 1 });
  });

  // CHANGED: force bubbling so we see the applyTo guard error
  test("applyTo returning non-object rejects", async () => {
    await assert.rejects(
      () => new HyperProc()
              .applyTo(async () => 123)
              .onError(e => { throw e; }) // bubble
              .run({}),
      /applyTo must return an OBJECT as state/i
    );
  });

  test("transform updates property with (value, state, env)", async () => {
    const out = await hp
      .augment("a", async () => 1)
      .transform("a", async v => v + 1)
      .run({});
    assert.deepEqual(out, { a: 2 });
  });

  // CHANGED: use bubbling subclass to avoid default swallow
  test("transform throws if key missing (strict)", async () => {
    await assert.rejects(
      () => new HyperSubProc()
            .transform("missing", async v => (v ?? 0) + 1)
            .run({}),
      /transform.*missing property/i
    );
  });

  test("augment adds a new property from (state, env)", async () => {
    const out = await hp.augment("b", async () => 42).run({});
    assert.deepEqual(out, { b: 42 });
  });

  // CHANGED: use bubbling subclass to avoid default swallow
  test("augment throws if key exists (strict)", async () => {
    await assert.rejects(
      () => new HyperSubProc()
            .augment("b", async () => 1)
            .augment("b", async () => 2)
            .run({}),
      /augment.*already exists/i
    );
  });

  test("noop/log do not change state", async () => {
    const out = await hp
      .augment("x", async () => 1)
      .noop(async () => 123)
      .log("hello")
      .run({});
    assert.deepEqual(out, { x: 1 });
  });

  test("unknown operation bubbles HyperProcError with op/id", async () => {
    const hp2 = new HyperSubProc(); // bubbles by default
    hp2._ops.push({ id: "z", op: Symbol("BOGUS"), fn: async () => {} });
    await assert.rejects(
      () => hp2.run({}),
      e => e instanceof HyperProcError &&
           /Unknown Operation/.test(e.message) &&
           String(e.op).includes("BOGUS")
    );
  });

  test("default onError logs and returns state (swallow by default)", async () => {
    const out = await hp
      .augment("ok", async () => 1)
      .applyTo(async () => { throw new Error("boom"); })
      .augment("after", async () => 2) // not executed
      .run({});
    assert.deepEqual(out, { ok: 1 });
  });

  test("onError can recover by returning patched state", async () => {
    const out = await hp
      .augment("ok", async () => 1)
      .applyTo(async () => { throw new Error("boom"); })
      .onError((err, state) => ({ ...state, recovered: true }))
      .run({});
    assert.deepEqual(out, { ok: 1, recovered: true });
  });

  test("onError returning non-object rejects", async () => {
    await assert.rejects(
      () => hp
        .augment("v", async () => 7)
        .applyTo(async () => { throw new Error("boom"); })
        .onError(() => 123) // invalid recovery
        .run({}),
      /onError must return.*object/i
    );
  });

  test("onError returning undefined leaves state unchanged", async () => {
    const out = await hp
      .augment("v", async () => 7)
      .applyTo(async () => { throw new Error("boom"); })
      .onError(() => undefined)
      .run({});
    assert.deepEqual(out, { v: 7 });
  });

  test("errors are normalized to HyperProcError with cause", async () => {
    const out = await hp
      .applyTo(async () => { throw new TypeError("bad"); })
      .onError((err, state) => {
        assert.ok(err instanceof HyperProcError);
        assert.equal(err.cause?.name, "TypeError");
        assert.match(err.stack, /Caused by:/);
        return state;
      })
      .run({});
    assert.deepEqual(out, {});
  });

  test("async onError is awaited", async () => {
    const out = await new HyperProc()
      .augment("a", async () => 1)
      .applyTo(async () => { throw new Error("x"); })
      .onError(async (err, s) => {
        await new Promise(r => setTimeout(r, 5));
        return { ...s, recovered: true };
      })
      .run({});
    assert.deepEqual(out, { a: 1, recovered: true });
  });
});

describe("Chaining & subclassing", () => {
  test("chain() requires HyperProc instance", () => {
    const hp = new HyperProc();
    assert.throws(
      () => hp.chain({ run() {} }),
      e => e instanceof TypeError && /HyperProc/i.test(e.message)
    );
  });

  test("subclass factory returns subclass instances", () => {
    class HP2 extends HyperProc {}
    const inst = HP2.init({ k: 1 });
    assert.ok(inst instanceof HP2);
    assert.equal(inst._env.k, 1);
  });

  test("chaining with base HyperProc keeps child default swallow", async () => {
    const child = new HyperProc()
      .augment("fromChild", async () => 1)
      .applyTo(async () => { throw new Error("child boom"); });

    const parent = new HyperProc().chain(child);
    const out = await parent.run({});
    assert.deepEqual(out, { fromChild: 1 });
  });

  test("chaining HyperSubProc bubbles to parent and parent can recover", async () => {
    const child = new HyperSubProc()
      .augment("fromChild", async () => 1)
      .applyTo(async () => { throw new Error("child boom"); });

    const parent = new HyperProc()
      .chain(child)
      .onError((err, state) => ({ ...state, parentRecovered: true }));

    const out = await parent.run({});
    assert.deepEqual(out, { fromChild: 1, parentRecovered: true });
  });

  test("child HyperSubProc bubble propagates if parent also throws", async () => {
    const child = new HyperSubProc()
      .augment("x", async () => 1)
      .applyTo(async () => { throw new Error("boom"); });

    const parent = new HyperProc()
      .chain(child)
      .onError((err) => { throw err; });

    await assert.rejects(() => parent.run({}), e => {
      assert.ok(e instanceof HyperProcError);
      assert.match(e.message, /boom/);
      return true;
    });
  });

  test("CHAIN uses child's env/handler", async () => {
    const child = new HyperSubProc({ inc: n => n + 10 })
      .applyTo(async (s, env) => ({ child: env.inc(0) }));
    const parent = new HyperProc({ inc: n => n + 1 }).chain(child);
    const out = await parent.run({});
    assert.deepEqual(out, { child: 10 });
  });

  test("parent continues after CHAIN completes", async () => {
    const child = new HyperProc().augment("c", async () => 1);

    const out = await new HyperProc()
      .augment("p", async () => 1)
      .chain(child)
      .augment("q", async (state) => state.p + state.c)
      .run({});
    assert.deepEqual(out, { p: 1, c: 1, q: 2 });
  });

  // CHANGED: both child and parent bubble so we see the CHAIN guard error
  test("CHAIN returning non-object rejects", async () => {
  // Child returns a non-object from run(), so parent's CHAIN guard is exercised.
  class BadChild extends HyperProc {
    async run(state) { return 123; }
  }
  const child = new BadChild();

  await assert.rejects(
    () => new HyperSubProc()   // parent bubbles
          .chain(child)
          .run({}),
    /chain must return an OBJECT as state/i
  );
});
});

describe("Error class", () => {
  test("HyperProcError.toJSON has stable shape", () => {
    const e = new HyperProcError("msg", { op: undefined });
    const j = e.toJSON();
    assert.equal(j.name, "HyperProcError");
    assert.equal(j.message, "msg");
    assert.equal(typeof j.op, "string");
    assert.equal(j.op, "UNDEFINED");
  });
});
