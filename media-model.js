const MEDIA_FILE_RE = /^s([012])q(\d+)\.mp4$/i;
const MASTER_PLAYLIST_RE = /^s([12])_(v|av)\.m3u8$/i;

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
