# LightsToMasterFlat

**[日本語](#日本語) | [English](#english)**

---

## 日本語

複数のライトフレームから、計算によって **WBPP（WeightedBatchPreprocessing）用のマスターフラット**を作成する PixInsight スクリプトです。天体用 CMOS カメラ（モノクロ / カラー）と、デジタル一眼の RAW ファイルの両方に対応します。

フラットを撮り忘れた、撮ったフラットが合わない、遠征先で撮れなかった――そういうときに、ライトフレームに写っている夜空の背景光そのものをフラット光源として利用します（いわゆるスカイフラット / 合成フラット）。

### 特長

- **WBPP にそのまま渡せる**：32 bit 浮動小数点の XISF で、`IMAGETYP = Master Flat`・`FILTER`・`XBINNING`・`BAYERPAT` を書き込みます。WBPP の Flats タブに追加するだけでマスターフラットとして認識されます。
- **フィルター・ビニング・画像サイズごとに自動でグループ化**し、グループごとにマスターフラットを 1 枚ずつ出力します。
- **モノクロ / ベイヤー / X-Trans** に対応。カラーセンサーは CFA の位置ごとに別々に正規化するので、色ごとの周辺減光の違いも保たれます。
- **ディザリングしていないデータにも対応**：スタック前に各フレームの星をマスクし、さらにスタック後にも残った星を検出して取り除きます。
- **合成マスターバイアスも一緒に出力**：ダークもバイアスも撮っていない場合、RAW の EXIF から黒レベルを自動で読み取り（Canon / DNG）、フラットの計算に使うと同時に、同じ値の合成マスターバイアスを WBPP 用に保存します。
- **ダーク / バイアスの減算**：マスターダークやマスターバイアスがあれば、それを指定することもできます。
- **日本語 / 英語 切り替え**：ダイアログ上部で切り替えられ、設定は保存されます。

### 動作環境

- PixInsight 1.9.x（1.9.6 / macOS / Apple Silicon で動作確認）
- ImageIntegration プロセス（標準で入っています）

### インストール

1. このリポジトリをダウンロードします（`Code` → `Download ZIP`、または `git clone`）。
2. PixInsight で **SCRIPT > Feature Scripts...** を開き、**Add** を押して `LightsToMasterFlat.js` のあるフォルダーを選びます。
3. **SCRIPT > Utilities > LightsToMasterFlat** から起動できるようになります。

インストールせずに試すだけなら、**SCRIPT > Execute Script File...** で `LightsToMasterFlat.js` を直接選んでも実行できます。

### 使い方

1. **ライトフレームを追加**します（`ファイルを追加` または `フォルダーを追加`）。  
   必ず**キャリブレーション前・位置合わせ前の生のライト**を使ってください。
2. **ダーク / バイアスの減算**を選びます。
   - *黒レベル / 一定のペデスタル値*（既定）：ダークもバイアスもない場合に使います。値を `0` のままにすると、RAW の EXIF から黒レベルを自動で読み取ります（Canon のカメラと DNG）。それ以外のカメラや FITS / XISF のフレームでは、カメラのオフセットを 16 bit ADU で入力してください。`合成マスターバイアスも保存する` をオンにしておくと、同じ値のマスターバイアスが出力されます。
   - *マスターダーク または マスターバイアス*：WBPP でそのライトに使うマスターダークがあるなら、それを指定するのが最良です。
   - *なし*：ライトがすでにダーク減算済みの場合だけ選んでください。
3. **センサーの種類**は通常「自動判定」のままで構いません。
4. **出力フォルダー**を選び、**実行**を押します。
5. WBPP に追加します。
   - `masterFlat_FILTER-…_BIN-…_幅x高さ.xisf` → **Flats タブ**
   - `masterBias_BIN-…_幅x高さ_…ADU.xisf` → **Bias タブ**（ライトをマスターダークでキャリブレーションする場合は不要）

> **オフセットの扱いをフラットとライトでそろえることが重要です。** フラットは「黒レベルを引いた後」の信号から作るので、ライトも同じ黒レベルを引いてからフラットで割る必要があります。引かずに割ると、周辺が明るく浮く過補正になります（黒レベルは画面全体で一定なのに、フラットの値は周辺ほど小さいため）。合成マスターバイアスは、そのための「同じ値」を WBPP に渡す手段です。デジタル一眼の RAW には必ず黒レベル（Canon の 14 bit 機で 2048 前後）が含まれます。

### パラメータ

| 項目 | 既定値 | 説明 |
|---|---|---|
| 減算するもの | 黒レベル | 黒レベル（定数）、マスターダーク / バイアス、なし |
| 黒レベル（ADU） | 0 | 0 = RAW の EXIF から自動で読む（Canon / DNG）。それ以外は 16 bit ADU で入力 |
| 合成マスターバイアスも保存する | オン | 黒レベルの定数画像を `IMAGETYP = Master Bias` の XISF で保存 |
| CFA 配列 | 自動判定 | `BAYERPAT` キーワードや CFA プロパティから判定。カメラ RAW はベイヤーとみなします |
| 星をマスクする | オン | 各フレームで、周囲の背景より明るいピクセルを除外します |
| しきい値（σ） | 3.0 | 小さいほど多くマスクします |
| マスクの拡張（px） | 2 | 星のハロを覆うために広げる量。星が大きい場合は増やします |
| 合成方法 | 平均（シグマクリップつき） | 8 枚以上なら平均、ごく少数なら中央値が頑健です |
| シグマ（低 / 高） | 4.0 / 2.5 | ImageIntegration の Winsorized Sigma Clipping の値 |
| 平滑化する | オン | ピクセル単位のノイズを取り除きます |
| スケール（px） | 16 | これより大きい構造（周辺減光・ゴミの影）を残します |

### 良い結果を得るコツ

- **枚数は多いほど良い**：背景光は暗いので、できれば 20 枚以上使ってください。
- **ディザリングされたデータ、複数の対象を混ぜたデータ**が理想です。星や星雲がフレームごとに違う位置にあれば、棄却処理できれいに消えます。
- **同じ光学系・同じカメラ角度・同じピント位置**のライトだけをまとめてください。カメラを回転させたり、ゴミの位置が変わったりしたら別々に処理します。
- **背景がある程度明るいライト**が向いています。光害地のライトは、この用途ではむしろ好条件です。
- 小さく鋭いゴミの影を残したいときは、平滑化の**スケールを小さく**します（8 など）。

### 制限事項

本物のフラットの完全な代わりにはなりません。次の点を理解したうえで使ってください。

- **空の輝度勾配と周辺減光は区別できません。** 光害や月明かりによる傾きがすべてのフレームで同じ向きなら、フラットに混入します。この残差は、スタック後の背景補正（GradientCorrection、DBE など）で取り除いてください。
- **大きな星雲・銀河がすべてのフレームで同じ位置にある**と、その淡い部分はマスクしきれずフラットに残ります。複数の対象を混ぜると軽減できます。
- **平滑化はスケールより小さい構造を弱めます。** 既定値（16 px）では、半径 20 px・深さ 4% の影が約 3.6% に浅くなります。
- **信号のないチャンネルは復元できません。** たとえばカラーカメラ + ナローバンドフィルターで、ほとんど光が届かない色のフラットは信頼できません。
- **黒レベルの自動読み取りは Canon と DNG だけ**です。Nikon・Sony・Fuji などの RAW や、天体用カメラの FITS では値を入力してください（入力しないとエラーで止まります）。
- **合成マスターバイアスは定数画像**です。本物のバイアスにある固定パターンや、ダークの熱ノイズ・アンプグローは補正できません。ダークを撮れるなら、そちらが上です。
- 入力は **1 チャンネルの生フレーム**（モノクロまたは CFA）だけです。デベイヤー済みの RGB 画像には対応していません。
- マスクが 50% を超えるフレーム（背景が暗すぎる、雲、星景写真など）は自動的に除外されます。

### 検証状況

| 項目 | 状況 |
|---|---|
| 合成データ（ベイヤー、ディザリングあり、20 枚、平滑化あり） | 真のフラットとの RMS 誤差 約 0.2% |
| 合成データ（モノクロ FITS、**ディザリングなし**、12 枚、平滑化なし） | RMS 誤差 約 0.6%、最大誤差 約 3%（星マスクなしの対照実験では最大 150% 超） |
| WBPP が要求するキーワード・XISF 形式 | WBPP のソースコードの判定条件と照合済み |
| デジタル一眼 RAW（Canon CR2、20〜26 MP） | 読み込み・CFA の自動判定・実行を確認。フラットとしての精度は実写データでは未検証 |
| 黒レベルの自動読み取り | Canon CR2 133 枚（2 機種）で 2047〜2048 ADU を取得し、画素値の中央値と一致。DNG は合成ファイルでのみ確認、CR3 は未検証 |
| 合成マスターバイアス | 値・キーワード・ファイル名を自動テストで確認。WBPP に実際に読み込ませる確認は未実施 |
| X-Trans | 実機データでは未検証 |
| 処理時間 | 24 MP・8 枚で約 20 秒（Apple Silicon） |
| Windows / Linux | 未検証 |

実際の天体写真での仕上がりは、ぜひご自身のデータで確認してください。不具合や改善案は Issue でお知らせください。

### 仕組み

1. ヘッダーを読み、フィルター・ビニング・画像サイズでグループ化する。
2. 各フレームからダーク（または黒レベル。EXIF から読んだ場合はグループの平均値）を引き、CFA の位置ごとの中央値で割って背景をそろえる。
3. 64 px 間隔の格子で局所的な背景とノイズを測り、背景 + kσ を超えるピクセルをマスクして広げる（マスク = 値 0 = 欠損）。
4. ImageIntegration で、値 0 を欠損として除外しながら棄却つきでスタックする。
5. 過半数のフレームでマスクされたピクセルを欠損にし、（平滑化しない場合は）スタック上でもう一度残留星を検出する。
6. CFA の位置ごとにブロック中央値から平滑モデルを作り、欠損を埋める（平滑化する場合は全体をモデルで置き換える）。
7. CFA の位置ごとに中央値を 0.5 にそろえ、マスターフラットとして書き出す。
8. 黒レベルを使った場合は、同じ値（ADU / 65535）で埋めた合成マスターバイアスも書き出す。

黒レベルの読み取りと合成バイアスの方式は、同じ作者の [LCP Flat Generator](https://github.com/Geology-cat/pixinsight-lcp-flat-generator) と同じものです。

### テスト

合成データを作って真のフラットと比較する自動テストがあります。新しい PixInsight インスタンスを起動して実行します（数十秒）。

```bash
tests/run_tests.sh
```

### ライセンス

[MIT License](LICENSE)

---

## English

A PixInsight script that computes a **master flat for WBPP (WeightedBatchPreprocessing)** from a set of light frames. It works with dedicated astronomy cameras (monochrome and one-shot colour) and with DSLR raw files.

When you forgot to take flats, your flats do not match, or you could not take them in the field, the sky background recorded in the light frames themselves can serve as the flat light source (a "sky flat" or synthetic flat).

### Features

- **WBPP-ready output**: a 32-bit floating point XISF file carrying `IMAGETYP = Master Flat`, `FILTER`, `XBINNING` and `BAYERPAT`. Add it in the Flats tab of WBPP and it is recognized as a master flat.
- **Automatic grouping** by filter, binning and image size, with one master flat per group.
- **Monochrome, Bayer and X-Trans** sensors. Colour sensors are normalized separately for every CFA position, so colour-dependent vignetting is preserved.
- **Works without dithering**: stars are masked in every frame before stacking, and residual stars are detected again on the stack.
- **A synthetic master bias comes with it**: without darks or bias frames, the black level is read from the EXIF data of the raw files (Canon / DNG), used to compute the flat, and saved as a matching synthetic master bias for WBPP.
- **Dark / bias subtraction** from a master dark or master bias, if you have one.
- **Japanese / English** user interface, switchable at the top of the dialog (the choice is remembered).

### Requirements

- PixInsight 1.9.x (tested with 1.9.6 on macOS, Apple Silicon)
- The standard ImageIntegration process

### Installation

1. Download this repository (`Code` → `Download ZIP`, or `git clone`).
2. In PixInsight open **SCRIPT > Feature Scripts...**, click **Add** and select the folder containing `LightsToMasterFlat.js`.
3. The script is now available as **SCRIPT > Utilities > LightsToMasterFlat**.

To try it without installing, use **SCRIPT > Execute Script File...** and select `LightsToMasterFlat.js`.

### Usage

1. **Add light frames** (`Add Files` or `Add Folder`).  
   Use **raw, uncalibrated and unregistered** lights.
2. Choose the **dark / bias subtraction**.
   - *Black level / constant pedestal* (default): for when you have neither darks nor bias frames. With the value left at `0`, the black level is read from the EXIF data of the raw files (Canon cameras and DNG). For other cameras, and for FITS / XISF frames, enter the camera offset in 16-bit ADU. With `Also save a synthetic master bias` enabled, a master bias with the same value is written.
   - *Master dark or master bias file*: if you have the master dark WBPP will use for these lights, that is the best choice.
   - *Nothing*: only if the lights are already dark-subtracted.
3. Leave **Sensor type** on "Auto detect" in most cases.
4. Select an **output folder** and click **Run**.
5. Add the results to WBPP.
   - `masterFlat_FILTER-…_BIN-…_WxH.xisf` → **Flats tab**
   - `masterBias_BIN-…_WxH_…ADU.xisf` → **Bias tab** (not needed if you calibrate the lights with a master dark)

> **The offset must be handled the same way for the flat and for the lights.** The flat is computed from the signal after removing the black level, so the lights must have the same black level removed before they are divided by the flat. Otherwise the corners come out too bright (over-correction): the black level is constant over the frame, while the flat gets smaller towards the edges. The synthetic master bias is how that same value reaches WBPP. DSLR raw files always contain a black level (about 2048 for 14-bit Canon cameras).

### Parameters

| Parameter | Default | Description |
|---|---|---|
| Subtract | Black level | Black level (constant), master dark / bias, or nothing |
| Black level (ADU) | 0 | 0 = read from the EXIF data of the raw files (Canon / DNG); otherwise enter it in 16-bit ADU |
| Also save a synthetic master bias | On | Saves a constant image of the black level as an XISF with `IMAGETYP = Master Bias` |
| CFA layout | Auto detect | Uses the `BAYERPAT` keyword or the CFA property; camera raw files are assumed to be Bayer |
| Mask stars | On | Excludes pixels brighter than the local background in every frame |
| Threshold (sigma) | 3.0 | Lower values mask more |
| Mask growth (px) | 2 | How far the mask is grown to cover star halos; increase for large stars |
| Combination | Average with sigma clipping | Average for 8 or more frames; median is more robust for very few frames |
| Sigma low / high | 4.0 / 2.5 | Winsorized sigma clipping values for ImageIntegration |
| Smooth | On | Removes pixel-scale noise |
| Scale (px) | 16 | Structures larger than this (vignetting, dust shadows) are kept |

### Tips for good results

- **More frames are better**: the sky background is faint, so use 20 frames or more if you can.
- **Dithered data, or data from several targets**, are ideal: stars and nebulae that move from frame to frame are rejected cleanly.
- Combine only lights taken with the **same optical train, camera angle and focus position**. Process them separately if the camera was rotated or the dust moved.
- Lights with a **reasonably bright background** work best. For this purpose, light-polluted skies are actually an advantage.
- To keep small, sharp dust shadows, **lower the smoothing scale** (to 8, for example).

### Limitations

This is not a full replacement for real flats. Please keep the following in mind.

- **Sky gradients cannot be told apart from vignetting.** A gradient from light pollution or moonlight that points the same way in every frame ends up in the flat. Remove the residual after stacking with background correction (GradientCorrection, DBE ...).
- **Large nebulae or galaxies at the same position in every frame** cannot be fully masked; their faint parts remain in the flat. Mixing several targets reduces this.
- **Smoothing weakens structures smaller than the scale.** With the default (16 px), a shadow of 20 px radius and 4% depth becomes about 3.6% deep.
- **A channel without signal cannot be recovered**, for example a colour of an OSC camera that a narrowband filter blocks almost completely.
- **The black level is read automatically for Canon and DNG only.** For Nikon, Sony, Fuji and other raw files, and for FITS frames from astronomy cameras, enter the value (the script stops with an error otherwise).
- **The synthetic master bias is a constant image.** It cannot correct the fixed pattern of a real bias, nor the thermal signal and amplifier glow that darks remove. Real darks are better if you can take them.
- Input must be **single-channel raw frames** (monochrome or CFA). Demosaiced RGB images are not supported.
- Frames that are more than 50% masked (background too faint, clouds, nightscapes ...) are skipped automatically.

### Verification status

| Item | Status |
|---|---|
| Synthetic data (Bayer, dithered, 20 frames, smoothing on) | RMS error against the true flat about 0.2% |
| Synthetic data (monochrome FITS, **not dithered**, 12 frames, smoothing off) | RMS error about 0.6%, maximum error about 3% (more than 150% in the control run without star masking) |
| Keywords and XISF format required by WBPP | Checked against the detection logic in the WBPP source code |
| DSLR raw files (Canon CR2, 20–26 MP) | Reading, automatic CFA detection and execution confirmed; accuracy as a flat not yet verified with real astrophotos |
| Automatic black level | 2047–2048 ADU read from 133 Canon CR2 files (two camera models), matching the median pixel values. DNG checked with a synthetic file only; CR3 not verified |
| Synthetic master bias | Value, keywords and file name covered by the automated test; not yet loaded into WBPP for confirmation |
| X-Trans | Not verified with real camera data |
| Processing time | About 20 s for eight 24 MP frames (Apple Silicon) |
| Windows / Linux | Not tested |

Please check the result with your own data. Bug reports and suggestions are welcome as issues.

### How it works

1. Read the headers and group the frames by filter, binning and image size.
2. Subtract the dark (or the black level; the group mean when it comes from EXIF) from every frame and divide by the median of each CFA position, so all backgrounds match.
3. Measure the local background and noise on a 64 px grid; mask pixels above background + k sigma and grow the mask (masked = value 0 = missing).
4. Stack with ImageIntegration and pixel rejection, excluding zeros as missing data.
5. Treat pixels that were masked in more than half of the frames as missing and, without smoothing, detect residual stars once more on the stack.
6. Build a smooth model from block medians for every CFA position and fill the missing pixels (with smoothing, the whole image is replaced by the model).
7. Set the median of every CFA position to 0.5 and write the master flat.
8. When the black level was used, also write a synthetic master bias filled with the same value (ADU / 65535).

The black level reader and the synthetic bias follow the same approach as [LCP Flat Generator](https://github.com/Geology-cat/pixinsight-lcp-flat-generator) by the same author.

### Tests

An automated test generates synthetic lights and compares the result with the true flat. It starts a new PixInsight instance and takes less than a minute.

```bash
tests/run_tests.sh
```

### License

[MIT License](LICENSE)
