import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLatestBundle, readMetadata, validateBundle } from "../lib.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "echo360-cli-"));
  const directory = path.join(root, "lecture");
  fs.mkdirSync(directory);
  const tracks = [
    { role: "source-1", filename: "source-1-q1.mp4", size: 3 },
    { role: "source-2", filename: "source-2-q1.mp4", size: 3 },
    { role: "audio", filename: "audio-q1.mp4", size: 3 }
  ];
  fs.writeFileSync(path.join(directory, "echo360.json"), JSON.stringify({ schemaVersion: 1, tracks }));
  for (const track of tracks) fs.writeFileSync(path.join(directory, track.filename), "abc");
  return { root, directory };
}

test("finds and validates a downloaded bundle", () => {
  const { root, directory } = fixture();
  assert.equal(findLatestBundle(root), directory);
  const { data } = readMetadata(directory);
  assert.equal(validateBundle(directory, data).length, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test("rejects an incomplete track", () => {
  const { root, directory } = fixture();
  fs.writeFileSync(path.join(directory, "audio-q1.mp4"), "a");
  const { data } = readMetadata(directory);
  assert.throws(() => validateBundle(directory, data), /未完了/);
  fs.rmSync(root, { recursive: true, force: true });
});
