import { describe, expect, it } from "vitest";
import { layoutIslands, type IslandInput } from "./islands";

const island = (id: string, height: number, base: number, open = false, extra = 100): IslandInput => ({
  id,
  height,
  base,
  extra,
  open,
});

const plain = { width: 760, top: 12, gap: 10, notch: null };
const notched = { ...plain, top: 8, notch: { width: 200, height: 32 } };

describe("layoutIslands without a notch", () => {
  it("stacks centred capsules from the top", () => {
    const [a, b] = layoutIslands([island("a", 60, 300), island("b", 42, 200)], plain);
    expect(a).toMatchObject({ x: 230, y: 12, w: 300, h: 60, radius: 30, pad: 0, inset: 0, notched: false });
    expect(b).toMatchObject({ x: 280, y: 82, w: 200, h: 42, radius: 21, notched: false });
  });

  it("widens an open island by its actions", () => {
    const [a] = layoutIslands([island("a", 60, 300, true)], plain);
    expect(a).toMatchObject({ x: 180, w: 400 });
  });
});

describe("layoutIslands with a notch", () => {
  it("grows the first island out of the notch, content below it", () => {
    const [a] = layoutIslands([island("a", 60, 300)], notched);
    expect(a).toMatchObject({ x: 230, y: 0, w: 300, h: 92, pad: 32, inset: 0, notched: true, radius: 30 });
  });

  it("keeps a narrow island wider than the notch and centres its content", () => {
    const [a] = layoutIslands([island("a", 42, 180)], notched);
    expect(a).toMatchObject({ w: 248, x: 256, inset: 34 });
  });

  it("puts the following islands below as plain capsules", () => {
    const [, b] = layoutIslands([island("a", 60, 300), island("b", 42, 200)], notched);
    expect(b).toMatchObject({ y: 102, h: 42, pad: 0, notched: false });
  });
});
