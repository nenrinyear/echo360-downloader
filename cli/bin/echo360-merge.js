#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  cleanupSourceTracks,
  findBundles,
  findLatestBundle,
  outputPaths,
  readMetadata,
  sourceTracksAreDeleted,
  validateCompletedOutputs,
  validateBundle
} from "../lib.js";

function usage() {
  console.log(`使い方:
  echo360-merge [講義フォルダまたは親フォルダ] [--combined]

指定フォルダ以下を再帰的に検索し、見つかった全講義を処理します。
引数を省略すると ~/Downloads/Echo360 以下を検索します。

オプション:
  --root <path>   自動検索するルートを変更
  --latest        最新の講義だけを処理
  --combined      2映像を左右に並べた動画も作成
  --delete-sources
                  merge成功後、元の映像・音声トラックを削除
  --cleanup       作成済み出力を確認し、元トラックの削除だけを実行
  --force         既存の出力を上書き
  --help          このヘルプを表示

削除オプションはecho360.jsonを残します。削除した元トラックは復元できません。`);
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
  const options = {
    cleanup: false,
    combined: false,
    deleteSources: false,
    force: false,
    latest: false,
    root: path.join(os.homedir(), "Downloads", "Echo360"),
    directory: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--combined") options.combined = true;
    else if (arg === "--cleanup") options.cleanup = true;
    else if (arg === "--delete-sources") options.deleteSources = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--latest") options.latest = true;
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
  if (options.cleanup && (options.combined || options.deleteSources || options.force)) {
    throw new Error("--cleanupは--combined、--delete-sources、--forceと同時に指定できません。");
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

function mergeBundle(directory, options) {
  const { data } = readMetadata(directory);
  let tracks;
  try {
    tracks = validateBundle(directory, data);
  } catch (error) {
    if (!sourceTracksAreDeleted(directory, data)) throw error;
    validateCompletedOutputs(directory, data);
    console.log(`\nスキップ: 元トラックは削除済みです。\nフォルダ: ${directory}`);
    return;
  }
  const byRole = Object.fromEntries(tracks.map((track) => [track.role, track.path]));
  const outputs = outputPaths(directory, data);

  const displayTitle = String(data.title ?? "Echo360 lecture").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  console.log(`\n講義: ${displayTitle}`);
  console.log(`フォルダ: ${directory}`);
  if (byRole["source-1"]) mux(byRole["source-1"], byRole.audio, outputs.source1, options.force);
  if (byRole["source-2"]) mux(byRole["source-2"], byRole.audio, outputs.source2, options.force);
  if (options.combined && byRole["source-1"] && byRole["source-2"]) {
    combine(byRole["source-1"], byRole["source-2"], byRole.audio, outputs.combined, options.force);
  } else if (options.combined) {
    console.log("\nスキップ: 左右合成にはSource 1とSource 2の両方が必要です。");
  }
  if (options.deleteSources) {
    const deleted = cleanupSourceTracks(directory, data);
    console.log(`\n元トラックを削除しました (${deleted.length}ファイル)。`);
  }
}

function cleanupBundle(directory) {
  const { data } = readMetadata(directory);
  const displayTitle = String(data.title ?? "Echo360 lecture").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  console.log(`\n講義: ${displayTitle}`);
  console.log(`フォルダ: ${directory}`);
  const deleted = cleanupSourceTracks(directory, data);
  if (deleted.length) {
    console.log(`元トラックを削除しました (${deleted.length}ファイル)。`);
  } else {
    console.log("スキップ: 元トラックは削除済みです。");
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }
  if (!options.cleanup && !commandExists("ffmpeg")) {
    throw new Error("ffmpeg が見つかりません。FFmpeg をインストールし、実行ファイルのフォルダを PATH に追加してください。");
  }

  const root = options.directory ?? options.root;
  const directories = options.latest ? [findLatestBundle(root)] : findBundles(root);
  const failures = [];
  console.log(`${directories.length}件の講義フォルダを検出しました。`);
  for (const directory of directories) {
    try {
      if (options.cleanup) cleanupBundle(directory);
      else mergeBundle(directory, options);
    } catch (error) {
      failures.push({ directory, message: error.message });
      console.error(`\n失敗: ${directory}\n  ${error.message}`);
    }
  }
  if (failures.length) {
    throw new Error(`${directories.length}件中${failures.length}件の処理に失敗しました。`);
  }
  console.log(`\n完了しました (${directories.length}件)。`);
} catch (error) {
  console.error(`エラー: ${error.message}`);
  process.exit(1);
}
