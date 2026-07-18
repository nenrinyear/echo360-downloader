# Echo360 Downloader

Echo360 の認証済みメディアを一括保存し、ローカルの FFmpeg で視聴用 MP4 にまとめるツールです。

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
6. 拡張機能を開き、希望する品質の「3トラックを一括保存」を押す。

次のように保存されます。

```text
~/Downloads/Echo360/講義名_2026-06-29/
├── echo360.json
├── source-1-q1.mp4
├── source-2-q1.mp4
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

引数なしで実行すると、最新のダウンロードを自動検出します。

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

以下の2ファイルが高速なストリームコピーで生成されます。

```text
source-1-with-audio.mp4
source-2-with-audio.mp4
```

左右合成版も作る場合は次のようにします。合成版のみ映像を再エンコードします。

```sh
./cli/bin/echo360-merge.js --combined
```

特定の講義を指定する場合も、3ファイルではなくフォルダを1つ渡すだけです。

```sh
./cli/bin/echo360-merge.js ~/Downloads/Echo360/講義名_2026-06-29
```

## プライバシー

- 認証CookieやJWTを読み取りません。
- 認証付きメディアURLは拡張機能の非永続セッション領域だけに保持します。
- `echo360.json` に認証情報やメディアURLは保存しません。
- Echo360上で閲覧・ダウンロードを許可されたコンテンツにのみ使用してください。

## テスト

```sh
npm test
```
