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
