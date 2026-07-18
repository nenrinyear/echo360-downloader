import test from "node:test";
import assert from "node:assert/strict";
import {
  parseContentRange,
  parseMediaUrl,
  sanitizeFilename
} from "../media-model.js";

test("parses an Echo360 media URL without exposing its query in safeUrl", () => {
  const result = parseMediaUrl(
    "https://content.echo360.net.au/account/media/1/s2q1.mp4?secret=value"
  );
  assert.equal(result.kind, "media");
  assert.equal(result.trackType, "video");
  assert.equal(result.source, 2);
  assert.equal(result.quality, 1);
  assert.equal(result.safeUrl, "https://content.echo360.net.au/account/media/1/s2q1.mp4");
});

test("classifies source zero as audio", () => {
  const result = parseMediaUrl("https://content.echo360.net.au/a/b/s0q0.mp4");
  assert.equal(result.trackType, "audio");
});

test("rejects non-Echo360 hosts", () => {
  assert.equal(parseMediaUrl("https://example.com/s1q1.mp4"), null);
});

test("parses Content-Range", () => {
  assert.deepEqual(parseContentRange("bytes 100-199/1000"), {
    start: 100,
    end: 199,
    total: 1000
  });
});

test("sanitizes download names", () => {
  assert.equal(sanitizeFilename(' Lecture: A/B?  '), "Lecture_ A_B_");
});
