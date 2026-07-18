# echo360-merge

`~/Downloads/Echo360` の最新講義を検出し、FFmpegで次のファイルを作ります。

- `source-1-with-audio.mp4`
- `source-2-with-audio.mp4`
- `combined.mp4`（`--combined`指定時）

```sh
./cli/bin/echo360-merge.js [講義フォルダ] [--combined] [--force]
```

映像と音声のmuxは `-c copy` のため再エンコードせず高速です。左右合成版だけはH.264で再エンコードします。
