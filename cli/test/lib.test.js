import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanupSourceTracks,
  findBundles,
  findLatestBundle,
  outputPaths,
  readMetadata,
  sourceTracksAreDeleted,
  validateBundle,
  validateCompletedOutputs
} from "../lib.js";

function fixture(root = fs.mkdtempSync(path.join(os.tmpdir(), "echo360-cli-"))) {
  const directory = path.join(root, "lecture");
  fs.mkdirSync(directory, { recursive: true });
  const tracks = [
    { role: "source-1", filename: "source-1-q1.mp4", size: 3 },
    { role: "source-2", filename: "source-2-q1.mp4", size: 3 },
    { role: "audio", filename: "audio-q1.mp4", size: 3 }
  ];
  fs.writeFileSync(path.join(directory, "echo360.json"), JSON.stringify({ schemaVersion: 1, tracks }));
  for (const track of tracks) fs.writeFileSync(path.join(directory, track.filename), "abc");
  return { root, directory };
}

function completedMp4() {
  return Buffer.from("000000186674797069736f6d00000000", "hex");
}

function createLink(context, create, label) {
  try {
    create();
    return true;
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      throw error;
    }
    context.skip(`Windows does not permit creating this ${label}: ${error.code}`);
    return false;
  }
}

test("finds and validates a downloaded bundle", () => {
  const { root, directory } = fixture();
  assert.equal(findLatestBundle(root), directory);
  const { data } = readMetadata(directory);
  assert.equal(validateBundle(directory, data).length, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test("finds bundles recursively in a stable order", () => {
  const first = fixture();
  const nested = path.join(first.root, "course", "week-02");
  const second = fixture(nested);

  assert.deepEqual(findBundles(first.root), [second.directory, first.directory]);
  fs.rmSync(first.root, { recursive: true, force: true });
});

test("does not follow symlinked directories while scanning recursively", (context) => {
  const { root, directory } = fixture();
  const outside = fixture();
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside.root, { recursive: true, force: true });
  });
  const type = process.platform === "win32" ? "junction" : "dir";
  if (!createLink(context, () => fs.symlinkSync(outside.root, path.join(root, "linked"), type), type)) return;

  assert.deepEqual(findBundles(root), [directory]);
});

test("rejects an incomplete track", () => {
  const { root, directory } = fixture();
  fs.writeFileSync(path.join(directory, "audio-q1.mp4"), "a");
  const { data } = readMetadata(directory);
  assert.throws(() => validateBundle(directory, data), /未完了/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("accepts a bundle with one video source and audio", () => {
  const { root, directory } = fixture();
  const metadataPath = path.join(directory, "echo360.json");
  const data = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  data.tracks = data.tracks.filter((track) => track.role !== "source-2");
  fs.writeFileSync(metadataPath, JSON.stringify(data));
  fs.rmSync(path.join(directory, "source-2-q1.mp4"));

  const { data: metadata } = readMetadata(directory);
  assert.deepEqual(
    validateBundle(directory, metadata).map((track) => track.role),
    ["source-1", "audio"]
  );
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

test("rejects symlinked input tracks", (context) => {
  const { root, directory } = fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const audio = path.join(directory, "audio-q1.mp4");
  fs.rmSync(audio);
  const source = path.join(directory, "source-1-q1.mp4");
  if (!createLink(context, () => fs.symlinkSync(source, audio, "file"), "file symlink")) return;
  const { data } = readMetadata(directory);
  assert.throws(() => validateBundle(directory, data), /通常ファイルではありません/);
});

test("deletes source tracks only after every required output exists", () => {
  const { root, directory } = fixture();
  const { data } = readMetadata(directory);
  const outputs = outputPaths(directory, data);
  fs.writeFileSync(outputs.source1, completedMp4());
  fs.writeFileSync(outputs.source2, completedMp4());

  assert.equal(validateCompletedOutputs(directory, data).length, 2);
  const deleted = cleanupSourceTracks(directory, data);
  assert.equal(deleted.length, 3);
  assert.equal(sourceTracksAreDeleted(directory, data), true);
  assert.equal(fs.existsSync(path.join(directory, "echo360.json")), true);
  assert.equal(cleanupSourceTracks(directory, data).length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("does not delete any source track when an output is missing", () => {
  const { root, directory } = fixture();
  const { data } = readMetadata(directory);
  const outputs = outputPaths(directory, data);
  fs.writeFileSync(outputs.source1, completedMp4());

  assert.throws(() => cleanupSourceTracks(directory, data), /作成済みの音声付き出力がありません/);
  for (const track of data.tracks) {
    assert.equal(fs.existsSync(path.join(directory, track.filename)), true);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("refuses to treat an original track as a completed output", () => {
  const { root, directory } = fixture();
  const { data } = readMetadata(directory);
  data.outputs = { source1: "source-1-q1.mp4" };
  assert.throws(() => cleanupSourceTracks(directory, data), /出力先が元トラックと同じ/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("refuses to treat a hard link to an original track as output", (context) => {
  const { root, directory } = fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { data } = readMetadata(directory);
  const outputs = outputPaths(directory, data);
  fs.rmSync(path.join(directory, "source-1-q1.mp4"));
  fs.writeFileSync(path.join(directory, "source-1-q1.mp4"), completedMp4());
  data.tracks.find((track) => track.role === "source-1").size = completedMp4().length;
  const source = path.join(directory, "source-1-q1.mp4");
  if (!createLink(context, () => fs.linkSync(source, outputs.source1), "hard link")) return;
  fs.writeFileSync(outputs.source2, completedMp4());

  assert.throws(() => cleanupSourceTracks(directory, data), /出力先が元トラックと同じ実体/);
  assert.equal(fs.existsSync(path.join(directory, "source-1-q1.mp4")), true);
});

test("does not delete sources when an output is not a valid MP4", () => {
  const { root, directory } = fixture();
  const { data } = readMetadata(directory);
  const outputs = outputPaths(directory, data);
  fs.writeFileSync(outputs.source1, "not-an-mp4-file");
  fs.writeFileSync(outputs.source2, completedMp4());

  assert.throws(() => cleanupSourceTracks(directory, data), /MP4として不正/);
  for (const track of data.tracks) {
    assert.equal(fs.existsSync(path.join(directory, track.filename)), true);
  }
  fs.rmSync(root, { recursive: true, force: true });
});
