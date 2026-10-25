/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { shouldOpenImageZoom } from "@/lib/image-zoom";

describe("shouldOpenImageZoom", () => {
  it("opens ordinary catalog photos", () => {
    const image = document.createElement("img");
    image.src = "https://example.test/style.jpg";
    expect(shouldOpenImageZoom(image)).toBe(true);
  });

  it("skips avatars and upload wells", () => {
    const avatar = document.createElement("img");
    avatar.src = "https://example.test/me.jpg";
    avatar.setAttribute("data-no-zoom", "true");
    expect(shouldOpenImageZoom(avatar)).toBe(false);

    const well = document.createElement("label");
    well.className = "file-well";
    const image = document.createElement("img");
    image.src = "https://example.test/preview.jpg";
    well.append(image);
    expect(shouldOpenImageZoom(image)).toBe(false);
  });
});
