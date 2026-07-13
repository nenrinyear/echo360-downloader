# Echo360 downloader 調査・仕様案

調査日: 2026-07-13

## 結論

Echo360 のプレイヤーで見える `206 Partial Content` は、動画ファイルの一部分を HTTP `Range` リクエストで取得している正常なストリーミング動作である可能性が高い。拡張機能は、プレイヤーが取得済みの断片を横取りして保存するのではなく、通信から元メディアの URL とメタデータを検出し、次の順にダウンロードする構成がよい。

1. Echo360 が公式の MP4 ダウンロード URL を提示している場合は、その URL を使う。
2. 直 MP4 URL を検出できた場合は、同じ URL を通常の GET としてダウンロードする。
3. サーバーが Range 取得しか許さない場合だけ、`Content-Range` に従って全バイトを取得・検証・連結する。
4. HLS (`.m3u8`) や DASH (`.mpd`) の場合は別経路で扱い、音声・映像トラックを必要に応じて mux する。

## 現時点で確認できたこと

- 対象 URL は未認証状態では `https://login.echo360.net.au/login` にリダイレクトされる。
- Echo360 公式機能には、権限があるユーザー向けの MP4（Full/Lower、Source 1/Source 2）および MP3 のダウンロードがある。
- 教室ページでの動画ダウンロード可否は、所属機関・コース・コレクションの設定とユーザー権限に従う。
- 匿名ユーザーは動画・音声をダウンロードできず、通常は transcript のみとなる。
- `206` は Range 要求に対する成功応答であり、`Content-Range: bytes start-end/total` が全体サイズと対象範囲を表す。
- Chrome Manifest V3 でも `webRequest` は観測用途に利用できる。ただし Chrome のネットワーク抽象化により、内部の一つの URL が複数の Range 要求へ分割されることがあり、最終的な全 request header が必ず見えるわけではない。

## 対象授業での実測結果

ログイン済み Chrome を DevTools Protocol で観測し、対象授業について以下を確認した。識別 query、Cookie、JWT、CloudFront 署名は機密情報なので記録しない。

- CDN は `content.echo360.net.au`。Amazon S3 + CloudFront から配信される。
- 配信は HLS version 7 の VOD だが、細切れファイルではない。1本の fragmented MP4 を `EXT-X-BYTERANGE` で約10秒単位に参照する構成。
- 542 segment、再生時間は約 5,410 秒（約 90分10秒）。
- `EXT-X-KEY` はなく、HLS暗号化は使用されていない。
- Source 1映像、Source 2映像、独立音声の3トラックがあり、それぞれ低・高品質の計6ファイル。
- master playlist の品質表示:
  - 低品質: 640x360 / 30fps
  - 高品質: 1280x720 / 30fps
- MP4は H.264 (`avc1.640029`)、音声は AAC (`mp4a.40.2`)。
- 各MP4への再生リクエストは `Range` + `If-Range` を使用し、`206` と `Content-Range` が返る。
- 認証付き `HEAD` は全MP4で `200` と正しい `Content-Length` を返す。したがって、初期版ではRange断片の再構成は不要で、完全URLを `chrome.downloads.download()` に渡す設計を第一候補にできる。
- 取得時には Echo360 JWT と CloudFront signed cookie が送信される。これらを拡張機能が読み取ったり保存したりせず、Chrome自身の認証コンテキストで取得させるべき。

実測ファイルサイズ:

| Track | Low | High |
|---|---:|---:|
| Source 1 video | 30,631,658 bytes | 84,492,578 bytes |
| Source 2 video | 33,306,245 bytes | 128,885,140 bytes |
| Audio | 31,028,648 bytes | 162,993,608 bytes |

最終的な視聴用ファイルは、選択した Source の映像と同じ品質番号の音声を mux する必要がある。両画面を一つの動画へ合成する場合は再エンコードが必要になるため、MVPでは「Source 1 + Audio」「Source 2 + Audio」を別々に出力する方が軽量で品質劣化もない。

## MVP の機能仕様

### 対応範囲

- Chromium 系ブラウザ、Manifest V3。
- `echo360.net.au` の lesson/classroom ページ。
- ユーザー本人が閲覧権限とダウンロード権限を持つコンテンツのみ。
- DRM で保護されたメディアは対象外。DRM の回避は行わない。
- 初期版は直 MP4 を優先。HLS/DASH は検出表示までとし、後続版で保存対応してもよい。

### UI

- ツールバーアイコンに検出件数を表示。
- ポップアップに、タイトル、配信方式、Source 1/2、解像度、推定サイズを表示。
- 品質を選択して「ダウンロード」。
- 進捗、速度、残り時間、中止、再試行を表示。
- 権限不足、URL 期限切れ、ログイン切れ、DRM、未対応形式を明確に区別する。

### 検出

- `webRequest.onHeadersReceived` で対象タブのレスポンスを観測する。
- 候補条件:
  - `Content-Type` が `video/mp4`, `audio/mp4`, `audio/mpeg`, MPEG-URL, DASH XML。
  - URL が `.mp4`, `.m4a`, `.mp3`, `.m3u8`, `.mpd` を含む。
  - status が `200` または `206`。
  - `Content-Range`, `Content-Length`, `ETag`, `Last-Modified`, `Accept-Ranges` を記録。
- URL の query string は署名を含む可能性があるため省略・再構築せず、完全な URL を保持する。
- 同一 URL の Range 違いは一つのメディア候補へ集約する。
- ページタイトルと DOM 上の講義名を候補名として取得するが、通信 URL の認証情報を UI やログへ露出しない。

### 直 MP4 のダウンロード

- 第一候補は `chrome.downloads.download({url, filename})`。ブラウザのダウンロード機構へ委譲し、大容量 Blob を拡張機能メモリに保持しない。
- 通常 GET が `200` なら、そのまま保存する。
- `206` しか返らない場合はレスポンスの `Content-Range` から総サイズを取得する。
- Range 再構成時は固定サイズのチャンクを並列数 2〜4 で取得し、過剰な負荷を避ける。
- 各応答について次を検証する。
  - status が `206`。
  - `Content-Range` の start/end が要求範囲と一致。
  - body 長が `end - start + 1` と一致。
  - 全応答の total、ETag、Last-Modified が途中で変化していない。
- 変化を検出した場合は結合せず、URL 期限切れまたはファイル更新として再取得を促す。
- 末尾まで隙間・重複なく取得したことを確認してから保存する。

### HLS/DASH

- master manifest を優先して保持し、相対 URL は manifest URL 基準で解決する。
- HLS は variant、audio group、`EXT-X-MAP`、byte range、暗号化指定を解析する。
- DASH は Representation、BaseURL、SegmentTemplate/SegmentList、音声と映像の分離を解析する。
- 暗号化されていない fMP4/TS の取得と mux のみを対象にする。
- ブラウザ内 mux は大容量処理と MV3 service worker の寿命に弱いため、将来版では offscreen document + Web Worker/WASM を検討する。初期版は直 MP4 を優先する。

### 状態管理

- Service Worker は終了し得るため、ダウンロードジョブをメモリだけに置かない。
- `chrome.storage.local` に URL（必要最小限）、範囲、ETag、進捗、再試行回数を保存する。
- 署名 URL は機密情報として扱い、完了・期限切れ・ユーザー操作で消去する。
- ページ遷移後も `chrome.downloads` の ID で状態を追跡する。

### ファイル名

- `{date}_{course}_{title}_{source}_{quality}.{ext}` を基本形にする。
- OS で禁止される文字を置換し、長すぎる名前を切り詰める。
- Echo360 公式命名に合わせる場合は `full/lower`, `s1/s2`, `audio` を末尾へ付ける。

## Manifest の最小権限案

```json
{
  "manifest_version": 3,
  "permissions": ["downloads", "storage", "webRequest"],
  "host_permissions": [
    "https://echo360.net.au/*",
    "https://*.echo360.net.au/*"
  ],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup.html"
  },
  "content_scripts": [{
    "matches": ["https://echo360.net.au/lesson/*"],
    "js": ["content-script.js"]
  }]
}
```

実際の CDN が別ドメインなら、固定の広すぎる権限を最初から要求せず、検出後に `optional_host_permissions` と `chrome.permissions.request()` で追加許可を求める方が望ましい。

## セキュリティ・プライバシー

- Cookie、Authorization header、署名 URL を console、analytics、エラーレポートへ出さない。
- URL 表示時は query をマスクする。
- 任意サイトの通信は監視せず、対象タブ・対象ホストへ絞る。
- ダウンロード不可設定を技術的に迂回する機能は作らない。
- 学内規約、著作権、授業資料の利用条件に従う旨を初回 UI に表示する。

## 実機調査で採取する情報

ログイン済みの対象ページで一度再生し、Chrome DevTools の Network から HAR を **機密情報を除去して** 採取する。最低限、各候補リクエストについて以下を確認する。

- Request URL の host/path/拡張子（query の値は共有しない）
- status code
- request の `Range`, `Origin`, `Referer`
- response の `Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`, `Last-Modified`, `Content-Disposition`
- Initiator
- Source 1/2 と音声が同一 MP4 か別 URL か
- seek 前後で URL が同一か
- URL が何分で失効するか
- 通常 GET（Range なし）が `200`, `206`, `403` のどれになるか
- 公式 Download Assets モーダルに MP4 が出るか
- Widevine/EME の使用有無（DRM 使用時は対象外）

HAR を共有する場合は Cookie、Authorization、署名 query、メールアドレス、学生・講義の識別情報を必ず削除する。

## テスト項目

- 単一映像、二画面、音声のみ。
- 低画質・高画質。
- 先頭から再生、途中 seek、未再生で検出。
- 200 と 206、既知サイズと未知サイズ。
- 一時的な 429/5xx、ネットワーク切断、再開。
- ETag 変化、URL 期限切れ、ログアウト。
- 同名講義、非常に長いタイトル、禁止文字。
- 2 GB/4 GB 超の大容量ファイル。
- 公式にダウンロード不可の授業でボタンを無効化できること。

## 参考資料

- RFC 9110, HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110
- RFC 9111, HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111
- Chrome `webRequest`: https://developer.chrome.com/docs/extensions/reference/api/webRequest
- Chrome `downloads`: https://developer.chrome.com/docs/extensions/reference/api/downloads
- Chrome Offscreen API: https://developer.chrome.com/docs/extensions/reference/api/offscreen
- Chrome Extension Service Worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- EchoVideo media player downloads: https://support.echo360.com/hc/en-us/articles/11077027768333-EchoVideo-Using-the-Media-Player-Tools
- EchoVideo library downloads: https://support.echo360.com/hc/en-us/articles/11077309247757-EchoVideo-Downloading-Media-From-Your-Library
