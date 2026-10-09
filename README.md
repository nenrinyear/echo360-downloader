# Echo360 Downloader

Echo360 の認証済みメディアを一括保存し、ローカルの FFmpeg で視聴用 MP4 にまとめるツールです。

> [!IMPORTANT]
> 本ツールはEcho360, Inc.および各教育機関とは無関係の非公式プロジェクトです。閲覧・ダウンロードを許可されたコンテンツにのみ使用し、著作権、所属機関の規則、授業資料の利用条件を守ってください。DRMや認可制御を回避する機能はありません。

```text
echo360-downloader/
├── extension/   Chrome 拡張機能
└── cli/         FFmpeg 結合 CLI
```

## 1. Chrome 拡張機能

1. Chrome で `chrome://extensions` を開く。
2. 「デベロッパー モード」を有効にする。
3. 「パッケージ化されていない拡張機能を読み込む」を選ぶ。
4. このリポジトリの `extension` フォルダを選ぶ。
5. Echo360 の授業動画を数秒再生する。
6. 拡張機能を開き、希望する品質の「トラックを一括保存」を押す。

section の授業一覧をまとめて保存する場合は、section の `/home` ページで拡張機能を開き、「一覧を全てダウンロード」を押します。拡張機能が授業をバックグラウンドタブで1件ずつ開き、検出できた最高品質の映像と音声を保存します。映像はSource 1またはSource 2の一方だけでも処理できます。各授業は90秒でタイムアウトし、失敗しても次の授業へ進みます。

ポップアップの「デフォルト保存先」では、ChromeのDownloadsフォルダ内の相対パス（例: `授業/Echo360`）を自由に指定できます。通常保存・トラック一括保存・section一括保存の各ボタンを押すと、実際のダウンロードを開始する前に今回の保存先を確認します。そこで変更したパスは次回のデフォルトになります。Chrome拡張機能からDownloads外の絶対パスを直接指定することはできません。保存先を変更した場合は、CLIにその保存先を渡してください（例: `echo360-merge ~/Downloads/授業/Echo360`）。

次のように保存されます。

```text
~/Downloads/Echo360/講義名_2026-06-29_q1_20260718T120000Z/
├── echo360.json
├── source-1-q1.mp4
├── source-2-q1.mp4（Source 2がある場合）
└── audio-q1.mp4
```

## 2. CLI

FFmpeg をインストールします。

```sh
brew install ffmpeg
```

どこからでも `echo360-merge` を呼べるようにする場合は、このリポジトリで一度だけ実行します。

```sh
npm link
```

引数なしで実行すると、`~/Downloads/Echo360` 以下を再帰的に検索し、見つかった全講義を処理します。

```sh
npm run merge
```

`npm link` 済みなら次だけで動きます。

```sh
echo360-merge
```

またはCLIを直接実行できます。

```sh
./cli/bin/echo360-merge.js
```

検出されたSourceに対応するファイルが高速なストリームコピーで生成されます。

```text
source-1-with-audio.mp4
source-2-with-audio.mp4
```

Source 1とSource 2の両方がある講義で左右合成版も作る場合は次のようにします。合成版のみ映像を再エンコードします。

```sh
./cli/bin/echo360-merge.js --combined
```

特定の講義または複数講義を含む親フォルダを指定する場合も、個別ファイルではなくフォルダを1つ渡すだけです。親フォルダ以下は再帰的に検索されます。

```sh
./cli/bin/echo360-merge.js ~/Downloads/Echo360/講義名_2026-06-29
```

従来どおり最新の1件だけを処理する場合は `--latest` を指定します。

```sh
./cli/bin/echo360-merge.js --latest
```

mergeが成功した講義から元の映像・音声トラックを削除するには、`--delete-sources`を指定します。

```sh
echo360-merge ~/Downloads/Echo360 --delete-sources
```

すでに音声付きMP4を作成済みで、mergeせず元トラックの削除だけを行う場合は`--cleanup`を使います。このモードではFFmpegは不要です。

```sh
echo360-merge ~/Downloads/Echo360 --cleanup
```

どちらのモードも、存在する全Sourceに対応した音声付き出力が有効なMP4ヘッダーを持つ通常ファイルであることと、元トラックが`echo360.json`記載のサイズと一致することを確認してから削除します。`echo360.json`と作成済み出力は残ります。削除した元トラックは復元できません。

## プライバシー

- 認証CookieやJWTを読み取りません。
- 認証付きメディアURLは拡張機能の非永続セッション領域だけに保持します。
- デフォルト保存先の相対パスだけを拡張機能のローカル設定に保持します。
- `echo360.json` に認証情報やメディアURLは保存しません。
- Echo360上で閲覧・ダウンロードを許可されたコンテンツにのみ使用してください。

詳細は [PRIVACY.md](PRIVACY.md) と [SECURITY.md](SECURITY.md) を参照してください。

## 依存関係とライセンス

- npm依存パッケージはありません。
- FFmpegは同梱せず、利用者が別途インストールした実行ファイルを呼び出します。FFmpeg自体のライセンスはビルド構成によりLGPLまたはGPLです。詳細は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
- このリポジトリのコードは [MIT License](LICENSE) で公開します。

## テスト

```sh
npm test
```
