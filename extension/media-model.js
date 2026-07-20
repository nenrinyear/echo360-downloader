const MEDIA_FILE_RE = /^s([012])q(\d+)\.mp4$/i;
const MASTER_PLAYLIST_RE = /^s([12])_(v|av)\.m3u8$/i;
const LESSON_PATH_RE = /^\/lesson\/[^/]+(?:\/|$)/;
const SECTION_PATH_RE = /^\/section\/[^/]+(?:\/home)?\/?$/;
const INVALID_FOLDER_CHAR_RE = /[<>:"|?*\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function parseEchoPageUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== "https://echo360.net.au") return null;
  const kind = LESSON_PATH_RE.test(url.pathname)
    ? "lesson"
    : SECTION_PATH_RE.test(url.pathname) ? "section" : null;
  if (!kind) return null;
  url.hash = "";
  return { kind, url: url.href };
}

export function normalizeLessonEntries(entries, sectionUrl) {
  const section = parseEchoPageUrl(sectionUrl);
  if (section?.kind !== "section" || !Array.isArray(entries)) return [];
  const unique = new Map();
  for (const entry of entries.slice(0, 2000)) {
    let absolute;
    try {
      absolute = new URL(entry?.url, section.url);
    } catch {
      continue;
    }
    const parsed = parseEchoPageUrl(absolute.href);
    if (parsed?.kind !== "lesson" || unique.has(parsed.url)) continue;
    unique.set(parsed.url, {
      url: parsed.url,
      title: sanitizeFilename(String(entry?.title ?? "Echo360 lecture").slice(0, 500))
    });
  }
  return [...unique.values()];
}

export function findDownloadableQualities(tracks, requireBothVideos = false) {
  const values = Object.values(tracks ?? {});
  const qualities = new Set(
    values
      .filter((track) => Number.isSafeInteger(track?.quality))
      .map((track) => track.quality)
  );
  return [...qualities]
    .filter((quality) => {
      const validTrack = (source) => {
        const track = tracks?.[`${source}:${quality}`];
        return track && Number.isSafeInteger(track.size) && track.size > 0;
      };
      const videoCount = [1, 2].filter(validTrack).length;
      return validTrack(0) && (requireBothVideos ? videoCount === 2 : videoCount >= 1);
    })
    .sort((a, b) => b - a);
}

export function parseMediaUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.hostname !== "content.echo360.net.au") return null;
  const file = url.pathname.split("/").pop() ?? "";
  const mediaMatch = file.match(MEDIA_FILE_RE);
  const masterMatch = file.match(MASTER_PLAYLIST_RE);

  if (mediaMatch) {
    const source = Number(mediaMatch[1]);
    return {
      kind: "media",
      file,
      source,
      quality: Number(mediaMatch[2]),
      trackType: source === 0 ? "audio" : "video",
      url: url.href,
      safeUrl: `${url.origin}${url.pathname}`,
      mediaKey: url.pathname.replace(/\/s[012]q\d+\.mp4$/i, "")
    };
  }

  if (masterMatch) {
    return {
      kind: "master",
      file,
      source: Number(masterMatch[1]),
      url: url.href,
      safeUrl: `${url.origin}${url.pathname}`,
      mediaKey: url.pathname.replace(/\/s[12]_(?:v|av)\.m3u8$/i, "")
    };
  }

  return null;
}

export function parseContentRange(value) {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value ?? "");
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3])
  };
}

export function headersToObject(headers = []) {
  return Object.fromEntries(
    headers.map(({ name, value }) => [name.toLowerCase(), value ?? ""])
  );
}

export function sanitizeFilename(value) {
  return String(value || "Echo360 lecture")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120) || "Echo360 lecture";
}

export function normalizeDownloadFolder(value) {
  if (typeof value !== "string") {
    throw new TypeError("保存先フォルダを文字列で指定してください。");
  }
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized) throw new Error("保存先フォルダを入力してください。");
  if (normalized.length > 240) throw new Error("保存先フォルダが長すぎます。");
  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) {
    throw new Error("Downloadsからの相対パスを指定してください。");
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("保存先フォルダに空の階層や .、.. は使用できません。");
    }
    if (
      segment.length > 120
      || INVALID_FOLDER_CHAR_RE.test(segment)
      || /[. ]$/.test(segment)
      || WINDOWS_RESERVED_NAME_RE.test(segment)
    ) {
      throw new Error(`保存先フォルダに使用できない名前があります: ${segment}`);
    }
  }
  return segments.join("/");
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "サイズ不明";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function qualityLabel(quality) {
  if (quality === 0) return "低画質 (360p)";
  if (quality === 1) return "高画質 (720p)";
  return `品質 ${quality}`;
}
