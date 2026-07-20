# echo360-merge

指定フォルダ以下の講義を再帰的に検出し、FFmpegで次のファイルを作ります。

- `source-1-with-audio.mp4`（Source 1がある場合）
- `source-2-with-audio.mp4`（Source 2がある場合）
- `combined.mp4`（両Sourceがあり、`--combined`指定時）

```sh
./cli/bin/echo360-merge.js [講義フォルダまたは親フォルダ] [--combined] [--force]
```

引数を省略すると `~/Downloads/Echo360` 以下の全講義を処理します。最新の1件だけを処理するには `--latest` を指定します。

映像と音声のmuxは `-c copy` のため再エンコードせず高速です。左右合成版だけはH.264で再エンコードします。

merge成功後に元の映像・音声トラックを削除する場合:

```sh
./cli/bin/echo360-merge.js [親フォルダ] --delete-sources
```

作成済み出力を検証して、元トラックの削除だけを行う場合:

```sh
./cli/bin/echo360-merge.js [親フォルダ] --cleanup
```

削除前に全Sourceの音声付き出力（MP4ヘッダーを含む）と全元トラックを検証します。`echo360.json`は残りますが、削除した元トラックは復元できません。
