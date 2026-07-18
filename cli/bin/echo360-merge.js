#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  findLatestBundle,
  outputPaths,
  readMetadata,
  validateBundle
} from "../lib.js";

function usage() {
  console.log(`使い方:
  echo360-merge [講義フォルダ] [--combined]

引数を省略すると ~/Downloads/Echo360 の最新講義を自動検出します。

オプション:
  --root <path>   自動検索するルートを変更
  --combined      2映像を左右に並べた動画も作成
  --force         既存の出力を上書き
  --help          このヘルプを表示`);
}

function commandExists(command) {
  return spawnSync(command, ["-version"], { stdio: "ignore" }).status === 0;
}

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-stats", ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg が終了コード ${result.status} で失敗しました。`);
}

function parseArgs(argv) {
  const options = { combined: false, force: false, root: path.join(os.homedir(), "Downloads", "Echo360"), directory: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--combined") options.combined = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--root") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--rootにはパスが必要です。");
      options.root = path.resolve(value);
    }
    else if (arg.startsWith("-")) throw new Error(`不明なオプションです: ${arg}`);
    else if (!options.directory) options.directory = path.resolve(arg);
    else throw new Error("講義フォルダは1つだけ指定できます。");
  }
  return options;
}

function safelyCreateOutput(output, force, ffmpegArgs) {
  if (fs.existsSync(output) && !force) {
    console.log(`\nスキップ: ${path.basename(output)} は作成済みです。`);
    return;
  }
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) {
    throw new Error(`出力先にsymlinkは使用できません: ${output}`);
  }
  const temporary = `${output}.partial-${process.pid}.mp4`;
  try {
    fs.rmSync(temporary, { force: true });
    runFfmpeg([
      "-n",
      ...ffmpegArgs,
      temporary
    ]);
    try {
      fs.renameSync(temporary, output);
    } catch (error) {
      const replaceableOnWindows = force && ["EEXIST", "EPERM"].includes(error.code);
      if (!replaceableOnWindows || !fs.existsSync(output)) throw error;
      const outputStat = fs.lstatSync(output);
      if (outputStat.isSymbolicLink() || !outputStat.isFile()) {
        throw new Error(`安全に置換できない出力先です: ${output}`);
      }
      fs.rmSync(output);
      fs.renameSync(temporary, output);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function mux(video, audio, output, force) {
  console.log(`\n作成: ${path.basename(output)}`);
  safelyCreateOutput(output, force, [
    "-i", video,
    "-i", audio,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c", "copy",
    "-movflags", "+faststart"
  ]);
}

function combine(source1, source2, audio, output, force) {
  console.log(`\n作成: ${path.basename(output)} (再エンコード)`);
  safelyCreateOutput(output, force, [
    "-i", source1,
    "-i", source2,
    "-i", audio,
    "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]",
    "-map", "[v]",
    "-map", "2:a:0",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "20",
    "-c:a", "copy",
    "-movflags", "+faststart"
  ]);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }
  if (!commandExists("ffmpeg")) {
    throw new Error("ffmpeg が見つかりません。macOSでは `brew install ffmpeg` で導入できます。");
  }

  const directory = options.directory ?? findLatestBundle(options.root);
  const { data } = readMetadata(directory);
  const tracks = validateBundle(directory, data);
  const byRole = Object.fromEntries(tracks.map((track) => [track.role, track.path]));
  const outputs = outputPaths(directory, data);

  const displayTitle = String(data.title ?? "Echo360 lecture").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  console.log(`講義: ${displayTitle}`);
  console.log(`フォルダ: ${directory}`);
  mux(byRole["source-1"], byRole.audio, outputs.source1, options.force);
  mux(byRole["source-2"], byRole.audio, outputs.source2, options.force);
  if (options.combined) combine(byRole["source-1"], byRole["source-2"], byRole.audio, outputs.combined, options.force);
  console.log("\n完了しました。");
} catch (error) {
  console.error(`エラー: ${error.message}`);
  process.exit(1);
}
