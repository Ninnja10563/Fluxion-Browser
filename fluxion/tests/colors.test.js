"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const colors = require("../chrome/core/colors.js");

test("custom color preferences admit only six-digit hex and explicit boolean enablement", () => {
  assert.equal(colors.hex(" #AbC012 "), "#abc012");
  for (const value of ["red", "#fff", "#12345678", "url(https://example.org)", "#fff; color:red", {}, null, 123456]) {
    assert.equal(colors.hex(value), null);
  }
  assert.deepEqual(colors.decode("not json"), colors.DEFAULTS);
  assert.deepEqual(colors.decode("null"), colors.DEFAULTS);
  assert.deepEqual(colors.decode('{"enabled":"true","light":{"base":"red"}}'), colors.DEFAULTS);
  assert.deepEqual(colors.normalise({ enabled: true, light: { base: "#ABCDEF" }, dark: { accent: "#123456" } }), {
    enabled: true, light: { base: "#abcdef", accent: colors.DEFAULTS.light.accent },
    dark: { base: colors.DEFAULTS.dark.base, accent: "#123456" },
  });
  assert.throws(() => colors.palette({ base: "red", accent: "#ffffff" }), TypeError);
});

test("derived ink, muted labels and accents retain AA text contrast on every custom surface", () => {
  const bases = new Set();
  for (let channel = 0; channel <= 255; channel++) bases.add("#" + channel.toString(16).padStart(2, "0").repeat(3));
  for (const r of [0, 51, 102, 153, 204, 255]) for (const g of [0, 51, 102, 153, 204, 255]) for (const b of [0, 51, 102, 153, 204, 255]) {
    bases.add("#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join(""));
  }
  for (const base of bases) {
    for (const accent of [base, "#ff00ff", "#00ffff"]) {
      const palette = colors.palette({ base, accent });
      assert.equal(palette.bg, base, "the requested base is not silently replaced");
      for (const foreground of ["ink", "muted", "accent"]) for (const background of ["bg", "bg-raised", "selected", "hover"]) {
        assert.ok(colors.contrast(palette[foreground], palette[background]) >= 4.5,
          `${base} ${accent}: ${foreground} ${palette[foreground]} on ${background} ${palette[background]}`);
      }
    }
  }
});

test("disabled colors leave the shipping stylesheet untouched and enabled colors project both schemes", () => {
  assert.deepEqual(colors.variables(colors.DEFAULTS), {});
  const settings = colors.normalise({ enabled: true });
  const variables = colors.variables(settings);
  assert.equal(Object.keys(variables).length, colors.TOKENS.length);
  assert.equal(variables["--fluxion-bg"], "light-dark(#e9eae7, #1c1e20)");
  for (const [key, value] of Object.entries(variables)) {
    assert.match(key, /^--fluxion-[a-z-]+$/);
    assert.match(value, /^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/);
  }
});
