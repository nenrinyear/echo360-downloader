import test from "node:test";
import assert from "node:assert/strict";
import {
  findDownloadableQualities,
  normalizeDownloadFolder,
  normalizeLessonEntries,
  parseContentRange,
  parseEchoPageUrl,
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

test("normalizes a Downloads-relative custom folder", () => {
  assert.equal(normalizeDownloadFolder("  授業\\Echo360  "), "授業/Echo360");
  assert.equal(normalizeDownloadFolder("大学/音響メディア論"), "大学/音響メディア論");
});

test("rejects unsafe custom download folders", () => {
  for (const folder of ["", "/tmp/Echo360", "C:/Echo360", "../Echo360", "a//b", "a/./b", "a:name", "CON"]) {
    assert.throws(() => normalizeDownloadFolder(folder));
  }
});

test("classifies Echo360 lesson and section URLs", () => {
  assert.equal(parseEchoPageUrl("https://echo360.net.au/lesson/abc/classroom").kind, "lesson");
  assert.equal(
    parseEchoPageUrl("https://echo360.net.au/lesson/G_11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222_2026-04-14T09:00:00.000_2026-04-14T10:30:00.000/classroom").kind,
    "lesson"
  );
  assert.equal(parseEchoPageUrl("https://echo360.net.au/section/abc/home").kind, "section");
  assert.equal(parseEchoPageUrl("https://example.com/lesson/abc"), null);
});

test("normalizes and deduplicates section lesson entries", () => {
  const entries = normalizeLessonEntries([
    { url: "/lesson/one/classroom", title: " Week 1 " },
    { url: "https://echo360.net.au/lesson/one/classroom#details", title: "duplicate" },
    { url: "https://example.com/lesson/two", title: "outside" },
    { url: "/lesson/two/classroom", title: "Week 2" }
  ], "https://echo360.net.au/section/course/home");
  assert.deepEqual(entries, [
    { url: "https://echo360.net.au/lesson/one/classroom", title: "Week 1" },
    { url: "https://echo360.net.au/lesson/two/classroom", title: "Week 2" }
  ]);
});

test("accepts audio with either one or two video sources", () => {
  const oneVideo = {
    "0:1": { source: 0, quality: 1, size: 100 },
    "1:1": { source: 1, quality: 1, size: 200 }
  };
  assert.deepEqual(findDownloadableQualities(oneVideo), [1]);
  assert.deepEqual(findDownloadableQualities(oneVideo, true), []);

  const twoVideos = {
    ...oneVideo,
    "2:1": { source: 2, quality: 1, size: 300 }
  };
  assert.deepEqual(findDownloadableQualities(twoVideos, true), [1]);
  assert.deepEqual(findDownloadableQualities({ "1:1": oneVideo["1:1"] }), []);
});
