import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../bin/echo360-merge.js", import.meta.url));

test("merges a bundle and deletes its source tracks", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "echo360-merge-test-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, "lecture");
  const bin = path.join(root, "bin");
  fs.mkdirSync(bundle);
  fs.mkdirSync(bin);

  const tracks = [
    { role: "source-1", filename: "source-1-q1.mp4", size: 3 },
    { role: "audio", filename: "audio-q1.mp4", size: 3 }
  ];
  fs.writeFileSync(path.join(bundle, "echo360.json"), JSON.stringify({ schemaVersion: 1, tracks }));
  for (const track of tracks) fs.writeFileSync(path.join(bundle, track.filename), "abc");

  const fakeFfmpegScript = path.join(bin, "ffmpeg.js");
  fs.writeFileSync(fakeFfmpegScript, [
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "if (args[0] !== '-version') fs.writeFileSync(args.at(-1), Buffer.from('000000186674797069736f6d00000000', 'hex'));"
  ].join("\n"));
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(bin, "ffmpeg.cmd"), `@node "%~dp0\\ffmpeg.js" %*\r\n`);
  } else {
    const executable = path.join(bin, "ffmpeg");
    fs.writeFileSync(executable, `#!/usr/bin/env node\n${fs.readFileSync(fakeFfmpegScript, "utf8")}\n`);
    fs.chmodSync(executable, 0o755);
  }

  const result = spawnSync(process.execPath, [cliPath, bundle, "--combined", "--delete-sources"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` }
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
