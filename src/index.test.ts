import { describe, expect, it } from "vitest";
import entry from "./index.js";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";

describe("jev-trigger plugin", () => {
  it("declares the jev_when tool", () => {
    const meta = getToolPluginMetadata(entry);
    expect(meta?.id).toBe("jev-trigger");
    expect(meta?.tools.map((t) => t.name)).toEqual(["jev_when"]);
  });
});
