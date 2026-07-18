import fs from "node:fs";
import path from "node:path";

export function readMetadata(directory) {
  const metadataPath = path.join(directory, "echo360.json");
  const data = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (data.schemaVersion !== 1 || !Array.isArray(data.tracks)) {
    throw new Error(`未対応のメタデータです: ${metadataPath}`);
  }
  return { data, metadataPath };
}

export function findTrack(data, role) {
  const track = data.tracks.find((item) => item.role === role);
  if (!track?.filename) throw new Error(`${role} トラックがメタデータにありません。`);
  return track;
}

export function validateBundle(directory, data) {
  const roles = ["source-1", "source-2", "audio"];
  return roles.map((role) => {
    const track = findTrack(data, role);
    const filePath = path.join(directory, track.filename);
    if (!fs.existsSync(filePath)) throw new Error(`ファイルがありません: ${filePath}`);
    const actualSize = fs.statSync(filePath).size;
    if (track.size && actualSize !== track.size) {
      throw new Error(`ダウンロードが未完了です: ${track.filename} (${actualSize}/${track.size} bytes)`);
    }
    return { ...track, role, path: filePath, actualSize };
  });
}

export function findLatestBundle(root) {
  if (!fs.existsSync(root)) throw new Error(`ダウンロード先がありません: ${root}`);
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((directory) => fs.existsSync(path.join(directory, "echo360.json")))
    .map((directory) => ({
      directory,
      mtime: fs.statSync(path.join(directory, "echo360.json")).mtimeMs
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) throw new Error(`${root} に echo360.json が見つかりません。`);
  return candidates[0].directory;
}

export function outputPaths(directory, data) {
  return {
    source1: path.join(directory, data.outputs?.source1 || "source-1-with-audio.mp4"),
    source2: path.join(directory, data.outputs?.source2 || "source-2-with-audio.mp4"),
    combined: path.join(directory, data.outputs?.combined || "combined.mp4")
  };
}
