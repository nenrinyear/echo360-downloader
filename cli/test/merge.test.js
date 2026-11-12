import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../bin/echo360-merge.js", import.meta.url));

test("merges a bundle and deletes its source tracks", (context) => {
  const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (ffmpeg.error?.code === "ENOENT") {
    context.skip("FFmpeg is not on PATH");
    return;
  }
  assert.ifError(ffmpeg.error);
  assert.equal(ffmpeg.status, 0, ffmpeg.stderr);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "echo360-merge-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, "講義 01");
  fs.mkdirSync(bundle);

  const tracks = [
    { role: "source-1", filename: "source-1-q1.mp4", input: "color=s=64x64:r=10", codec: ["-c:v", "mpeg4"] },
    { role: "audio", filename: "audio-q1.mp4", input: "sine=frequency=440", codec: ["-c:a", "aac"] }
  ].map(({ role, filename, input, codec }) => {
    const trackPath = path.join(bundle, filename);
    const result = spawnSync("ffmpeg", [
      "-v", "error", "-f", "lavfi", "-i", input, "-t", "0.5", ...codec, trackPath
    ], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return { role, filename, size: fs.statSync(trackPath).size };
  });
  fs.writeFileSync(path.join(bundle, "echo360.json"), JSON.stringify({ schemaVersion: 1, tracks }));

  const result = spawnSync(process.execPath, [cliPath, bundle, "--combined", "--delete-sources"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(bundle, "source-1-with-audio.mp4")).subarray(4, 8).toString("ascii"), "ftyp");
  assert.equal(fs.existsSync(path.join(bundle, "source-2-with-audio.mp4")), false);
  assert.equal(fs.existsSync(path.join(bundle, "combined.mp4")), false);
  assert.equal(fs.existsSync(path.join(bundle, "source-1-q1.mp4")), false);
  assert.equal(fs.existsSync(path.join(bundle, "audio-q1.mp4")), false);
  assert.equal(fs.existsSync(path.join(bundle, "echo360.json")), true);
  assert.match(result.stdout, /左右合成にはSource 1とSource 2の両方が必要/);
  assert.match(result.stdout, /元トラックを削除しました \(2ファイル\)/);
});

test("cleanup mode deletes sources without requiring ffmpeg", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "echo360-cleanup-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, "lecture");
  fs.mkdirSync(bundle);
  const tracks = [
    { role: "source-1", filename: "source-1-q1.mp4", size: 3 },
    { role: "audio", filename: "audio-q1.mp4", size: 3 }
  ];
  fs.writeFileSync(path.join(bundle, "echo360.json"), JSON.stringify({ schemaVersion: 1, tracks }));
  for (const track of tracks) fs.writeFileSync(path.join(bundle, track.filename), "abc");
  fs.writeFileSync(
    path.join(bundle, "source-1-with-audio.mp4"),
    Buffer.from("000000186674797069736f6d00000000", "hex")
  );

  const result = spawnSync(process.execPath, [cliPath, bundle, "--cleanup"], {
    encoding: "utf8",
    env: { ...process.env, PATH: "" }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(bundle, "source-1-q1.mp4")), false);
  assert.equal(fs.existsSync(path.join(bundle, "audio-q1.mp4")), false);
  assert.equal(fs.existsSync(path.join(bundle, "echo360.json")), true);
  assert.match(result.stdout, /元トラックを削除しました \(2ファイル\)/);
});
