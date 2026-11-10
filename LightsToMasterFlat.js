// ============================================================================
// LightsToMasterFlat.js
//
// 複数のライトフレームから計算で WBPP 用マスターフラットを作成する PixInsight スクリプト
// Builds a WBPP-ready master flat computationally from a set of light frames.
//
// 処理の流れ / Pipeline:
//   1. ライトを フィルター・ビニング・画像サイズ ごとにグループ化
//      Group the lights by filter, binning and image size.
//   2. 各フレームからダーク(またはバイアス/定数)を減算し、CFA 位置ごとの中央値で正規化
//      Subtract dark (or bias / a constant) and normalize by the median of each CFA position.
//   3. 星などの明るい構造をフレームごとにマスク(値 0 = 欠損)
//      Mask stars and other bright structures per frame (0 = missing data).
//   4. ImageIntegration で棄却つきスタック
//      Stack with pixel rejection using ImageIntegration.
//   5. 欠損の穴埋めと(任意の)平滑化、正規化を行い、マスターフラットとして XISF 保存
//      Fill holes, optionally smooth, normalize and save as a master flat XISF.
//
// 入力は 1 チャンネルの生フレーム(モノクロまたは CFA)。デベイヤー済みの RGB は対象外。
// Input frames must be single-channel raw frames (monochrome or CFA), not demosaiced RGB.
//
// Released under the MIT License.
// ============================================================================

#feature-id    LightsToMasterFlat : Utilities > LightsToMasterFlat

#feature-info  Builds a WBPP-ready master flat from light frames (sky flat / synthetic flat). \
               Works with dedicated astronomy cameras (mono / OSC) and DSLR raw files.<br/>\
               <br/>\
               ライトフレームから計算で WBPP 用マスターフラットを作成します。\
               天体用 CMOS カメラ(モノクロ / カラー)とデジタル一眼の RAW の両方に対応します。

#include <pjsr/ColorSpace.jsh>
#include <pjsr/SampleType.jsh>
#include <pjsr/DataType.jsh>
#include <pjsr/PropertyType.jsh>
#include <pjsr/ImageOp.jsh>
#include <pjsr/Interpolation.jsh>
#include <pjsr/MorphOp.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/FrameStyle.jsh>
#include <pjsr/TextAlign.jsh>
#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>
#include <pjsr/NumericControl.jsh>

#define LTMF_VERSION "1.0.0"
#define LTMF_TITLE   "LightsToMasterFlat"
#define LTMF_SETTINGS_KEY "LightsToMasterFlat/parameters"

// WBPP の既定と同じ入力ヒント(行順・RAW の読み方を WBPP と一致させるため)
// Same input hints as WBPP's defaults, so row order and raw decoding match WBPP.
#define LTMF_INPUT_HINTS "fits-keywords normalize only-first-image raw cfa use-roworder-keywords signed-is-physical verbosity 0 non-interactive"
#define LTMF_OUTPUT_HINTS "properties fits-keywords no-compress-data no-embedded-data no-resolution verbosity 0"

// ----------------------------------------------------------------------------
// 多言語対応 / Internationalization
// ----------------------------------------------------------------------------

var LTMF_STRINGS = {
   en:
   {
      language: "Language:",
      intro: "<b>LightsToMasterFlat v%1</b> &mdash; Builds a master flat for WBPP from light frames.<br/>" +
         "Use raw, <i>uncalibrated and unregistered</i> lights. The more frames, the more dithering " +
         "and the more different targets, the better the result.",
      grpLights: "Light frames",
      colFile: "File",
      addFiles: "Add Files",
      addFolder: "Add Folder",
      removeSel: "Remove Selected",
      clear: "Clear",
      nFiles: "%1 file(s)",
      selectLights: "Select light frames",
      selectFolder: "Select a folder containing light frames",
      grpDark: "Dark / bias subtraction",
      darkMode: "Subtract:",
      darkNone: "Nothing (lights are already dark-subtracted)",
      darkFile: "Master dark or master bias file",
      darkConst: "Constant pedestal value",
      darkPath: "Master file:",
      select: "Select",
      selectDark: "Select a master dark or master bias",
      pedestal: "Pedestal (16-bit ADU):",
      darkTip: "<p>The offset (bias) and dark current must be removed before a flat can be computed, " +
         "otherwise the vignetting is underestimated.</p>" +
         "<p>Best: the master dark that WBPP will use for these lights. A master bias, or the camera " +
         "offset as a constant, is a reasonable approximation when the dark current is low.</p>" +
         "<p>DSLR raw files always contain a black level, so a master dark/bias or a constant is required.</p>",
      grpCfa: "Sensor type",
      cfaMode: "CFA layout:",
      cfaAuto: "Auto detect",
      cfaMono: "Monochrome (no CFA)",
      cfaBayer: "Bayer 2x2 (OSC / DSLR)",
      cfaXtrans: "X-Trans 6x6",
      cfaTip: "<p>Colour sensors are normalized separately for each position of the colour filter array.</p>" +
         "<p>Auto detect uses the BAYERPAT keyword / CFA property; camera raw files are assumed to be Bayer.</p>",
      grpMask: "Star masking",
      maskEnable: "Mask stars in every frame before stacking",
      maskSigma: "Threshold (sigma):",
      maskGrow: "Mask growth (px):",
      maskTip: "<p>Pixels brighter than the local background by this many sigmas are excluded from the stack. " +
         "The mask is grown by the given number of pixels to cover star halos.</p>" +
         "<p>This is what makes the script work even when the frames are not dithered.</p>",
      grpStack: "Stacking",
      combination: "Combination:",
      combAverage: "Average with sigma clipping",
      combMedian: "Median",
      sigmaLow: "Sigma low:",
      sigmaHigh: "Sigma high:",
      stackTip: "<p>Average with rejection gives the best signal-to-noise ratio and is recommended " +
         "for 8 or more frames. Median is more robust for very few frames.</p>",
      grpSmooth: "Smoothing",
      smoothEnable: "Smooth the master flat (recommended)",
      smoothScale: "Scale (px):",
      smoothTip: "<p>The sky background in light frames is faint, so the stacked flat is noisy at the pixel scale. " +
         "Smoothing keeps vignetting and dust shadows larger than the scale and removes the noise.</p>" +
         "<p>Use a smaller scale to keep small, sharp dust shadows; disable only with a large number of frames.</p>",
      grpOutput: "Output",
      outDir: "Output folder:",
      selectOutDir: "Select the output folder",
      prefix: "File name prefix:",
      openResult: "Open the master flat(s) when finished",
      run: "Run",
      close: "Close",
      errNoFiles: "Add at least 3 light frames.",
      errNoOutDir: "Select an output folder.",
      errNoDark: "Select a master dark / bias file, or choose another subtraction mode.",
      errFewFrames: "Group '%1': only %2 usable frame(s); at least 3 are required. Skipped.",
      errDarkSize: "The master dark / bias (%1) does not match the size of the frames in group '%2' (%3).",
      errRead: "Cannot read file: %1",
      errNoFormat: "No installed file format can read: %1",
      errWrite: "Cannot write file: %1",
      errIntegration: "ImageIntegration failed.",
      errNoData: "No valid data remains after masking and rejection.",
      aborted: "Aborted by the user.",
      warnBackground: "** Warning: non-positive background after dark subtraction, frame skipped: %1",
      warnSkip: "** Warning: frame skipped (%1): %2",
      warnMasked: "** Warning: %2% of the frame is masked (background too faint or too much structure), frame skipped: %1",
      warnFaint: "** Warning: the sky background is very faint compared with the noise. " +
         "Check the dark / pedestal setting; use many frames and keep smoothing enabled.",
      warnRGB: "** Warning: RGB (demosaiced) image skipped; use raw, undebayered frames: %1",
      warnNoDarkRaw: "** Warning: camera raw files contain a black level, but no dark / bias subtraction is selected. " +
         "The flat will underestimate the vignetting.",
      logScan: "Scanning %1 file(s)...",
      logGroup: "Group %1 of %2: %3 (%4 frames, %5)",
      logDark: "Loading master dark / bias: %1",
      logFrame: "  [%1/%2] %3  background=%4 ADU  noise=%5%  masked=%6%",
      logStack: "Stacking %1 frames with ImageIntegration...",
      logPost: "Filling holes / smoothing / normalizing...",
      logHoles: "  Pixels without data filled from the smooth model: %1%",
      logWritten: "Master flat written: %1",
      logDone: "Done. %1 master flat(s) created in %2 s.",
      layoutMono: "monochrome",
      layoutBayer: "Bayer CFA",
      layoutXtrans: "X-Trans CFA",
      doneTitle: "Finished",
      doneText: "<p>%1 master flat(s) created:</p>%2<p>Add them to WBPP in the <b>Flats</b> tab " +
         "(they are recognized as master flats automatically).</p>",
      failText: "<p>No master flat was created. See the Process Console for details.</p>",
      errorTitle: "Error"
   },
   ja:
   {
      language: "言語 / Language:",
      intro: "<b>LightsToMasterFlat v%1</b> &mdash; ライトフレームから WBPP 用のマスターフラットを作成します。<br/>" +
         "<i>キャリブレーション前・位置合わせ前</i>の生のライトを使ってください。" +
         "枚数が多く、ディザリングされ、対象天体が多様であるほど良い結果になります。",
      grpLights: "ライトフレーム",
      colFile: "ファイル",
      addFiles: "ファイルを追加",
      addFolder: "フォルダーを追加",
      removeSel: "選択を削除",
      clear: "すべて削除",
      nFiles: "%1 ファイル",
      selectLights: "ライトフレームを選択",
      selectFolder: "ライトフレームのあるフォルダーを選択",
      grpDark: "ダーク / バイアスの減算",
      darkMode: "減算するもの:",
      darkNone: "なし(ライトはダーク減算済み)",
      darkFile: "マスターダーク または マスターバイアス",
      darkConst: "一定のペデスタル値",
      darkPath: "マスターファイル:",
      select: "選択",
      selectDark: "マスターダーク または マスターバイアスを選択",
      pedestal: "ペデスタル(16 bit ADU):",
      darkTip: "<p>フラットを求める前に、オフセット(バイアス)とダークを取り除く必要があります。" +
         "取り除かないと周辺減光が実際より小さく見積もられます。</p>" +
         "<p>最良なのは、WBPP でそのライトに使うマスターダークです。暗電流が小さい場合は、" +
         "マスターバイアスやカメラのオフセット値(定数)でも十分な近似になります。</p>" +
         "<p>デジタル一眼の RAW には必ず黒レベルが含まれるので、マスターダーク/バイアスか定数の指定が必要です。</p>",
      grpCfa: "センサーの種類",
      cfaMode: "CFA 配列:",
      cfaAuto: "自動判定",
      cfaMono: "モノクロ(CFA なし)",
      cfaBayer: "ベイヤー 2x2(カラーCMOS / 一眼)",
      cfaXtrans: "X-Trans 6x6",
      cfaTip: "<p>カラーセンサーは、カラーフィルター配列の位置ごとに別々に正規化します。</p>" +
         "<p>自動判定は BAYERPAT キーワード / CFA プロパティを使います。カメラの RAW はベイヤーとみなします。</p>",
      grpMask: "星のマスク",
      maskEnable: "スタック前に各フレームの星をマスクする",
      maskSigma: "しきい値(σ):",
      maskGrow: "マスクの拡張(px):",
      maskTip: "<p>周囲の背景よりこの σ 倍以上明るいピクセルをスタックから除外します。" +
         "星のハロを覆うため、マスクを指定ピクセル数だけ広げます。</p>" +
         "<p>ディザリングしていないフレームでも使えるのは、この処理のおかげです。</p>",
      grpStack: "スタック",
      combination: "合成方法:",
      combAverage: "平均(シグマクリップつき)",
      combMedian: "中央値",
      sigmaLow: "シグマ(低):",
      sigmaHigh: "シグマ(高):",
      stackTip: "<p>棄却つき平均は S/N が最も良く、8 枚以上のときに推奨です。" +
         "枚数がごく少ないときは中央値のほうが頑健です。</p>",
      grpSmooth: "平滑化",
      smoothEnable: "マスターフラットを平滑化する(推奨)",
      smoothScale: "スケール(px):",
      smoothTip: "<p>ライトの背景光は暗いので、スタックしたフラットはピクセル単位ではノイズが多くなります。" +
         "平滑化は、スケールより大きい周辺減光やゴミの影を残したままノイズを取り除きます。</p>" +
         "<p>小さく鋭いゴミの影を残したい場合はスケールを小さくしてください。無効にするのは枚数が非常に多いときだけにしてください。</p>",
      grpOutput: "出力",
      outDir: "出力フォルダー:",
      selectOutDir: "出力フォルダーを選択",
      prefix: "ファイル名の接頭辞:",
      openResult: "完了後にマスターフラットを開く",
      run: "実行",
      close: "閉じる",
      errNoFiles: "ライトフレームを 3 枚以上追加してください。",
      errNoOutDir: "出力フォルダーを選択してください。",
      errNoDark: "マスターダーク / バイアスのファイルを選ぶか、別の減算方法を選んでください。",
      errFewFrames: "グループ「%1」: 使用できるフレームが %2 枚しかありません(3 枚以上必要)。スキップします。",
      errDarkSize: "マスターダーク / バイアス(%1)が、グループ「%2」のフレームのサイズ(%3)と一致しません。",
      errRead: "ファイルを読み込めません: %1",
      errNoFormat: "このファイルを読み込めるファイル形式がインストールされていません: %1",
      errWrite: "ファイルを書き込めません: %1",
      errIntegration: "ImageIntegration が失敗しました。",
      errNoData: "マスクと棄却の結果、有効なデータが残りませんでした。",
      aborted: "ユーザーにより中断されました。",
      warnBackground: "** 警告: ダーク減算後の背景が 0 以下です。フレームをスキップします: %1",
      warnSkip: "** 警告: フレームをスキップします(%1): %2",
      warnMasked: "** 警告: フレームの %2% がマスクされました(背景が暗すぎるか、構造が多すぎます)。スキップします: %1",
      warnFaint: "** 警告: 背景光がノイズに比べて非常に暗いです。ダーク / ペデスタルの設定を確認し、" +
         "枚数を増やして平滑化を有効にしてください。",
      warnRGB: "** 警告: RGB(デベイヤー済み)画像はスキップします。デベイヤー前の生フレームを使ってください: %1",
      warnNoDarkRaw: "** 警告: カメラの RAW には黒レベルが含まれますが、ダーク / バイアスの減算が選ばれていません。" +
         "周辺減光が実際より小さいフラットになります。",
      logScan: "%1 個のファイルを調べています...",
      logGroup: "グループ %1 / %2: %3(%4 枚、%5)",
      logDark: "マスターダーク / バイアスを読み込み中: %1",
      logFrame: "  [%1/%2] %3  背景=%4 ADU  ノイズ=%5%  マスク=%6%",
      logStack: "ImageIntegration で %1 枚をスタック中...",
      logPost: "穴埋め / 平滑化 / 正規化...",
      logHoles: "  データのないピクセルを平滑モデルで補完: %1%",
      logWritten: "マスターフラットを書き出しました: %1",
      logDone: "完了。%1 個のマスターフラットを %2 秒で作成しました。",
      layoutMono: "モノクロ",
      layoutBayer: "ベイヤー CFA",
      layoutXtrans: "X-Trans CFA",
      doneTitle: "完了",
      doneText: "<p>%1 個のマスターフラットを作成しました:</p>%2<p>WBPP の <b>Flats</b> タブに追加してください" +
         "(自動的にマスターフラットとして認識されます)。</p>",
      failText: "<p>マスターフラットは作成されませんでした。詳細は Process Console を確認してください。</p>",
      errorTitle: "エラー"
   }
};

var LTMF_lang = "en";

/*
 * 現在の言語の文字列を返す。%1, %2 ... を引数で置き換える。
 * Returns a string in the current language, replacing %1, %2 ... with the arguments.
 */
function tr( key )
{
   var table = LTMF_STRINGS[ LTMF_lang ] || LTMF_STRINGS.en;
   var s = ( table[ key ] !== undefined ) ? table[ key ] : ( ( LTMF_STRINGS.en[ key ] !== undefined ) ? LTMF_STRINGS.en[ key ] : key );
   for ( var i = arguments.length - 1; i >= 1; --i )
      s = s.split( "%" + i ).join( String( arguments[ i ] ) );
   return s;
}

/*
 * 既定の言語を推定する(保存済みの設定がないときだけ使われる)。
 * Guesses the default language (only used when there are no saved settings).
 */
function ltmfGuessLanguage()
{
   try
   {
      var s = ( new Date ).toLocaleString();
      if ( /[぀-ヿ一-鿿]/.test( s ) )
         return "ja";
   }
   catch ( x )
   {}
   try
   {
      // macOS: システムの優先言語を調べる / macOS: ask for the preferred system language
      if ( File.exists( "/usr/bin/defaults" ) )
      {
         var process = new ExternalProcess;
         process.start( "/usr/bin/defaults", [ "read", "-g", "AppleLanguages" ] );
         if ( process.waitForFinished( 3000 ) )
         {
            var first = String( process.stdout ).replace( /[\s()"]/g, "" ).split( "," )[ 0 ];
            if ( /^ja/i.test( first ) )
               return "ja";
            if ( first.length > 0 )
               return "en";
         }
      }
   }
   catch ( x )
   {}
   try
   {
      var names = [ "LANG", "LC_ALL", "LANGUAGE" ];
      for ( var i = 0; i < names.length; ++i )
      {
         var v = getEnvironmentVariable( names[ i ] );
         if ( v && /^ja/i.test( v ) )
            return "ja";
      }
   }
   catch ( x )
   {}
   return "en";
}

// ----------------------------------------------------------------------------
// パラメータ / Parameters
// ----------------------------------------------------------------------------

function LTMFParameters()
{
   this.lang = ltmfGuessLanguage();
   this.files = [];
   this.darkMode = 1; // 0 = なし none, 1 = マスターファイル master file, 2 = 定数 constant
   this.darkPath = "";
   this.pedestalADU = 0;
   this.cfaMode = 0; // 0 = 自動 auto, 1 = モノクロ mono, 2 = ベイヤー Bayer, 3 = X-Trans
   this.maskStars = true;
   this.maskSigma = 3.0;
   this.maskGrow = 2;
   this.combination = 0; // 0 = 棄却つき平均 average with rejection, 1 = 中央値 median
   this.sigmaLow = 4.0;
   this.sigmaHigh = 2.5;
   this.smooth = true;
   this.smoothScale = 16; // センサー上のピクセル数 in sensor pixels
   this.outputDir = "";
   this.prefix = "masterFlat";
   this.openResult = true;

   // ファイル一覧以外を保存する / Everything but the file list is persisted.
   this.save = function()
   {
      var o = {};
      for ( var k in this )
         if ( typeof this[ k ] != "function" && k != "files" )
            o[ k ] = this[ k ];
      Settings.write( LTMF_SETTINGS_KEY, DataType_String, JSON.stringify( o ) );
   };

   this.load = function()
   {
      try
      {
         var s = Settings.read( LTMF_SETTINGS_KEY, DataType_String );
         if ( Settings.lastReadOK && s )
         {
            var o = JSON.parse( s );
            for ( var k in o )
               if ( this.hasOwnProperty( k ) && typeof this[ k ] == typeof o[ k ] && k != "files" )
                  this[ k ] = o[ k ];
         }
      }
      catch ( x )
      {}
   };
}

// ----------------------------------------------------------------------------
// 数値処理 / Numerical core
//
// PixInsight の JavaScript エンジンは JIT を持たず、ピクセル単位のループは非常に
// 遅い(1 ピクセルあたり約 0.1 マイクロ秒 x 演算数)。そのため画像全体に対する処理は
// Image クラスのネイティブ演算(apply, median, resample, morphologicalTransformation
// など)で行い、JavaScript のループは間引いたサンプルの統計だけに使う。
//
// PixInsight's JavaScript engine has no JIT, so per-pixel loops are very slow.
// Whole-image work is therefore done with native Image operations (apply,
// median, resample, morphologicalTransformation ...), and JavaScript loops are
// only used for statistics of subsampled data.
// ----------------------------------------------------------------------------

/*
 * 配列 a の先頭 n 要素を昇順に並べ替える。
 * PixInsight の JavaScript エンジンには型付き配列の sort() がないため自前で実装している
 * (再帰を使わないクイックソート + 小区間は挿入ソート)。
 *
 * Sorts the first n elements of the array a in ascending order.
 * PixInsight's JavaScript engine has no sort() for typed arrays, so this is a
 * custom implementation (non-recursive quicksort, insertion sort for short ranges).
 */
function ltmfSort( a, n )
{
   var stack = new Int32Array( 128 );
   var top = 0;
   var lo = 0,
      hi = n - 1;
   var i, j, pivot, t;
   for ( ;; )
   {
      if ( hi - lo < 16 )
      {
         for ( i = lo + 1; i <= hi; ++i )
         {
            t = a[ i ];
            for ( j = i - 1; j >= lo && a[ j ] > t; --j )
               a[ j + 1 ] = a[ j ];
            a[ j + 1 ] = t;
         }
         if ( top == 0 )
            break;
         hi = stack[ --top ];
         lo = stack[ --top ];
         continue;
      }

      // 3 点の中央値をピボットにする / median-of-three pivot
      var mid = ( lo + hi ) >> 1;
      if ( a[ mid ] < a[ lo ] )
      {
         t = a[ mid ];
         a[ mid ] = a[ lo ];
         a[ lo ] = t;
      }
      if ( a[ hi ] < a[ lo ] )
      {
         t = a[ hi ];
         a[ hi ] = a[ lo ];
         a[ lo ] = t;
      }
      if ( a[ hi ] < a[ mid ] )
      {
         t = a[ hi ];
         a[ hi ] = a[ mid ];
         a[ mid ] = t;
      }
      pivot = a[ mid ];
      i = lo;
      j = hi;
      while ( i <= j )
      {
         while ( a[ i ] < pivot )
            ++i;
         while ( a[ j ] > pivot )
            --j;
         if ( i <= j )
         {
            t = a[ i ];
            a[ i ] = a[ j ];
            a[ j ] = t;
            ++i;
            --j;
         }
      }

      // 大きい側を積み、小さい側を先に処理する(スタックの深さを log n に抑える)
      // Push the larger part and continue with the smaller one (stack depth stays O(log n)).
      if ( j - lo < hi - i )
      {
         stack[ top++ ] = i;
         stack[ top++ ] = hi;
         hi = j;
      }
      else
      {
         stack[ top++ ] = lo;
         stack[ top++ ] = j;
         lo = i;
      }
   }
}

function ltmfNewFloatImage( w, h )
{
   return new Image( w, h, 1, ColorSpace_Gray, 32, SampleType_Real );
}

/*
 * CFA の各位置(p x p 個)の「指示画像」を作る: その位置のピクセルが 1、他が 0 の 8 bit 画像。
 * これを掛けることで、特定の CFA 位置だけをネイティブ演算で取り出せる。
 * モノクロ(p = 1)では null を返す。
 *
 * Builds the "indicator images" of the p x p CFA positions: 8-bit images with 1
 * at the pixels of one position and 0 elsewhere. Multiplying by them isolates a
 * CFA position using native operations. Returns null for monochrome (p = 1).
 */
function ltmfMakeIndicators( w, h, p )
{
   if ( p == 1 )
      return null;
   var indicators = [];
   var row = new Float32Array( w );
   for ( var cy = 0; cy < p; ++cy )
      for ( var cx = 0; cx < p; ++cx )
      {
         var image = new Image( w, h, 1, ColorSpace_Gray, 8, SampleType_Integer );
         image.fill( 0 );
         for ( var x = 0; x < w; ++x )
            row[ x ] = ( x % p == cx ) ? 1 : 0;
         for ( var y = cy; y < h; y += p )
            image.setSamples( row, new Rect( 0, y, w, y + 1 ), 0 );
         indicators.push( image );
      }
   return indicators;
}

/*
 * 0 より大きいピクセルだけの中央値 / Median of the pixels greater than zero.
 */
function ltmfPositiveMedian( image )
{
   image.rangeClippingEnabled = true;
   image.lowRangeClippingEnabled = true;
   image.highRangeClippingEnabled = false;
   image.rangeClipLow = 0;
   var m = image.median();
   image.rangeClippingEnabled = false;
   return m;
}

/*
 * CFA 位置ごとの中央値が target になるように画像を正規化する(その場で書き換える)。
 * 各位置の元の中央値を返す。背景が正でない場合は null を返す。
 * work, acc は画像と同じサイズの作業用浮動小数点画像。
 *
 * Normalizes the image in place so the median of every CFA position becomes
 * target. Returns the original medians, or null if a background is not positive.
 * work and acc are floating point work images of the same size.
 */
function ltmfNormalizeClasses( image, indicators, target, work, acc )
{
   var m;
   if ( image.median() <= 1.0e-7 )
      return null;
   if ( indicators == null )
   {
      m = ltmfPositiveMedian( image );
      if ( !( m > 1.0e-7 ) )
         return null;
      image.apply( target / m, ImageOp_Mul );
      return [ m ];
   }
   var medians = [];
   acc.fill( 0 );
   for ( var k = 0; k < indicators.length; ++k )
   {
      work.assign( image );
      work.apply( indicators[ k ], ImageOp_Mul );
      m = ltmfPositiveMedian( work );
      if ( !( m > 1.0e-7 ) )
         return null;
      work.apply( target / m, ImageOp_Mul );
      acc.apply( work, ImageOp_Add );
      medians.push( m );
   }
   image.assign( acc );
   return medians;
}

/*
 * 格子のうちデータのない点(valid = 0)を、隣接する有効な点の平均で順に埋める。
 * 埋めた後の格子を返す。有効な点が 1 つもなければ null を返す。
 *
 * Fills the grid nodes without data (valid = 0) progressively with the mean of
 * their valid neighbours. Returns the filled grid, or null if no node is valid.
 */
function ltmfFillGrid( grid, valid, nx, ny )
{
   var nValid = 0;
   var i, j;
   for ( i = 0; i < nx * ny; ++i )
      if ( valid[ i ] )
         ++nValid;
   if ( nValid == 0 )
      return null;
   while ( nValid < nx * ny )
   {
      var newValid = new Uint8Array( valid );
      var newGrid = new Float32Array( grid );
      for ( j = 0; j < ny; ++j )
         for ( i = 0; i < nx; ++i )
         {
            if ( valid[ j * nx + i ] )
               continue;
            var sum = 0,
               count = 0;
            for ( var dy = -1; dy <= 1; ++dy )
               for ( var dx = -1; dx <= 1; ++dx )
               {
                  var qx = i + dx,
                     qy = j + dy;
                  if ( qx >= 0 && qx < nx && qy >= 0 && qy < ny && valid[ qy * nx + qx ] )
                  {
                     sum += grid[ qy * nx + qx ];
                     ++count;
                  }
               }
            if ( count > 0 )
            {
               newGrid[ j * nx + i ] = sum / count;
               newValid[ j * nx + i ] = 1;
               ++nValid;
            }
         }
      valid = newValid;
      grid = newGrid;
   }
   return grid;
}

/*
 * 星などの明るい構造をマスクする(マスクされたピクセルは 0 = 欠損になる)。
 *
 *   1. B ピクセル間隔の格子点ごとに、周囲 B x B の窓から間引いたサンプルの中央値と、
 *      星の影響を受けない低輝度側の σ(中央値 - 15.87 パーセンタイル)を求める。
 *   2. σ は格子点ごとだとばらつくので、σ = c * sqrt(中央値) の c を全体の中央値で決める。
 *   3. しきい値 = 中央値 + k σ の格子を双線形補間で画像サイズに拡大する(ネイティブ)。
 *   4. しきい値を超えるピクセルをマスクし、半径 grow ピクセルだけ広げる(ネイティブ)。
 *
 * limit を超えるピクセル(飽和など)も必ずマスクされる。
 * { masked: マスクした割合, noise: 背景に対するピクセルあたりのノイズの比 } を返す。
 * buffer は幅 x 高さの Float32Array(作業用)。
 *
 * Masks stars and other bright structures (masked pixels become 0 = missing).
 *
 *   1. At grid nodes spaced B pixels, the median and the lower-side sigma
 *      (median - 15.87th percentile, which stars cannot bias) are measured from
 *      a subsample of the surrounding B x B window.
 *   2. Node sigmas are noisy, so sigma = c * sqrt(median) is used, with c being
 *      the median over all nodes.
 *   3. The grid of thresholds median + k sigma is enlarged to the image size by
 *      bilinear interpolation (native).
 *   4. Pixels above the threshold are masked and the mask is grown by a radius
 *      of grow pixels (native).
 *
 * Pixels above limit (e.g. saturated) are always masked.
 * Returns { masked: masked fraction, noise: per-pixel noise relative to the background }.
 * buffer is a Float32Array of width x height elements (work space).
 */
function ltmfMaskStars( image, buffer, kSigma, grow, B, limit )
{
   var w = image.width,
      h = image.height;
   image.getSamples( buffer, new Rect( 0, 0, w, h ), 0 );

   var nx = Math.ceil( ( w - 1 ) / B ) + 1;
   var ny = Math.ceil( ( h - 1 ) / B ) + 1;
   var half = B >> 1;
   var stride = Math.max( 1, Math.floor( B / 9 ) ); // 奇数の歩幅なら CFA の全位置を均等に拾う
   if ( stride > 1 && stride % 2 == 0 ) //              an odd stride samples all CFA positions evenly
      ++stride;
   var maxSamples = ( Math.floor( B / stride ) + 2 ) * ( Math.floor( B / stride ) + 2 );
   var scratch = new Float32Array( maxSamples );
   var med = new Float32Array( nx * ny );
   var valid = new Uint8Array( nx * ny );
   var ratio = new Float32Array( nx * ny );
   var nRatio = 0;
   var i, j, x, y, n;

   for ( j = 0; j < ny; ++j )
   {
      var y0 = Math.max( 0, j * B - half ),
         y1 = Math.min( h, j * B + half );
      for ( i = 0; i < nx; ++i )
      {
         var x0 = Math.max( 0, i * B - half ),
            x1 = Math.min( w, i * B + half );
         n = 0;
         for ( y = y0; y < y1; y += stride )
         {
            var row = y * w;
            for ( x = x0; x < x1; x += stride )
               scratch[ n++ ] = buffer[ row + x ];
         }
         if ( n < 8 )
            continue; // 画像の外にある格子点など。後で隣から埋める / e.g. nodes outside the image; filled below
         ltmfSort( scratch, n );
         var m = scratch[ n >> 1 ];
         med[ j * nx + i ] = m;
         valid[ j * nx + i ] = 1;
         var sigma = m - scratch[ Math.floor( n * 0.1587 ) ];
         if ( m > 0 && sigma > 0 )
            ratio[ nRatio++ ] = sigma / Math.sqrt( m );
      }
   }
   med = ltmfFillGrid( med, valid, nx, ny );
   if ( med == null || nRatio == 0 )
      return {
         masked: 0,
         noise: 0
      };
   ltmfSort( ratio, nRatio );
   var c = ratio[ nRatio >> 1 ];

   // 背景に対するピクセルあたりのノイズの比(格子点の中央値の位置で評価)
   // Per-pixel noise relative to the background (evaluated at the median node level)
   var levels = new Float32Array( med );
   ltmfSort( levels, levels.length );
   var level = levels[ levels.length >> 1 ];
   var noise = ( level > 0 ) ? c / Math.sqrt( level ) : 0;

   var threshold = new Float32Array( nx * ny );
   for ( i = 0; i < nx * ny; ++i )
   {
      var t = ( med[ i ] > 0 ) ? med[ i ] + kSigma * c * Math.sqrt( med[ i ] ) : limit;
      threshold[ i ] = ( t < limit ) ? t : limit;
   }

   // しきい値の格子を画像サイズに拡大する。格子点 i は拡大後のピクセル i*B に対応する。
   // Enlarge the threshold grid to the image size. Node i maps to pixel i*B.
   var keep = ltmfNewFloatImage( nx, ny );
   keep.setSamples( threshold, new Rect( 0, 0, nx, ny ), 0 );
   keep.interpolation = Interpolation_Bilinear;
   keep.resample( B );
   keep.cropTo( new Rect( 0, 0, w, h ) );

   // keep = 1(しきい値以下: 使う)/ 0(しきい値超え: マスク)
   // keep = 1 (at or below the threshold: used) / 0 (above the threshold: masked)
   keep.apply( image, ImageOp_Sub );
   keep.binarize( 0 );
   if ( grow > 0 )
   {
      // 円形の構造要素で「使う」領域を収縮 = マスクを拡張
      // Erode the kept area with a circular structuring element = grow the mask.
      var size = 2 * grow + 1;
      var structure = [];
      for ( y = -grow; y <= grow; ++y )
         for ( x = -grow; x <= grow; ++x )
            structure.push( ( x * x + y * y <= ( grow + 0.5 ) * ( grow + 0.5 ) ) ? 1 : 0 );
      keep.morphologicalTransformation( MorphOp_Erosion, [ structure ] );
   }
   var masked = 1 - keep.mean();
   image.apply( keep, ImageOp_Mul );
   keep.free();
   return {
      masked: masked,
      noise: noise
   };
}

/*
 * スタック結果から「平滑モデル」を作る。
 * CFA 位置ごとの面で、bs ピクセル間隔の格子点のまわり bs x bs の窓の中央値
 * (値が 0 = データなしのピクセルは除く)を求め、双線形補間で元の解像度に戻す。
 * データのない格子点は隣接する格子点から埋める。
 *
 * Builds the smooth model of a stacked image.
 * On the plane of each CFA position, the median of the bs x bs window around
 * every grid node (spaced bs pixels; pixels equal to 0 = no data are ignored)
 * is computed, and the grid is brought back to full resolution by bilinear
 * interpolation. Nodes without data are filled from their neighbours.
 */
function ltmfBuildModel( stack, buffer, p, indicators, bs )
{
   var w = stack.width,
      h = stack.height;
   stack.getSamples( buffer, new Rect( 0, 0, w, h ), 0 );
   var model = ltmfNewFloatImage( w, h );
   model.fill( 0 );
   var scratch = new Float32Array( ( bs + 2 ) * ( bs + 2 ) );
   var i, j, px, py, n;

   for ( var cy = 0; cy < p; ++cy )
      for ( var cx = 0; cx < p; ++cx )
      {
         var pw = Math.ceil( ( w - cx ) / p ); // この CFA 位置の面のサイズ / size of the plane of this CFA position
         var ph = Math.ceil( ( h - cy ) / p );
         var nx = Math.ceil( ( pw - 1 ) / bs ) + 1;
         var ny = Math.ceil( ( ph - 1 ) / bs ) + 1;
         var grid = new Float32Array( nx * ny );
         var valid = new Uint8Array( nx * ny );

         // 格子点 (i, j) の窓: 面の座標で [i*bs - bs/2, i*bs + bs/2)
         // Window of node (i, j): [i*bs - bs/2, i*bs + bs/2) in plane coordinates
         for ( j = 0; j < ny; ++j )
         {
            var py0 = Math.max( 0, Math.ceil( j * bs - 0.5 * bs ) ),
               py1 = Math.min( ph, Math.ceil( j * bs + 0.5 * bs ) );
            for ( i = 0; i < nx; ++i )
            {
               var px0 = Math.max( 0, Math.ceil( i * bs - 0.5 * bs ) ),
                  px1 = Math.min( pw, Math.ceil( i * bs + 0.5 * bs ) );
               n = 0;
               for ( py = py0; py < py1; ++py )
               {
                  var row = ( cy + py * p ) * w + cx;
                  for ( px = px0; px < px1; ++px )
                  {
                     var v = buffer[ row + px * p ];
                     if ( v > 0 )
                        scratch[ n++ ] = v;
                  }
               }
               if ( n > 0 )
               {
                  ltmfSort( scratch, n );
                  grid[ j * nx + i ] = ( n & 1 ) ? scratch[ n >> 1 ] : 0.5 * ( scratch[ ( n >> 1 ) - 1 ] + scratch[ n >> 1 ] );
                  valid[ j * nx + i ] = 1;
               }
            }
         }
         // データのない格子点は隣接する有効な格子点から埋める
         // Nodes without data are filled from their valid neighbours.
         grid = ltmfFillGrid( grid, valid, nx, ny );
         if ( grid == null )
            throw new Error( tr( "errNoData" ) );

         // 周囲に 1 格子ぶん線形外挿した余白をつける(CFA のずれ cx, cy を吸収するため)
         // Pad the grid by one linearly extrapolated node on every side (absorbs the CFA offsets cx, cy).
         var gx = nx + 2,
            gy = ny + 2;
         var padded = new Float32Array( gx * gy );
         for ( j = 0; j < ny; ++j )
         {
            var out = ( j + 1 ) * gx;
            for ( i = 0; i < nx; ++i )
               padded[ out + i + 1 ] = grid[ j * nx + i ];
            padded[ out ] = ( nx > 1 ) ? 2 * grid[ j * nx ] - grid[ j * nx + 1 ] : grid[ j * nx ];
            padded[ out + gx - 1 ] = ( nx > 1 ) ? 2 * grid[ j * nx + nx - 1 ] - grid[ j * nx + nx - 2 ] : grid[ j * nx + nx - 1 ];
         }
         for ( i = 0; i < gx; ++i )
         {
            padded[ i ] = ( ny > 1 ) ? 2 * padded[ gx + i ] - padded[ 2 * gx + i ] : padded[ gx + i ];
            padded[ ( gy - 1 ) * gx + i ] = ( ny > 1 ) ? 2 * padded[ ( gy - 2 ) * gx + i ] - padded[ ( gy - 3 ) * gx + i ] : padded[ ( gy - 2 ) * gx + i ];
         }

         // 拡大: 余白つき格子の点 i は拡大後のピクセル i*f に対応する。
         // 面の格子点 i(センサー座標 cx + i*f)は拡大後の (i+1)*f にあるので、
         // 拡大画像の x = f - cx から幅 w を切り出せばセンサー座標に一致する。
         // Enlarge: node i of the padded grid maps to pixel i*f. Plane node i (sensor
         // coordinate cx + i*f) is at (i+1)*f, so cropping w pixels from x = f - cx
         // gives the model in sensor coordinates.
         var f = bs * p;
         var up = ltmfNewFloatImage( gx, gy );
         up.setSamples( padded, new Rect( 0, 0, gx, gy ), 0 );
         up.interpolation = Interpolation_Bilinear;
         up.resample( f );
         up.cropTo( new Rect( f - cx, f - cy, f - cx + w, f - cy + h ) );
         if ( indicators != null )
            up.apply( indicators[ cy * p + cx ], ImageOp_Mul );
         model.apply( up, ImageOp_Add );
         up.free();
      }
   return model;
}

// ----------------------------------------------------------------------------
// ファイル入出力 / File input and output
// ----------------------------------------------------------------------------

function ltmfIsCameraRaw( path )
{
   var ext = File.extractExtension( path ).toLowerCase();
   return [ ".cr2", ".cr3", ".crw", ".nef", ".nrw", ".arw", ".srf", ".sr2", ".raf", ".orf", ".rw2", ".pef", ".dng",
      ".3fr", ".iiq", ".x3f", ".erf", ".mrw", ".raw", ".rwl", ".srw", ".kdc", ".dcr", ".mef", ".mos"
   ].indexOf( ext ) >= 0;
}

function ltmfOpen( path )
{
   var ext = File.extractExtension( path ).toLowerCase();
   var format = new FileFormat( ext, true /*toRead*/ , false /*toWrite*/ );
   if ( format.isNull )
      throw new Error( tr( "errNoFormat", path ) );
   var file = new FileFormatInstance( format );
   if ( file.isNull )
      throw new Error( tr( "errRead", path ) );
   var info = file.open( path, LTMF_INPUT_HINTS );
   if ( !info || info.length < 1 )
      throw new Error( tr( "errRead", path ) );
   return {
      format: format,
      file: file,
      info: info[ 0 ]
   };
}

/*
 * ヘッダーだけを読み、グループ分けに必要な情報を返す。
 * Reads the header only and returns what is needed to group the frames.
 */
function ltmfReadHeader( path )
{
   var o = ltmfOpen( path );
   var header = {
      path: path,
      width: o.info.width,
      height: o.info.height,
      channels: o.info.numberOfChannels,
      filter: "NoFilter",
      binning: 1,
      cfaPattern: null,
      isRaw: ltmfIsCameraRaw( path ),
      keywords: []
   };
   try
   {
      if ( o.format.canStoreKeywords )
      {
         header.keywords = o.file.keywords;
         for ( var i = 0; i < header.keywords.length; ++i )
         {
            var name = header.keywords[ i ].name;
            var value = String( header.keywords[ i ].strippedValue ).trim();
            switch ( name )
            {
               case "FILTER":
               case "INSFLNAM":
                  if ( value.length > 0 )
                     header.filter = value;
                  break;
               case "XBINNING":
               case "BINNING":
               case "CCDBINX":
               {
                  var b = parseInt( value, 10 );
                  if ( b >= 1 )
                     header.binning = b;
               }
               break;
               case "BAYERPAT":
                  if ( value.length > 0 && !/^(none|mono|false|no|n\/a)$/i.test( value ) )
                     header.cfaPattern = value.toUpperCase();
                  break;
            }
         }
      }
      // readImageProperty は、プロパティ非対応の形式(FITS など)や存在しないプロパティに対して
      // 呼ぶとスクリプトが強制終了する(try/catch では捕まえられない)。必ず一覧で存在を確かめる。
      // readImageProperty aborts the script (it cannot be caught) when the format has no
      // property support (e.g. FITS) or the property does not exist, so look it up first.
      if ( header.cfaPattern == null && o.format.canStoreImageProperties )
      {
         var properties = o.file.imageProperties;
         for ( var j = 0; j < properties.length; ++j )
            if ( properties[ j ][ 0 ] == "PCL:CFASourcePattern" )
            {
               var pattern = o.file.readImageProperty( "PCL:CFASourcePattern" );
               if ( typeof pattern == "string" && pattern.length > 0 && !/^(none|mono)$/i.test( pattern ) )
                  header.cfaPattern = pattern.toUpperCase();
               break;
            }
      }
   }
   finally
   {
      o.file.close();
   }
   return header;
}

/*
 * 画像を 32 bit 浮動小数点([0,1] に正規化)の Image として読み込む。
 * Reads an image as a 32-bit floating point Image (normalized to [0,1]).
 */
function ltmfReadImage( path )
{
   var o = ltmfOpen( path );
   var image = ltmfNewFloatImage( 1, 1 );
   var ok;
   try
   {
      ok = o.file.readImage( image );
   }
   finally
   {
      o.file.close();
   }
   if ( !ok )
      throw new Error( tr( "errRead", path ) );

   // 整数形式で読み込まれた場合は浮動小数点に変換する
   // Convert to floating point if the image was read in an integer format.
   if ( image.sampleType != SampleType_Real || image.bitsPerSample != 32 )
   {
      var converted = new Image( image.width, image.height, image.numberOfChannels,
         ( image.numberOfChannels >= 3 ) ? ColorSpace_RGB : ColorSpace_Gray, 32, SampleType_Real );
      converted.apply( image, ImageOp_Mov );
      image.free();
      image = converted;
   }
   return image;
}

/*
 * Image を 32 bit 浮動小数点の XISF として書き出す。
 * Writes an Image as a 32-bit floating point XISF file.
 */
function ltmfWriteImage( path, image, keywords, cfaPattern )
{
   var format = new FileFormat( ".xisf", false /*toRead*/ , true /*toWrite*/ );
   if ( format.isNull )
      throw new Error( tr( "errWrite", path ) );
   var file = new FileFormatInstance( format );
   if ( file.isNull || !file.create( path, LTMF_OUTPUT_HINTS ) )
      throw new Error( tr( "errWrite", path ) );
   try
   {
      var description = new ImageDescription;
      description.bitsPerSample = 32;
      description.ieeefpSampleFormat = true;
      if ( !file.setOptions( description ) )
         throw new Error( tr( "errWrite", path ) );
      if ( keywords && keywords.length > 0 )
         file.keywords = keywords;
      if ( cfaPattern )
         try
         {
            file.writeImageProperty( "PCL:CFASourcePattern", cfaPattern, PropertyType_String8 );
         }
         catch ( x )
         {}
      if ( !file.writeImage( image ) )
         throw new Error( tr( "errWrite", path ) );
   }
   finally
   {
      file.close();
   }
}

// ----------------------------------------------------------------------------
// エンジン / Engine
// ----------------------------------------------------------------------------

/*
 * ImageIntegration の列挙定数を返す(PixInsight のバージョンによって、コンストラクターに
 * あったりプロトタイプにあったりするため)。
 * Returns an enumeration constant of ImageIntegration (depending on the PixInsight
 * version they are found on the constructor or on the prototype).
 */
function ltmfIIConstant( name )
{
   var v = ImageIntegration[ name ];
   if ( v === undefined )
      v = ImageIntegration.prototype[ name ];
   if ( v === undefined )
      throw new Error( "ImageIntegration." + name + " is not available" );
   return v;
}

function LTMFEngine( parameters )
{
   this.parameters = parameters;
   this.results = []; // { path, group, frames }

   this.checkAbort = function()
   {
      processEvents();
      if ( console.abortRequested )
         throw new Error( tr( "aborted" ) );
   };

   /*
    * CFA の周期を決める: 1 = モノクロ, 2 = ベイヤー, 6 = X-Trans
    * CFA period: 1 = monochrome, 2 = Bayer, 6 = X-Trans
    */
   this.cfaPeriod = function( header )
   {
      switch ( this.parameters.cfaMode )
      {
         case 1:
            return 1;
         case 2:
            return 2;
         case 3:
            return 6;
      }
      if ( header.cfaPattern != null )
         return ( header.cfaPattern.length == 36 ) ? 6 : 2;
      return header.isRaw ? 2 : 1;
   };

   this.layoutName = function( p )
   {
      return ( p == 1 ) ? tr( "layoutMono" ) : ( ( p == 2 ) ? tr( "layoutBayer" ) : tr( "layoutXtrans" ) );
   };

   /*
    * フィルター・ビニング・サイズでグループ化する。
    * Groups the frames by filter, binning and size.
    */
   this.buildGroups = function()
   {
      var P = this.parameters;
      console.writeln( tr( "logScan", P.files.length ) );
      var groups = [];
      var index = {};
      for ( var i = 0; i < P.files.length; ++i )
      {
         this.checkAbort();
         var header;
         try
         {
            header = ltmfReadHeader( P.files[ i ] );
         }
         catch ( x )
         {
            console.warningln( tr( "warnSkip", x.message, "<raw>" + P.files[ i ] + "</raw>" ) );
            continue;
         }
         if ( header.channels != 1 )
         {
            console.warningln( tr( "warnRGB", "<raw>" + P.files[ i ] + "</raw>" ) );
            continue;
         }
         var key = [ header.filter, header.binning, header.width, header.height ].join( "|" );
         if ( index[ key ] === undefined )
         {
            index[ key ] = groups.length;
            groups.push(
            {
               key: key,
               name: "FILTER-" + header.filter + "_BIN-" + header.binning + "_" + header.width + "x" + header.height,
               first: header,
               headers: []
            } );
         }
         groups[ index[ key ] ].headers.push( header );
      }
      return groups;
   };

   /*
    * 正規化・マスク済みのフレームを ImageIntegration でスタックし、結果の Image を返す。
    * Stacks the normalized and masked frames with ImageIntegration and returns the resulting Image.
    */
   this.integrate = function( paths )
   {
      var P = this.parameters;
      var II = new ImageIntegration;

      // PixInsight 1.9 以降は 4 列、それ以前は 2 列 / 4 columns since PixInsight 1.9, 2 columns before
      var rows4 = [],
         rows2 = [];
      for ( var i = 0; i < paths.length; ++i )
      {
         rows4.push( [ true, paths[ i ], "", "" ] );
         rows2.push( [ true, paths[ i ] ] );
      }
      try
      {
         II.images = rows4;
      }
      catch ( x )
      {
         II.images = rows2;
      }

      II.inputHints = "fits-keywords normalize verbosity 0";
      II.normalization = ltmfIIConstant( "NoNormalization" ); // 正規化済み / already normalized
      II.rejectionNormalization = ltmfIIConstant( "NoRejectionNormalization" );
      II.weightMode = ltmfIIConstant( "DontCare" );
      if ( P.combination == 1 )
      {
         II.combination = ltmfIIConstant( "Median" );
         II.rejection = ltmfIIConstant( "NoRejection" );
      }
      else
      {
         II.combination = ltmfIIConstant( "Average" );
         if ( paths.length >= 8 )
            II.rejection = ltmfIIConstant( "WinsorizedSigmaClip" );
         else
         {
            II.rejection = ltmfIIConstant( "PercentileClip" );
            II.pcClipLow = 0.2;
            II.pcClipHigh = 0.1;
         }
      }
      II.sigmaLow = P.sigmaLow;
      II.sigmaHigh = P.sigmaHigh;
      II.clipLow = true;
      II.clipHigh = true;
      // 値 0(マスクされたピクセル)を欠損として除外する
      // Pixels with a value of 0 (masked) are excluded as missing data.
      II.rangeClipLow = true;
      II.rangeLow = 0;
      II.rangeClipHigh = false;
      II.largeScaleClipLow = false;
      II.largeScaleClipHigh = false;
      II.generate64BitResult = false;
      II.generateRejectionMaps = false;
      II.generateIntegratedImage = true;
      II.generateDrizzleData = false;
      II.closePreviousImages = false;
      II.evaluateSNR = false;
      II.subtractPedestals = false;
      II.truncateOnOutOfRange = false;
      II.useCache = false;
      II.noGUIMessages = true;
      II.showImages = true;
      II.autoMemorySize = true;

      if ( !II.executeGlobal() )
         throw new Error( tr( "errIntegration" ) );

      var window = ImageWindow.windowById( II.integrationImageId );
      if ( window.isNull )
         throw new Error( tr( "errIntegration" ) );
      var result = new Image( window.mainView.image );
      window.forceClose();
      return result;
   };

   /*
    * マスターフラットの FITS キーワードを作る。
    * Builds the FITS keywords of the master flat.
    */
   this.masterKeywords = function( group, p, nFrames )
   {
      var P = this.parameters;
      var first = group.first;
      var keywords = [];

      // 機材に関するキーワードを最初のライトから引き継ぐ
      // Instrument-related keywords are inherited from the first light frame.
      var inherit = [ "INSTRUME", "TELESCOP", "FOCALLEN", "APTDIA", "APTAREA", "XPIXSZ", "YPIXSZ", "PIXSIZE",
         "GAIN", "OFFSET", "EGAIN", "ISOSPEED", "READOUTM", "ROWORDER", "XBAYROFF", "YBAYROFF", "BAYERPAT"
      ];
      for ( var i = 0; i < first.keywords.length; ++i )
         if ( inherit.indexOf( first.keywords[ i ].name ) >= 0 )
            keywords.push( first.keywords[ i ] );

      keywords.push( new FITSKeyword( "IMAGETYP", "Master Flat", "Type of image" ) );
      keywords.push( new FITSKeyword( "FILTER", first.filter, "Filter used when taking image" ) );
      keywords.push( new FITSKeyword( "XBINNING", String( first.binning ), "Binning factor, horizontal axis" ) );
      keywords.push( new FITSKeyword( "YBINNING", String( first.binning ), "Binning factor, vertical axis" ) );
      keywords.push( new FITSKeyword( "COMMENT", "", "Synthetic master flat computed from light frames" ) );
      keywords.push( new FITSKeyword( "COMMENT", "", "Generated with " + LTMF_TITLE + " v" + LTMF_VERSION ) );
      keywords.push( new FITSKeyword( "HISTORY", "", LTMF_TITLE + ".frames: " + nFrames ) );
      keywords.push( new FITSKeyword( "HISTORY", "", LTMF_TITLE + ".cfaPeriod: " + p ) );
      keywords.push( new FITSKeyword( "HISTORY", "", LTMF_TITLE + ".darkMode: " + [ "none", "master file", "constant" ][ P.darkMode ] +
         ( ( P.darkMode == 2 ) ? " (" + P.pedestalADU + " ADU)" : "" ) ) );
      keywords.push( new FITSKeyword( "HISTORY", "", LTMF_TITLE + ".starMask: " +
         ( P.maskStars ? "sigma=" + P.maskSigma + " grow=" + P.maskGrow : "disabled" ) ) );
      keywords.push( new FITSKeyword( "HISTORY", "", LTMF_TITLE + ".combination: " +
         ( ( P.combination == 1 ) ? "median" : "average, sigma low=" + P.sigmaLow + " high=" + P.sigmaHigh ) ) );
      keywords.push( new FITSKeyword( "HISTORY", "", LTMF_TITLE + ".smoothing: " +
         ( P.smooth ? "scale=" + P.smoothScale + " px" : "disabled" ) ) );
      return keywords;
   };

   /*
    * 1 グループを処理してマスターフラットを書き出す。
    * Processes one group and writes its master flat.
    */
   this.processGroup = function( group, dark, tempDir )
   {
      var P = this.parameters;
      var first = group.first;
      var w = first.width,
         h = first.height;
      var p = this.cfaPeriod( first );
      var pedestal = ( P.darkMode == 2 ) ? P.pedestalADU / 65535 : 0;

      // 正規化後の背景レベル。周辺減光の中心部(背景の最大 2.5 倍)まで [0,1] に収まる。
      // Background level after normalization; leaves headroom (up to 2.5x) for the bright centre.
      var LEVEL = 0.4;

      if ( dark != null && ( dark.width != w || dark.height != h || dark.numberOfChannels != 1 ) )
         throw new Error( tr( "errDarkSize", dark.width + "x" + dark.height, group.name, w + "x" + h ) );
      if ( P.darkMode == 0 && first.isRaw )
         console.warningln( tr( "warnNoDarkRaw" ) );

      var indicators = ltmfMakeIndicators( w, h, p );
      var work = ( p > 1 ) ? ltmfNewFloatImage( w, h ) : null;
      var acc = ( p > 1 ) ? ltmfNewFloatImage( w, h ) : null;
      var buffer = new Float32Array( w * h );
      var count = null;
      if ( P.maskStars )
      {
         count = ltmfNewFloatImage( w, h );
         count.fill( 0 );
      }
      var tempPaths = [];
      var faintWarned = false;
      var image = null,
         stack = null,
         model = null;
      var k;

      try
      {
         // 1) 減算・正規化・マスクして一時ファイルに保存
         //    Subtract, normalize, mask and save to temporary files.
         for ( var i = 0; i < group.headers.length; ++i )
         {
            this.checkAbort();
            var path = group.headers[ i ].path;
            var shortName = "<raw>" + File.extractNameAndExtension( path ) + "</raw>";
            try
            {
               image = ltmfReadImage( path );
            }
            catch ( x )
            {
               console.warningln( tr( "warnSkip", x.message, shortName ) );
               continue;
            }
            if ( image.width != w || image.height != h || image.numberOfChannels != 1 )
            {
               console.warningln( tr( "warnSkip", image.width + "x" + image.height + "x" + image.numberOfChannels, shortName ) );
               image.free();
               image = null;
               continue;
            }

            if ( dark != null )
               image.apply( dark, ImageOp_Sub );
            if ( pedestal != 0 )
               image.apply( pedestal, ImageOp_Sub );

            var medians = ltmfNormalizeClasses( image, indicators, LEVEL, work, acc );
            if ( medians == null )
            {
               console.warningln( tr( "warnBackground", shortName ) );
               image.free();
               image = null;
               continue;
            }
            var background = 0;
            for ( k = 0; k < medians.length; ++k )
               background += medians[ k ] / medians.length;

            var masked = 0;
            var noiseText = "-";
            if ( P.maskStars )
            {
               var maskResult = ltmfMaskStars( image, buffer, P.maskSigma, P.maskGrow, 64, 0.999 );
               masked = maskResult.masked;
               noiseText = ( 100 * maskResult.noise ).toFixed( 1 );

               // 半分以上がマスクされるフレームは、背景が暗すぎるか、星雲・雲などの構造が多すぎる。
               // フラットの材料にならないので除外する。
               // A frame that is more than half masked has too faint a background or too much
               // structure (nebulosity, clouds ...). It cannot contribute to a flat and is skipped.
               if ( masked > 0.5 )
               {
                  console.warningln( tr( "warnMasked", shortName, ( 100 * masked ).toFixed( 0 ) ) );
                  image.free();
                  image = null;
                  continue;
               }
               if ( maskResult.noise > 0.25 && !faintWarned )
               {
                  console.warningln( tr( "warnFaint" ) );
                  faintWarned = true;
               }
            }
            image.truncate( 0, 1 );

            // ピクセルごとに「マスクされなかったフレーム数」を数える
            // Count, for every pixel, the frames in which it was not masked.
            if ( count != null )
            {
               var hasValue = new Image( image );
               hasValue.binarize( 1.0e-9 );
               count.apply( hasValue, ImageOp_Add );
               hasValue.free();
            }

            var tempPath = tempDir + "/ltmf_" + ( "0000" + tempPaths.length ).slice( -4 ) + ".xisf";
            ltmfWriteImage( tempPath, image, null, null );
            image.free();
            image = null;
            tempPaths.push( tempPath );
            console.writeln( tr( "logFrame", i + 1, group.headers.length, shortName,
               ( background * 65535 ).toFixed( 1 ), noiseText, ( 100 * masked ).toFixed( 2 ) ) );
         }

         if ( tempPaths.length < 3 )
         {
            console.warningln( tr( "errFewFrames", group.name, tempPaths.length ) );
            return;
         }

         // 2) スタック / Stack
         this.checkAbort();
         console.writeln( tr( "logStack", tempPaths.length ) );
         stack = this.integrate( tempPaths );
         stack.truncate( 0, 1 );

         // 半数を超えるフレームでマスクされたピクセルは、残りのフレームも星の影響を受けている
         // 可能性が高い(検出しきい値すれすれの星)。欠損として扱い、後でモデルから埋める。
         // ディザリングされたデータでは、ほぼすべてのピクセルが十分な枚数を持つので影響しない。
         // A pixel masked in more than half of the frames is probably contaminated in the
         // remaining ones too (a star close to the detection threshold). It is treated as
         // missing and filled from the model later. Dithered data are practically unaffected.
         if ( count != null )
         {
            count.binarize( Math.ceil( 0.5 * tempPaths.length ) - 0.5 );
            stack.apply( count, ImageOp_Mul );
            count.free();
            count = null;
         }

         // 3) 穴埋め・平滑化 / Fill holes, smooth
         this.checkAbort();
         console.writeln( tr( "logPost" ) );
         var bs = Math.max( 1, Math.round( ( P.smooth ? P.smoothScale : 32 ) / p ) );
         if ( !P.smooth )
            bs = Math.max( bs, 4 );
         model = ltmfBuildModel( stack, buffer, p, indicators, bs );

         // 2 回目の星の検出(平滑化しない場合のみ)。スタックはフレーム単体より S/N が高いので、
         // フレームごとの検出を逃れた暗い星もモデルとの比で見つけられる。見つけたピクセルは欠損にする。
         // 平滑化する場合は、モデル自体がブロックの中央値なので残った星の影響を受けにくい。
         // Second star detection pass (only without smoothing). The stack has a better S/N than
         // a single frame, so faint stars that escaped the per-frame detection show up against
         // the model; they become missing data. With smoothing the model itself is made of block
         // medians, which residual stars can hardly bias.
         if ( P.maskStars && !P.smooth )
         {
            var deviation = new Image( stack );
            deviation.apply( model, ImageOp_Div );
            deviation.apply( 1, ImageOp_Dif ); // |スタック / モデル - 1|
            var sigma = 1.4826 * deviation.median();
            deviation.free();
            if ( sigma > 0 )
            {
               var keep = new Image( model );
               keep.apply( 1 + ( P.maskSigma + 1 ) * sigma, ImageOp_Mul );
               keep.apply( stack, ImageOp_Sub );
               keep.binarize( 0 ); // 1 = スタック <= モデル * (1 + k σ)
               if ( P.maskGrow > 0 )
               {
                  var structure = [];
                  for ( var sy = -P.maskGrow; sy <= P.maskGrow; ++sy )
                     for ( var sx = -P.maskGrow; sx <= P.maskGrow; ++sx )
                        structure.push( ( sx * sx + sy * sy <= ( P.maskGrow + 0.5 ) * ( P.maskGrow + 0.5 ) ) ? 1 : 0 );
                  keep.morphologicalTransformation( MorphOp_Erosion, [ structure ] );
               }
               stack.apply( keep, ImageOp_Mul );
               keep.free();
            }
         }

         // hasData = 1(データあり)/ 0(穴)。binarize は「しきい値以上」を 1 にする。
         // hasData = 1 (data) / 0 (hole). binarize sets values at or above the threshold to 1.
         var hasData = new Image( stack );
         hasData.binarize( 1.0e-9 );
         var holes = 1 - hasData.mean();
         console.writeln( tr( "logHoles", ( 100 * holes ).toFixed( 3 ) ) );
         if ( P.smooth )
            stack.assign( model );
         else
         {
            // 穴だけをモデルで埋める / only the holes are filled from the model
            hasData.invert();
            model.apply( hasData, ImageOp_Mul );
            stack.apply( model, ImageOp_Add );
         }
         hasData.free();
         model.free();
         model = null;

         // 4) 最終正規化: CFA 位置ごとの中央値を 0.5 にそろえ、[0.001, 1] に収める
         //    Final normalization: the median of every CFA position is set to 0.5, clamped to [0.001, 1].
         if ( ltmfNormalizeClasses( stack, indicators, 0.5, work, acc ) == null )
            throw new Error( tr( "errNoData" ) );
         stack.truncate( 0.001, 1 );

         // 5) 書き出し / Write
         var cfaPattern = ( p > 1 ) ? first.cfaPattern : null;
         var outPath = P.outputDir + "/" + P.prefix + "_" + group.name.replace( /[^A-Za-z0-9_.\-]/g, "_" ) + ".xisf";
         ltmfWriteImage( outPath, stack, this.masterKeywords( group, p, tempPaths.length ), cfaPattern );
         console.noteln( tr( "logWritten", "<raw>" + outPath + "</raw>" ) );
         this.results.push(
         {
            path: outPath,
            group: group.name,
            frames: tempPaths.length
         } );
      }
      finally
      {
         for ( var j = 0; j < tempPaths.length; ++j )
            try
            {
               File.remove( tempPaths[ j ] );
            }
            catch ( x )
            {}
         var images = [ image, stack, model, work, acc, count ];
         if ( indicators != null )
            images = images.concat( indicators );
         for ( k = 0; k < images.length; ++k )
            if ( images[ k ] != null )
               try
               {
                  images[ k ].free();
               }
               catch ( x )
               {}
         buffer = null;
         gc();
      }
   };

   this.run = function()
   {
      var P = this.parameters;
      var start = Date.now();
      this.results = [];

      console.show();
      console.abortEnabled = true;
      console.noteln( "<end><cbr><br>" + LTMF_TITLE + " v" + LTMF_VERSION );

      var tempDir = P.outputDir + "/ltmf_temp_" + Date.now();
      File.createDirectory( tempDir, true );
      var dark = null;
      try
      {
         var groups = this.buildGroups();

         if ( P.darkMode == 1 )
         {
            console.writeln( tr( "logDark", "<raw>" + P.darkPath + "</raw>" ) );
            dark = ltmfReadImage( P.darkPath );
         }

         for ( var g = 0; g < groups.length; ++g )
         {
            var group = groups[ g ];
            console.noteln( "<end><cbr><br>" + tr( "logGroup", g + 1, groups.length, group.name, group.headers.length,
               this.layoutName( this.cfaPeriod( group.first ) ) ) );
            if ( group.headers.length < 3 )
            {
               console.warningln( tr( "errFewFrames", group.name, group.headers.length ) );
               continue;
            }
            try
            {
               this.processGroup( group, dark, tempDir );
            }
            catch ( x )
            {
               if ( x.message == tr( "aborted" ) )
                  throw x;
               console.criticalln( "*** Error: " + x.message );
            }
         }
      }
      finally
      {
         if ( dark != null )
            dark.free();
         try
         {
            File.removeDirectory( tempDir );
         }
         catch ( x )
         {}
         console.abortEnabled = false;
      }

      console.noteln( "<end><cbr><br>" + tr( "logDone", this.results.length, ( ( Date.now() - start ) / 1000 ).toFixed( 1 ) ) );
      return this.results;
   };
}

// ----------------------------------------------------------------------------
// ダイアログ / Dialog
// ----------------------------------------------------------------------------

function LTMFDialog( parameters )
{
   this.__base__ = Dialog;
   this.__base__();

   var P = parameters;
   var self = this;
   this.languageChanged = false;

   var labelWidth = this.font.width( tr( "pedestal" ) + "MMM" );

   function makeLabel( parent, text )
   {
      var label = new Label( parent );
      label.text = text;
      label.textAlignment = TextAlign_Right | TextAlign_VertCenter;
      label.minWidth = labelWidth;
      return label;
   }

   function row()
   {
      var sizer = new HorizontalSizer;
      sizer.spacing = 6;
      for ( var i = 0; i < arguments.length; ++i )
         if ( arguments[ i ] === null )
            sizer.addStretch();
         else if ( typeof arguments[ i ] == "number" )
         sizer.addSpacing( arguments[ i ] );
      else
         sizer.add( arguments[ i ], ( arguments[ i ] instanceof Edit ) ? 100 : 0 );
      return sizer;
   }

   function makeNumeric( parent, text, value, min, max, precision, tip, onUpdate )
   {
      var control = new NumericControl( parent );
      control.label.text = text;
      control.label.minWidth = labelWidth;
      control.setRange( min, max );
      control.slider.setRange( 0, 200 );
      control.slider.minWidth = 160;
      control.setPrecision( precision );
      control.setValue( value );
      control.toolTip = tip;
      control.onValueUpdated = onUpdate;
      return control;
   }

   // --- 言語と説明 / language and introduction

   this.languageCombo = new ComboBox( this );
   this.languageCombo.addItem( "English" );
   this.languageCombo.addItem( "日本語" );
   this.languageCombo.currentItem = ( P.lang == "ja" ) ? 1 : 0;
   this.languageCombo.onItemSelected = function( item )
   {
      var lang = ( item == 1 ) ? "ja" : "en";
      if ( lang != P.lang )
      {
         P.lang = lang;
         self.languageChanged = true;
         self.cancel();
      }
   };

   this.introLabel = new Label( this );
   this.introLabel.useRichText = true;
   this.introLabel.wordWrapping = true;
   this.introLabel.frameStyle = FrameStyle_Box;
   this.introLabel.margin = 6;
   this.introLabel.text = tr( "intro", LTMF_VERSION );

   // --- ライトフレーム / light frames

   this.filesTree = new TreeBox( this );
   this.filesTree.multipleSelection = true;
   this.filesTree.rootDecoration = false;
   this.filesTree.alternateRowColor = true;
   this.filesTree.numberOfColumns = 1;
   this.filesTree.headerVisible = false;
   this.filesTree.setScaledMinSize( 560, 160 );

   this.countLabel = new Label( this );
   this.countLabel.textAlignment = TextAlign_Left | TextAlign_VertCenter;

   this.updateFiles = function()
   {
      self.filesTree.clear();
      for ( var i = 0; i < P.files.length; ++i )
      {
         var node = new TreeBoxNode( self.filesTree );
         node.setText( 0, P.files[ i ] );
      }
      self.countLabel.text = tr( "nFiles", P.files.length );
   };

   this.addFiles = function( paths )
   {
      for ( var i = 0; i < paths.length; ++i )
         if ( P.files.indexOf( paths[ i ] ) < 0 )
            P.files.push( paths[ i ] );
      P.files.sort();
      self.updateFiles();
   };

   this.addFilesButton = new PushButton( this );
   this.addFilesButton.text = tr( "addFiles" );
   this.addFilesButton.onClick = function()
   {
      var dialog = new OpenFileDialog;
      dialog.multipleSelections = true;
      dialog.caption = tr( "selectLights" );
      dialog.loadImageFilters();
      if ( dialog.execute() )
         self.addFiles( dialog.fileNames );
   };

   this.addFolderButton = new PushButton( this );
   this.addFolderButton.text = tr( "addFolder" );
   this.addFolderButton.onClick = function()
   {
      var dialog = new GetDirectoryDialog;
      dialog.caption = tr( "selectFolder" );
      if ( !dialog.execute() )
         return;
      var extensions = [ ".xisf", ".fit", ".fits", ".fts", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".orf", ".rw2", ".pef", ".dng" ];
      var found = [];
      for ( var i = 0; i < extensions.length; ++i )
      {
         found = found.concat( searchDirectory( dialog.directory + "/*" + extensions[ i ], true /*recursive*/ ) );
         found = found.concat( searchDirectory( dialog.directory + "/*" + extensions[ i ].toUpperCase(), true ) );
      }
      // 自分の出力(マスターや一時ファイル)は除外 / exclude masters and temporary files
      found = found.filter( function( path )
      {
         return !/master|ltmf_temp/i.test( path );
      } );
      self.addFiles( found );
   };

   this.removeButton = new PushButton( this );
   this.removeButton.text = tr( "removeSel" );
   this.removeButton.onClick = function()
   {
      var keep = [];
      for ( var i = 0; i < self.filesTree.numberOfChildren; ++i )
         if ( !self.filesTree.child( i ).selected )
            keep.push( P.files[ i ] );
      P.files = keep;
      self.updateFiles();
   };

   this.clearButton = new PushButton( this );
   this.clearButton.text = tr( "clear" );
   this.clearButton.onClick = function()
   {
      P.files = [];
      self.updateFiles();
   };

   this.lightsGroup = new GroupBox( this );
   this.lightsGroup.title = tr( "grpLights" );
   this.lightsGroup.sizer = new VerticalSizer;
   this.lightsGroup.sizer.margin = 6;
   this.lightsGroup.sizer.spacing = 4;
   this.lightsGroup.sizer.add( this.filesTree, 100 );
   this.lightsGroup.sizer.add( row( this.addFilesButton, this.addFolderButton, this.removeButton, this.clearButton, null, this.countLabel ) );

   // --- ダーク / dark

   this.darkCombo = new ComboBox( this );
   this.darkCombo.addItem( tr( "darkNone" ) );
   this.darkCombo.addItem( tr( "darkFile" ) );
   this.darkCombo.addItem( tr( "darkConst" ) );
   this.darkCombo.currentItem = P.darkMode;
   this.darkCombo.toolTip = tr( "darkTip" );
   this.darkCombo.onItemSelected = function( item )
   {
      P.darkMode = item;
      self.updateControls();
   };

   this.darkEdit = new Edit( this );
   this.darkEdit.text = P.darkPath;
   this.darkEdit.toolTip = tr( "darkTip" );
   this.darkEdit.onEditCompleted = function()
   {
      P.darkPath = self.darkEdit.text.trim();
   };

   this.darkButton = new PushButton( this );
   this.darkButton.text = tr( "select" );
   this.darkButton.onClick = function()
   {
      var dialog = new OpenFileDialog;
      dialog.caption = tr( "selectDark" );
      dialog.loadImageFilters();
      if ( dialog.execute() )
      {
         P.darkPath = dialog.fileName;
         self.darkEdit.text = P.darkPath;
      }
   };

   this.pedestalSpin = new SpinBox( this );
   this.pedestalSpin.minValue = 0;
   this.pedestalSpin.maxValue = 65535;
   this.pedestalSpin.value = P.pedestalADU;
   this.pedestalSpin.toolTip = tr( "darkTip" );
   this.pedestalSpin.onValueUpdated = function( value )
   {
      P.pedestalADU = value;
   };

   this.darkPathLabel = makeLabel( this, tr( "darkPath" ) );
   this.pedestalLabel = makeLabel( this, tr( "pedestal" ) );

   this.darkGroup = new GroupBox( this );
   this.darkGroup.title = tr( "grpDark" );
   this.darkGroup.sizer = new VerticalSizer;
   this.darkGroup.sizer.margin = 6;
   this.darkGroup.sizer.spacing = 4;
   this.darkGroup.sizer.add( row( makeLabel( this, tr( "darkMode" ) ), this.darkCombo, null ) );
   this.darkGroup.sizer.add( row( this.darkPathLabel, this.darkEdit, this.darkButton ) );
   this.darkGroup.sizer.add( row( this.pedestalLabel, this.pedestalSpin, null ) );

   // --- センサー / sensor

   this.cfaCombo = new ComboBox( this );
   this.cfaCombo.addItem( tr( "cfaAuto" ) );
   this.cfaCombo.addItem( tr( "cfaMono" ) );
   this.cfaCombo.addItem( tr( "cfaBayer" ) );
   this.cfaCombo.addItem( tr( "cfaXtrans" ) );
   this.cfaCombo.currentItem = P.cfaMode;
   this.cfaCombo.toolTip = tr( "cfaTip" );
   this.cfaCombo.onItemSelected = function( item )
   {
      P.cfaMode = item;
   };

   this.cfaGroup = new GroupBox( this );
   this.cfaGroup.title = tr( "grpCfa" );
   this.cfaGroup.sizer = new VerticalSizer;
   this.cfaGroup.sizer.margin = 6;
   this.cfaGroup.sizer.add( row( makeLabel( this, tr( "cfaMode" ) ), this.cfaCombo, null ) );

   // --- 星マスク / star mask

   this.maskCheck = new CheckBox( this );
   this.maskCheck.text = tr( "maskEnable" );
   this.maskCheck.checked = P.maskStars;
   this.maskCheck.toolTip = tr( "maskTip" );
   this.maskCheck.onCheck = function( checked )
   {
      P.maskStars = checked;
      self.updateControls();
   };

   this.maskSigmaControl = makeNumeric( this, tr( "maskSigma" ), P.maskSigma, 1.5, 10, 1, tr( "maskTip" ), function( value )
   {
      P.maskSigma = value;
   } );

   this.maskGrowSpin = new SpinBox( this );
   this.maskGrowSpin.minValue = 0;
   this.maskGrowSpin.maxValue = 20;
   this.maskGrowSpin.value = P.maskGrow;
   this.maskGrowSpin.toolTip = tr( "maskTip" );
   this.maskGrowSpin.onValueUpdated = function( value )
   {
      P.maskGrow = value;
   };
   this.maskGrowLabel = makeLabel( this, tr( "maskGrow" ) );

   this.maskGroup = new GroupBox( this );
   this.maskGroup.title = tr( "grpMask" );
   this.maskGroup.sizer = new VerticalSizer;
   this.maskGroup.sizer.margin = 6;
   this.maskGroup.sizer.spacing = 4;
   this.maskGroup.sizer.add( row( labelWidth + 6, this.maskCheck, null ) );
   this.maskGroup.sizer.add( this.maskSigmaControl );
   this.maskGroup.sizer.add( row( this.maskGrowLabel, this.maskGrowSpin, null ) );

   // --- スタック / stacking

   this.combinationCombo = new ComboBox( this );
   this.combinationCombo.addItem( tr( "combAverage" ) );
   this.combinationCombo.addItem( tr( "combMedian" ) );
   this.combinationCombo.currentItem = P.combination;
   this.combinationCombo.toolTip = tr( "stackTip" );
   this.combinationCombo.onItemSelected = function( item )
   {
      P.combination = item;
      self.updateControls();
   };

   this.sigmaLowControl = makeNumeric( this, tr( "sigmaLow" ), P.sigmaLow, 1, 10, 1, tr( "stackTip" ), function( value )
   {
      P.sigmaLow = value;
   } );
   this.sigmaHighControl = makeNumeric( this, tr( "sigmaHigh" ), P.sigmaHigh, 1, 10, 1, tr( "stackTip" ), function( value )
   {
      P.sigmaHigh = value;
   } );

   this.stackGroup = new GroupBox( this );
   this.stackGroup.title = tr( "grpStack" );
   this.stackGroup.sizer = new VerticalSizer;
   this.stackGroup.sizer.margin = 6;
   this.stackGroup.sizer.spacing = 4;
   this.stackGroup.sizer.add( row( makeLabel( this, tr( "combination" ) ), this.combinationCombo, null ) );
   this.stackGroup.sizer.add( this.sigmaLowControl );
   this.stackGroup.sizer.add( this.sigmaHighControl );

   // --- 平滑化 / smoothing

   this.smoothCheck = new CheckBox( this );
   this.smoothCheck.text = tr( "smoothEnable" );
   this.smoothCheck.checked = P.smooth;
   this.smoothCheck.toolTip = tr( "smoothTip" );
   this.smoothCheck.onCheck = function( checked )
   {
      P.smooth = checked;
      self.updateControls();
   };

   this.smoothSpin = new SpinBox( this );
   this.smoothSpin.minValue = 2;
   this.smoothSpin.maxValue = 512;
   this.smoothSpin.value = P.smoothScale;
   this.smoothSpin.toolTip = tr( "smoothTip" );
   this.smoothSpin.onValueUpdated = function( value )
   {
      P.smoothScale = value;
   };
   this.smoothLabel = makeLabel( this, tr( "smoothScale" ) );

   this.smoothGroup = new GroupBox( this );
   this.smoothGroup.title = tr( "grpSmooth" );
   this.smoothGroup.sizer = new VerticalSizer;
   this.smoothGroup.sizer.margin = 6;
   this.smoothGroup.sizer.spacing = 4;
   this.smoothGroup.sizer.add( row( labelWidth + 6, this.smoothCheck, null ) );
   this.smoothGroup.sizer.add( row( this.smoothLabel, this.smoothSpin, null ) );

   // --- 出力 / output

   this.outDirEdit = new Edit( this );
   this.outDirEdit.text = P.outputDir;
   this.outDirEdit.onEditCompleted = function()
   {
      P.outputDir = self.outDirEdit.text.trim();
   };

   this.outDirButton = new PushButton( this );
   this.outDirButton.text = tr( "select" );
   this.outDirButton.onClick = function()
   {
      var dialog = new GetDirectoryDialog;
      dialog.caption = tr( "selectOutDir" );
      if ( P.outputDir.length > 0 )
         dialog.initialPath = P.outputDir;
      if ( dialog.execute() )
      {
         P.outputDir = dialog.directory;
         self.outDirEdit.text = P.outputDir;
      }
   };

   this.prefixEdit = new Edit( this );
   this.prefixEdit.text = P.prefix;
   this.prefixEdit.onEditCompleted = function()
   {
      var s = self.prefixEdit.text.trim().replace( /[^A-Za-z0-9_.\-]/g, "_" );
      P.prefix = ( s.length > 0 ) ? s : "masterFlat";
      self.prefixEdit.text = P.prefix;
   };

   this.openCheck = new CheckBox( this );
   this.openCheck.text = tr( "openResult" );
   this.openCheck.checked = P.openResult;
   this.openCheck.onCheck = function( checked )
   {
      P.openResult = checked;
   };

   this.outputGroup = new GroupBox( this );
   this.outputGroup.title = tr( "grpOutput" );
   this.outputGroup.sizer = new VerticalSizer;
   this.outputGroup.sizer.margin = 6;
   this.outputGroup.sizer.spacing = 4;
   this.outputGroup.sizer.add( row( makeLabel( this, tr( "outDir" ) ), this.outDirEdit, this.outDirButton ) );
   this.outputGroup.sizer.add( row( makeLabel( this, tr( "prefix" ) ), this.prefixEdit ) );
   this.outputGroup.sizer.add( row( labelWidth + 6, this.openCheck, null ) );

   // --- ボタン / buttons

   this.runButton = new PushButton( this );
   this.runButton.text = tr( "run" );
   this.runButton.defaultButton = true;
   this.runButton.onClick = function()
   {
      // 編集中のテキストを反映 / commit pending text edits
      P.darkPath = self.darkEdit.text.trim();
      P.outputDir = self.outDirEdit.text.trim();
      self.prefixEdit.onEditCompleted();

      var error = null;
      if ( P.files.length < 3 )
         error = tr( "errNoFiles" );
      else if ( P.outputDir.length == 0 || !File.directoryExists( P.outputDir ) )
         error = tr( "errNoOutDir" );
      else if ( P.darkMode == 1 && ( P.darkPath.length == 0 || !File.exists( P.darkPath ) ) )
         error = tr( "errNoDark" );
      if ( error != null )
      {
         ( new MessageBox( error, LTMF_TITLE, StdIcon_Error, StdButton_Ok ) ).execute();
         return;
      }
      self.ok();
   };

   this.closeButton = new PushButton( this );
   this.closeButton.text = tr( "close" );
   this.closeButton.onClick = function()
   {
      self.cancel();
   };

   this.updateControls = function()
   {
      self.darkPathLabel.enabled = self.darkEdit.enabled = self.darkButton.enabled = ( P.darkMode == 1 );
      self.pedestalLabel.enabled = self.pedestalSpin.enabled = ( P.darkMode == 2 );
      self.maskSigmaControl.enabled = self.maskGrowLabel.enabled = self.maskGrowSpin.enabled = P.maskStars;
      self.sigmaLowControl.enabled = self.sigmaHighControl.enabled = ( P.combination == 0 );
      self.smoothLabel.enabled = self.smoothSpin.enabled = P.smooth;
   };

   // --- 全体のレイアウト / overall layout

   var columns = new HorizontalSizer;
   columns.spacing = 8;
   var left = new VerticalSizer;
   left.spacing = 6;
   left.add( this.darkGroup );
   left.add( this.cfaGroup );
   left.add( this.outputGroup );
   left.addStretch();
   var right = new VerticalSizer;
   right.spacing = 6;
   right.add( this.maskGroup );
   right.add( this.stackGroup );
   right.add( this.smoothGroup );
   right.addStretch();
   columns.add( left, 50 );
   columns.add( right, 50 );

   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add( row( makeLabel( this, tr( "language" ) ), this.languageCombo, null ) );
   this.sizer.add( this.introLabel );
   this.sizer.add( this.lightsGroup, 100 );
   this.sizer.add( columns );
   this.sizer.add( row( null, this.runButton, this.closeButton ) );

   this.windowTitle = LTMF_TITLE + " v" + LTMF_VERSION;
   this.updateFiles();
   this.updateControls();
   this.adjustToContents();
}

LTMFDialog.prototype = new Dialog;

// ----------------------------------------------------------------------------
// メイン / Main
// ----------------------------------------------------------------------------

function ltmfMain()
{
   var parameters = new LTMFParameters;
   parameters.load();

   for ( ;; )
   {
      LTMF_lang = parameters.lang;
      var dialog = new LTMFDialog( parameters );
      var accepted = dialog.execute();
      parameters.save();
      if ( dialog.languageChanged )
         continue;
      if ( !accepted )
         return;
      break;
   }

   var engine = new LTMFEngine( parameters );
   var results;
   try
   {
      results = engine.run();
   }
   catch ( x )
   {
      console.criticalln( "*** Error: " + x.message );
      ( new MessageBox( x.message, tr( "errorTitle" ), StdIcon_Error, StdButton_Ok ) ).execute();
      return;
   }

   if ( results.length == 0 )
   {
      ( new MessageBox( tr( "failText" ), LTMF_TITLE, StdIcon_Warning, StdButton_Ok ) ).execute();
      return;
   }

   var list = "<ul>";
   for ( var i = 0; i < results.length; ++i )
   {
      list += "<li>" + File.extractNameAndExtension( results[ i ].path ) + " (" + results[ i ].frames + ")</li>";
      if ( parameters.openResult )
         try
         {
            var windows = ImageWindow.open( results[ i ].path );
            for ( var j = 0; j < windows.length; ++j )
               windows[ j ].show();
         }
         catch ( x )
         {}
   }
   list += "</ul>";
   ( new MessageBox( tr( "doneText", results.length, list ), tr( "doneTitle" ), StdIcon_Information, StdButton_Ok ) ).execute();
}

#ifndef LTMF_NO_MAIN
ltmfMain();
#endif
