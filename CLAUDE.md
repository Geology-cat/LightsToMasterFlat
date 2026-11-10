# CLAUDE.md

このリポジトリで作業する Claude Code 向けのガイドです。

## プロジェクト概要

**LightsToMasterFlat** は、複数のライトフレームから計算で WBPP 用のマスターフラットを作成する PixInsight スクリプト（PJSR = PixInsight JavaScript Runtime）です。天体用 CMOS カメラ（モノクロ / カラー）とデジタル一眼の RAW の両方を対象にしています。

- 公開リポジトリ: https://github.com/Geology-cat/LightsToMasterFlat
- ライセンス: MIT

## ファイル構成

| パス | 内容 |
|---|---|
| `LightsToMasterFlat.js` | スクリプト本体（1 ファイル完結。ユーザーはこれだけでインストールできる） |
| `tests/test_engine.js` | 合成データによる自動テスト（PixInsight 上で動く） |
| `tests/run_tests.sh` | テストを新しい PixInsight インスタンスで実行するシェルスクリプト |
| `README.md` | 利用者向け説明（日本語 + 英語） |
| `開発履歴.md` | 開発の経緯と判断の記録 |

`LightsToMasterFlat.js` の内部構成（上から順）:

1. `LTMF_STRINGS` … 日英の文字列テーブルと `tr()`
2. `LTMFParameters` … パラメータと設定の保存 / 復元
3. 数値処理 … `ltmfSort` / `ltmfMakeIndicators` / `ltmfNormalizeClasses` / `ltmfMaskStars` / `ltmfBuildModel` など
4. RAW の黒レベル … `ltmfReadBlackLevel`（EXIF の TIFF 構造を直接読む。Canon の ColorData と DNG の BlackLevel）
5. ファイル入出力 … `ltmfReadHeader` / `ltmfReadImage` / `ltmfWriteImage`
6. `LTMFEngine` … グループ化、黒レベルの決定、フレーム処理、ImageIntegration、後処理、マスターフラットと合成マスターバイアスの書き出し
7. `LTMFDialog` … ダイアログ
8. `ltmfMain()` … エントリーポイント（`LTMF_NO_MAIN` が定義されていると実行しない。テストはこれを使って本体をインクルードする）

## 開発ルール

- **会話・コミットメッセージ・ドキュメントは日本語**。
- **スクリプト本体のコメントは日英併記**（日本語 → 英語の順）。公開スクリプトなので、海外の利用者も読めるようにする。
- **ユーザーに見える文字列はすべて `LTMF_STRINGS` の `en` と `ja` の両方に追加**し、`tr("キー")` で参照する。片方だけに追加するとテスト D が失敗する。
- バージョンは `#define LTMF_VERSION` を更新し、`開発履歴.md` に追記する。
- 変更したら必ず `tests/run_tests.sh` を実行し、`ALL TESTS PASSED` を確認してからコミットする。

## テストの実行

```bash
tests/run_tests.sh
```

- 新しい PixInsight インスタンス（`-n --automation-mode --force-exit`）で実行するので、ユーザーが使用中のインスタンスには影響しない。
- 失敗時は作業フォルダーが残り、その中の `console_log.txt` に PixInsight のコンソール出力が入っている。
- **`-r=` に日本語などの非 ASCII 文字を含むパスを渡すとスクリプトが実行されない**（エラーも出ない）。このリポジトリのパスは日本語を含むため、`run_tests.sh` は一時フォルダーにコピーしてから実行している。

テストの内容:

| テスト | 条件 | 判定 |
|---|---|---|
| A | ベイヤー、16 bit XISF、ディザリングあり、マスターダーク、平滑化あり | RMS 誤差 < 0.5%、ゴミの影の復元、キーワード、ファイル名 |
| B | モノクロ、16 bit FITS、**ディザリングなし**、定数ペデスタル、中央値、平滑化なし、2 フィルター | RMS < 1% かつ最大誤差 < 6%、フィルターごとに 1 枚 |
| C | B を星マスクなしで実行（対照実験） | 星が残って大きく悪化すること |
| D | ダイアログの生成（日英）、文字列テーブルの対応、設定の保存 / 復元 | 例外が出ないこと |
| E | 黒レベルの自動読み取り（FITS では失敗して何も出力しない、合成 DNG から 512 を読む、Canon の位置表） | 値の一致 |

テスト B は、合成マスターバイアス（定数 1000 ADU、`IMAGETYP`、ファイル名）も検査する。

## PJSR の落とし穴（実際に踏んだもの）

PixInsight 1.9.6 で確認した事実です。新しいコードを書く前に必ず読んでください。

1. **JavaScript エンジンが古く、JIT もない。**
   - ピクセル単位のループは非常に遅い（単純なループで 1 秒あたり約 900 万回）。24 MP の画像を JS で 1 回なめるだけで数秒かかる。
   - **画像全体への処理は `Image` のネイティブメソッド**（`apply`, `median`, `mean`, `binarize`, `truncate`, `resample`, `cropTo`, `morphologicalTransformation`, `getSamples` / `setSamples`）で行う。これらは 24 MP でも数 ms〜数十 ms。
   - JS のループは、間引いたサンプルの統計と、後処理のブロック中央値（グループごとに 1 回）だけに使う。
   - 型付き配列に `sort()` がない → `ltmfSort()` を使う。`??` や `Intl` もない。ES5 相当の書き方にとどめる（`let` は使えるが `var` で統一している）。
2. **`FileFormatInstance.readImageProperty()` は、形式がプロパティ非対応（FITS など）の場合や、プロパティが存在しない場合にスクリプトを強制終了させる。** `try/catch` では捕まえられない。必ず `format.canStoreImageProperties` と `file.imageProperties` の一覧で確認してから呼ぶ。
3. **`ImageIntegration` の列挙定数は `ImageIntegration.prototype` 側にある**（`ImageIntegration.NoNormalization` は `undefined`）。`ltmfIIConstant()` を使う。`images` は 4 列（`[enabled, path, drizzlePath, lnPath]`）。
4. `Image.binarize(t)` は **`t` 以上**を 1 にする（`t` ちょうども 1）。
5. `Image.resample(f)` に引数 1 つを渡すと倍率指定。双線形補間では、元画像の格子点 `i` が拡大後のピクセル `i*f` に対応し、最後の格子点より先は一定値になる。格子 → 画像サイズへの拡大はこの性質に合わせて設計してある（格子点を中心にした窓で統計をとる）。
6. `Image.median()` などは `rangeClippingEnabled` を立てると範囲外（0 以下など）を除外できる → `ltmfPositiveMedian()`。
7. 8 bit 整数画像に `setSamples()` で 0 / 1 の `Float32Array` を書くと 0 / 255（= 正規化値 0 / 1）になる。CFA の指示画像はこれで作っている（X-Trans は 36 枚必要なので 8 bit にしてメモリを節約）。
8. `console.endLog()` は `ByteArray` を返す。文字列として使うときは `"" + console.endLog()`。
9. バイナリファイルは `File.openForReading()` + `file.read( DataType_ByteArray, n )` で読み、`ByteArray.at( i )` で 1 バイトずつ取り出す。書くときは `File.createForWriting()` + `file.write( ByteArray.fromHex( "..." ) )`（テスト E で使用）。
10. PJSR のプリプロセッサは**正規表現リテラルの中でも `//` を行コメントとみなす**（LCPFlatGenerator の開発で判明）。正規表現に `//` を含めない。日本語を含む書式文字列を `format()` に渡すとプロセスごと落ちることがあるので、文字列は `toFixed()` と連結で組み立てる。
11. コマンドラインからの実行: `PixInsight -n --automation-mode --no-focus-stealing -r=<ASCII パス> --force-exit`。標準出力にはコンソール出力が出ないので、結果はファイルに書く。

## WBPP との互換性（変更時に壊さないこと）

WBPP（`/Applications/PixInsight/src/scripts/BatchPreprocessing/`）のソースで確認した条件:

- マスターファイルは **拡張子 `.xisf` 必須**（それ以外は拒否される）。
- `IMAGETYP` キーワードの値に `master` が含まれるとマスター扱い。値から空白を除いて小文字にしたものが `masterflat` ならフラット。→ `Master Flat` を書いている。
- フラットのマッチングは **ビニング・画像サイズ・フィルター名・CFA かどうか** で行われる。CFA かどうかは `BAYERPAT` キーワード（または `PCL:CFASourcePattern` プロパティ）の有無で決まる。→ ライトの `BAYERPAT` を引き継いでいる。
- バイアスのマッチングは **ビニングと画像サイズ**。合成マスターバイアスは `IMAGETYP = Master Bias` の XISF で、値は 黒レベル / 65535（PixInsight が RAW を読むときの正規化と同じ）。
- **フラットの計算で引いた黒レベルと、合成マスターバイアスの値は必ず同じにする**（`processGroup` の `blackLevel` を両方に使っている）。ずれるとライトが過補正 / 補正不足になる。
- 入力ヒントは WBPP の既定と同じ（`raw cfa use-roworder-keywords signed-is-physical ...`）。行順や RAW の展開方法を WBPP と一致させるためなので、変えない。

## 関連リポジトリ

- https://github.com/Geology-cat/pixinsight-lcp-flat-generator （同じ作者）。黒レベルの読み取り（`ltmfReadBlackLevel` まわり）はここの EXIF パーサから移植した。あちらは GPL-3.0-or-later、こちらは MIT。作者自身のコードなので移植したが、ライセンスの整理は作者の判断事項。

## 未検証の項目

- 合成マスターバイアスを WBPP に実際に読み込ませての確認。
- 黒レベルの自動読み取り: Canon CR2 以外（CR3、DNG の実ファイル）。

- 実際の天体写真（ライト）での仕上がり。合成データでは検証済みだが、実写データでの精度評価はしていない。
- X-Trans の実機データ。
- Windows / Linux、PixInsight 1.8.x。
- ダイアログの見た目（生成時に例外が出ないことはテスト済みだが、画面での目視確認はしていない）。
