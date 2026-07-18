import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLatestBundle, outputPaths, readMetadata, validateBundle } from "../lib.js";

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

test("rejects track path traversal", () => {
  const { root, directory } = fixture();
  const metadataPath = path.join(directory, "echo360.json");
  const data = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  data.tracks[0].filename = "../outside.mp4";
  fs.writeFileSync(metadataPath, JSON.stringify(data));
  assert.throws(() => readMetadata(directory), /安全ではありません/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("rejects output path traversal", () => {
  const { root, directory } = fixture();
  const { data } = readMetadata(directory);
  data.outputs = { source1: "../../overwrite.mp4" };
  assert.throws(() => outputPaths(directory, data), /安全ではありません/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("rejects symlinked input tracks", () => {
  const { root, directory } = fixture();
  const audio = path.join(directory, "audio-q1.mp4");
  fs.rmSync(audio);
  fs.symlinkSync(path.join(directory, "source-1-q1.mp4"), audio);
  const { data } = readMetadata(directory);
  assert.throws(() => validateBundle(directory, data), /通常ファイルではありません/);
  fs.rmSync(root, { recursive: true, force: true });
});
