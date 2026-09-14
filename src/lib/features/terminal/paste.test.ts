import { describe, expect, it } from "vitest";
import { clipboardHasNoText } from "./paste";

describe("clipboardHasNoText", () => {
  it("recognises the plugin's answer for an image on the clipboard", () => {
    expect(
      clipboardHasNoText(
        "The clipboard contents were not available in the requested format or the clipboard is empty.",
      ),
    ).toBe(true);
  });

  it("reads an Error the same as a string", () => {
    expect(clipboardHasNoText(new Error("the clipboard is empty"))).toBe(true);
  });

  it("leaves a clipboard the OS refused to the caller's error path", () => {
    expect(clipboardHasNoText("Access is denied. (os error 5)")).toBe(false);
    expect(clipboardHasNoText("no clipboard on this platform")).toBe(false);
  });
});
