import fs from "node:fs";
import path from "node:path";

const MAX_METADATA_BYTES = 64 * 1024;
const ALLOWED_ROLES = ["source-1", "source-2", "audio"];

export function assertPlainFilename(value, label = "ファイル名") {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    value === "." ||
    value === ".." ||
    value.startsWith("-") ||
    path.basename(value) !== value ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value)
  ) {
    throw new Error(`${label}が安全ではありません: ${String(value)}`);
  }
  return value;
}

function assertRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label}は通常ファイルではありません: ${filePath}`);
  }
  return stat;
}

export function readMetadata(directory) {
  const metadataPath = path.resolve(directory, "echo360.json");
  if (!fs.existsSync(metadataPath)) throw new Error(`メタデータがありません: ${metadataPath}`);
  const metadataStat = assertRegularFile(metadataPath, "メタデータ");
  if (metadataStat.size > MAX_METADATA_BYTES) {
    throw new Error(`メタデータが大きすぎます: ${metadataPath}`);
  }
  const data = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (
    data === null ||
    typeof data !== "object" ||
    data.schemaVersion !== 1 ||
    !Array.isArray(data.tracks) ||
    data.tracks.length < 2 ||
    data.tracks.length > ALLOWED_ROLES.length
  ) {
    throw new Error(`未対応のメタデータです: ${metadataPath}`);
  }

  const roles = data.tracks.map((track) => track?.role);
  const hasAudio = roles.includes("audio");
  const hasVideo = roles.includes("source-1") || roles.includes("source-2");
  if (
    new Set(roles).size !== roles.length ||
    roles.some((role) => !ALLOWED_ROLES.includes(role)) ||
    !hasAudio ||
    !hasVideo
  ) {
    throw new Error("メタデータのトラック構成が不正です。");
  }
  for (const track of data.tracks) {
    assertPlainFilename(track.filename, `${track.role}のファイル名`);
    if (!track.filename.toLowerCase().endsWith(".mp4")) {
      throw new Error(`${track.role}のファイルはMP4ではありません。`);
    }
    if (!Number.isSafeInteger(track.size) || track.size <= 0) {
      throw new Error(`${track.role}のファイルサイズが不正です。`);
    }
  }
  return { data, metadataPath };
}

export function findTrack(data, role) {
  const track = data.tracks.find((item) => item.role === role);
  if (!track?.filename) throw new Error(`${role} トラックがメタデータにありません。`);
  return track;
}

export function validateBundle(directory, data) {
  const baseDirectory = path.resolve(directory);
  return ALLOWED_ROLES.filter((role) => data.tracks.some((track) => track.role === role)).map((role) => {
    const track = findTrack(data, role);
    const filename = assertPlainFilename(track.filename, `${role}のファイル名`);
    const filePath = path.resolve(baseDirectory, filename);
    if (!fs.existsSync(filePath)) throw new Error(`ファイルがありません: ${filePath}`);
    const actualSize = assertRegularFile(filePath, `${role}トラック`).size;
    if (actualSize !== track.size) {
      throw new Error(`ダウンロードが未完了です: ${track.filename} (${actualSize}/${track.size} bytes)`);
    }
    return { ...track, role, path: filePath, actualSize };
  });
}

export function findLatestBundle(root) {
  const candidates = findBundles(root)
    .map((directory) => ({
      directory,
      mtime: fs.statSync(path.join(directory, "echo360.json")).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) throw new Error(`${root} に echo360.json が見つかりません。`);
  return candidates[0].directory;
}

export function findBundles(root) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`ダウンロード先がありません: ${resolvedRoot}`);
  }
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`ダウンロード先は通常のフォルダである必要があります: ${resolvedRoot}`);
  }

  const candidates = [];
  const pending = [resolvedRoot];
  while (pending.length) {
    const directory = pending.pop();
    const metadataPath = path.join(directory, "echo360.json");
    if (fs.existsSync(metadataPath)) {
      candidates.push(directory);
      continue;
    }

    const children = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(directory, entry.name))
      .sort((a, b) => b.localeCompare(a, "ja"));
    pending.push(...children);
  }

  if (!candidates.length) {
    throw new Error(`${resolvedRoot} 以下に echo360.json が見つかりません。`);
  }
  return candidates.sort((a, b) => a.localeCompare(b, "ja"));
}

export function outputPaths(directory, data) {
  const resolveOutput = (value, fallback, label) => {
    const filename = assertPlainFilename(value ?? fallback, label);
    if (!filename.toLowerCase().endsWith(".mp4")) {
      throw new Error(`${label}はMP4である必要があります。`);
    }
    const output = path.resolve(directory, filename);
    if (fs.existsSync(output)) {
      const stat = fs.lstatSync(output);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label}は通常ファイルである必要があります: ${output}`);
      }
    }
    return output;
  };
  return {
    source1: resolveOutput(data.outputs?.source1, "source-1-with-audio.mp4", "Source 1出力名"),
    source2: resolveOutput(data.outputs?.source2, "source-2-with-audio.mp4", "Source 2出力名"),
    combined: resolveOutput(data.outputs?.combined, "combined.mp4", "合成出力名")
  };
}
