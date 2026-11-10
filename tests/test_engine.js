// ============================================================================
// LightsToMasterFlat の自動テスト / Automated test for LightsToMasterFlat
//
// 既知のフラット(周辺減光 + ゴミの影)に星・背景・バイアス・ノイズを加えた
// 合成ライトを作り、スクリプトが元のフラットを復元できるかを確かめる。
// Synthetic lights are generated from a known flat (vignetting + a dust shadow)
// plus stars, sky background, bias and noise, and the recovered master flat is
// compared with the truth.
//
// 実行方法 / Usage (新しい PixInsight インスタンスで実行 / runs in a new PixInsight instance):
//   LTMF_TEST_DIR=/path/to/empty/dir PixInsight -n --automation-mode \
//       -r=tests/test_engine.js --force-exit
// 結果は LTMF_TEST_DIR/test_report.txt に書き出される。
// The report is written to LTMF_TEST_DIR/test_report.txt.
// ============================================================================

#define LTMF_NO_MAIN
#include "../LightsToMasterFlat.js"

// コンソール出力を LTMF_TEST_DIR/console_log.txt に保存する(失敗時の調査用)
// The console output is saved to LTMF_TEST_DIR/console_log.txt (to investigate failures).
var tLog = "";

function tFlushLog()
{
   try
   {
      tLog += console.endLog();
      console.beginLog();
      File.writeTextFile( getEnvironmentVariable( "LTMF_TEST_DIR" ) + "/console_log.txt", tLog );
   }
   catch ( x )
   {}
}
console.beginLog();

var T_W = 640,
   T_H = 480;

function tGauss()
{
   var u = 1 - Math.random(),
      v = Math.random();
   return Math.sqrt( -2 * Math.log( u ) ) * Math.cos( 2 * Math.PI * v );
}

// 真のフラット: 周辺減光 35% + 半径 20 px・深さ 4% のゴミの影
// True flat: 35% vignetting plus a dust shadow (radius 20 px, 4% deep)
function tTruth( x, y )
{
   var dx = ( x - 0.52 * T_W ) / ( 0.5 * T_W ),
      dy = ( y - 0.47 * T_H ) / ( 0.5 * T_W );
   var v = 1 - 0.35 * ( dx * dx + dy * dy ) / 1.6;
   var ex = x - 200,
      ey = y - 150;
   var r = Math.sqrt( ex * ex + ey * ey );
   if ( r < 28 )
      v *= 1 - 0.04 * Math.min( 1, ( 28 - r ) / 8 );
   return v;
}

function tDark( x, y )
{
   return 1000 + 30 * x / T_W; // ADU
}

function tWrite( path, data, bits, isFloat, keywords )
{
   var image = new Image( T_W, T_H, 1, ColorSpace_Gray, 32, SampleType_Real );
   image.setSamples( data, new Rect( 0, 0, T_W, T_H ), 0 );
   var format = new FileFormat( File.extractExtension( path ), false, true );
   var file = new FileFormatInstance( format );
   if ( !file.create( path, "verbosity 0" ) )
      throw new Error( "create failed: " + path );
   var d = new ImageDescription;
   d.bitsPerSample = bits;
   d.ieeefpSampleFormat = isFloat;
   file.setOptions( d );
   file.keywords = keywords;
   if ( !file.writeImage( image ) )
      throw new Error( "write failed: " + path );
   file.close();
   image.free();
}

/*
 * 合成ライトを 1 枚作る。stars = [{x, y, amplitude}] (ADU)
 * Makes one synthetic light frame. stars = [{x, y, amplitude}] (ADU)
 */
function tMakeLight( sky, colour, stars )
{
   var a = new Float32Array( T_W * T_H );
   for ( var y = 0; y < T_H; ++y )
      for ( var x = 0; x < T_W; ++x )
      {
         var signal = sky * colour[ ( y % 2 ) * 2 + x % 2 ] * tTruth( x, y );
         a[ y * T_W + x ] = signal;
      }
   for ( var s = 0; s < stars.length; ++s )
   {
      var st = stars[ s ];
      for ( var yy = Math.max( 0, Math.floor( st.y - 9 ) ); yy < Math.min( T_H, st.y + 10 ); ++yy )
         for ( var xx = Math.max( 0, Math.floor( st.x - 9 ) ); xx < Math.min( T_W, st.x + 10 ); ++xx )
         {
            var d2 = ( xx - st.x ) * ( xx - st.x ) + ( yy - st.y ) * ( yy - st.y );
            a[ yy * T_W + xx ] += st.amplitude * Math.exp( -d2 / ( 2 * 1.6 * 1.6 ) ) * tTruth( xx, yy );
         }
   }
   for ( var i = 0; i < a.length; ++i )
   {
      var x = i % T_W,
         y = ( i - x ) / T_W;
      var v = a[ i ] + Math.sqrt( Math.max( a[ i ], 0 ) + 25 ) * tGauss() + tDark( x, y );
      a[ i ] = Math.min( 65535, Math.max( 0, Math.round( v ) ) ) / 65535;
   }
   return a;
}

function tStars( n )
{
   var stars = [];
   for ( var i = 0; i < n; ++i )
      stars.push(
      {
         x: Math.random() * T_W,
         y: Math.random() * T_H,
         amplitude: 300 * Math.pow( 10, 2.3 * Math.random() )
      } );
   return stars;
}

/*
 * 復元したフラットを真値と比べる。CFA 位置ごとに比の中央値を 1 にそろえて評価する。
 * Compares the recovered flat with the truth, after setting the median ratio of each CFA position to 1.
 */
// CFA 位置ごとの中央値(テスト用の単純な実装)/ median of each CFA position (simple, for the test)
function tClassMedians( data, p )
{
   var medians = [];
   for ( var cy = 0; cy < p; ++cy )
      for ( var cx = 0; cx < p; ++cx )
      {
         var buf = new Float32Array( T_W * T_H ),
            n = 0;
         for ( var y = cy; y < T_H; y += p )
            for ( var x = cx; x < T_W; x += p )
               buf[ n++ ] = data[ y * T_W + x ];
         ltmfSort( buf, n );
         medians.push( buf[ n >> 1 ] );
      }
   return medians;
}

function tCompare( path, p )
{
   var image = ltmfReadImage( path );
   var out = new Float32Array( T_W * T_H );
   image.getSamples( out, new Rect( 0, 0, T_W, T_H ), 0 );
   image.free();
   var ratio = new Float32Array( T_W * T_H );
   for ( var y = 0; y < T_H; ++y )
      for ( var x = 0; x < T_W; ++x )
         ratio[ y * T_W + x ] = out[ y * T_W + x ] / tTruth( x, y );
   var med = tClassMedians( ratio, p );
   var sum2 = 0,
      errs = new Float32Array( T_W * T_H );
   var worst = {
      error: 0
   };
   for ( var y = 0; y < T_H; ++y )
      for ( var x = 0; x < T_W; ++x )
      {
         var e = ratio[ y * T_W + x ] / med[ ( y % p ) * p + x % p ] - 1;
         sum2 += e * e;
         errs[ y * T_W + x ] = Math.abs( e );
         if ( Math.abs( e ) > worst.error )
            worst = {
               error: Math.abs( e ),
               x: x,
               y: y,
               value: out[ y * T_W + x ]
            };
      }
   ltmfSort( errs, errs.length );
   // ゴミの影の深さ: 中心付近の平均 / 周囲の平均
   // Depth of the dust shadow: mean near the centre / mean of the surroundings
   function meanAround( r0, r1 )
   {
      var s = 0,
         n = 0;
      for ( var y = 100; y < 200; ++y )
         for ( var x = 150; x < 250; ++x )
         {
            var r = Math.sqrt( ( x - 200 ) * ( x - 200 ) + ( y - 150 ) * ( y - 150 ) );
            if ( r >= r0 && r < r1 )
            {
               s += out[ y * T_W + x ] / ( tTruth( x, y ) / ( ( r < 28 ) ? 1 - 0.04 * Math.min( 1, ( 28 - r ) / 8 ) : 1 ) ) / med[ ( y % p ) * p + x % p ];
               ++n;
            }
         }
      return s / n;
   }
   return {
      rms: Math.sqrt( sum2 / ( T_W * T_H ) ),
      p99: errs[ Math.floor( 0.99 * errs.length ) ],
      max: errs[ errs.length - 1 ],
      p999: errs[ Math.floor( 0.999 * errs.length ) ],
      worst: "worst at (" + worst.x + "," + worst.y + ") value=" + worst.value.toFixed( 4 ),
      dust: 1 - meanAround( 0, 14 ) / meanAround( 34, 44 )
   };
}

function tRun()
{
   var dir = getEnvironmentVariable( "LTMF_TEST_DIR" );
   if ( !dir )
      throw new Error( "LTMF_TEST_DIR is not set" );
   var report = [];
   var failed = 0;

   function check( name, condition, detail )
   {
      report.push( ( condition ? "PASS" : "FAIL" ) + "  " + name + "  " + detail );
      if ( !condition )
         ++failed;
   }

   LTMF_lang = "en";
   var i, files, P, engine, results, c, header;

   // マスターダーク(32 bit 浮動小数点 XISF)/ master dark (32-bit float XISF)
   var dark = new Float32Array( T_W * T_H );
   for ( i = 0; i < dark.length; ++i )
      dark[ i ] = tDark( i % T_W, 0 ) / 65535;
   var darkPath = dir + "/masterDark.xisf";
   tWrite( darkPath, dark, 32, true, [ new FITSKeyword( "IMAGETYP", "Master Dark", "" ) ] );

   // --- テスト A: ベイヤー、16 bit XISF、ディザリングあり、マスターダーク減算、平滑化あり
   // --- Test A: Bayer, 16-bit XISF, dithered, master dark subtraction, smoothing on
   File.createDirectory( dir + "/A", true );
   files = [];
   for ( i = 0; i < 20; ++i )
   {
      var skyA = 3000 + 5000 * Math.random();
      var path = dir + "/A/light_" + i + ".xisf";
      tWrite( path, tMakeLight( skyA, [ 0.8, 1.0, 1.0, 0.6 ], tStars( 250 ) ), 16, false, [
         new FITSKeyword( "IMAGETYP", "Light Frame", "" ),
         new FITSKeyword( "FILTER", "L-Pro", "" ),
         new FITSKeyword( "XBINNING", "1", "" ),
         new FITSKeyword( "BAYERPAT", "RGGB", "" ),
         new FITSKeyword( "INSTRUME", "TestCam", "" )
      ] );
      files.push( path );
   }
   P = new LTMFParameters;
   P.files = files;
   P.darkMode = 1;
   P.darkPath = darkPath;
   P.outputDir = dir + "/A";
   P.smooth = true;
   P.smoothScale = 16;
   engine = new LTMFEngine( P );
   results = engine.run();
   tFlushLog();
   check( "A: one master flat", results.length == 1, "n=" + results.length );
   if ( results.length == 1 )
   {
      c = tCompare( results[ 0 ].path, 2 );
      check( "A: rms error < 0.5%", c.rms < 0.005, "rms=" + ( 100 * c.rms ).toFixed( 3 ) + "% p99=" + ( 100 * c.p99 ).toFixed( 3 ) + "% p99.9=" + ( 100 * c.p999 ).toFixed( 3 ) + "% max=" + ( 100 * c.max ).toFixed( 3 ) + "% " + c.worst );
      check( "A: dust shadow recovered (true 4%)", c.dust > 0.03 && c.dust < 0.05, "depth=" + ( 100 * c.dust ).toFixed( 2 ) + "%" );
      header = ltmfReadHeader( results[ 0 ].path );
      var imagetyp = "";
      for ( i = 0; i < header.keywords.length; ++i )
         if ( header.keywords[ i ].name == "IMAGETYP" )
            imagetyp = header.keywords[ i ].strippedValue;
      check( "A: IMAGETYP is a master flat", imagetyp.toLowerCase().replace( /\s+/g, "" ) == "masterflat", "IMAGETYP=" + imagetyp );
      check( "A: FILTER / CFA pattern kept", header.filter == "L-Pro" && header.cfaPattern == "RGGB", header.filter + " " + header.cfaPattern );
      check( "A: file name", /masterFlat_FILTER-L-Pro_BIN-1_640x480\.xisf$/.test( results[ 0 ].path ), File.extractNameAndExtension( results[ 0 ].path ) );
   }

   // --- テスト B: モノクロ、16 bit FITS、ディザリングなし(星が全フレームで同じ位置)、
   //               定数ペデスタル、中央値、平滑化なし、フィルター 2 種類
   // --- Test B: monochrome, 16-bit FITS, NOT dithered (stars at the same place in every frame),
   //             constant pedestal, median, no smoothing, two filters
   tFlushLog();
   File.createDirectory( dir + "/B", true );
   files = [];
   var fixedStars = tStars( 250 );
   for ( i = 0; i < 24; ++i )
   {
      var filter = ( i % 2 == 0 ) ? "Ha" : "OIII";
      var pathB = dir + "/B/light_" + filter + "_" + i + ".fit";
      var light = tMakeLight( 2500 + 3000 * Math.random(), [ 1, 1, 1, 1 ], fixedStars );
      // ダークの傾きを取り除いて一定のペデスタル 1000 ADU にする
      // Replace the dark gradient by a constant pedestal of 1000 ADU
      for ( var k = 0; k < light.length; ++k )
         light[ k ] -= ( tDark( k % T_W, 0 ) - 1000 ) / 65535;
      tWrite( pathB, light, 16, false, [
         new FITSKeyword( "IMAGETYP", "Light Frame", "" ),
         new FITSKeyword( "FILTER", filter, "" ),
         new FITSKeyword( "XBINNING", "2", "" )
      ] );
      files.push( pathB );
   }
   P = new LTMFParameters;
   P.files = files;
   P.darkMode = 2;
   P.pedestalADU = 1000;
   P.outputDir = dir + "/B";
   P.combination = 1;
   P.smooth = false;
   engine = new LTMFEngine( P );
   results = engine.run();
   tFlushLog();
   var biases = results.filter( function( r )
   {
      return r.type == "bias";
   } );
   results = results.filter( function( r )
   {
      return r.type == "flat";
   } );
   check( "B: two master flats (one per filter)", results.length == 2, "n=" + results.length );
   check( "B: one synthetic master bias for both filters", biases.length == 1, "n=" + biases.length );
   if ( biases.length == 1 )
   {
      var biasImage = ltmfReadImage( biases[ 0 ].path );
      var biasMin = biasImage.minimum() * 65535,
         biasMax = biasImage.maximum() * 65535;
      var biasSize = biasImage.width + "x" + biasImage.height;
      biasImage.free();
      check( "B: bias is the constant black level", Math.abs( biasMin - 1000 ) < 0.01 && Math.abs( biasMax - 1000 ) < 0.01 && biasSize == "640x480",
         "min=" + biasMin.toFixed( 3 ) + " max=" + biasMax.toFixed( 3 ) + " ADU, " + biasSize );
      header = ltmfReadHeader( biases[ 0 ].path );
      var biasType = "";
      for ( i = 0; i < header.keywords.length; ++i )
         if ( header.keywords[ i ].name == "IMAGETYP" )
            biasType = header.keywords[ i ].strippedValue;
      check( "B: bias IMAGETYP / binning / file name", biasType.toLowerCase().replace( /\s+/g, "" ) == "masterbias" && header.binning == 2 &&
         /masterBias_BIN-2_640x480_1000ADU\.xisf$/.test( biases[ 0 ].path ), biasType + " bin=" + header.binning + " " + File.extractNameAndExtension( biases[ 0 ].path ) );
   }
   for ( i = 0; i < results.length; ++i )
   {
      c = tCompare( results[ i ].path, 1 );
      check( "B" + i + ": rms error < 1%, max < 6% without dithering", c.rms < 0.01 && c.max < 0.06, "rms=" + ( 100 * c.rms ).toFixed( 3 ) + "% p99=" + ( 100 * c.p99 ).toFixed( 3 ) + "% p99.9=" + ( 100 * c.p999 ).toFixed( 3 ) + "% max=" + ( 100 * c.max ).toFixed( 3 ) + "% " + c.worst );
      check( "B" + i + ": dust shadow recovered (true 4%)", c.dust > 0.03 && c.dust < 0.05, "depth=" + ( 100 * c.dust ).toFixed( 2 ) + "%" );
      header = ltmfReadHeader( results[ i ].path );
      check( "B" + i + ": binning kept, no CFA", header.binning == 2 && header.cfaPattern == null, "bin=" + header.binning + " cfa=" + header.cfaPattern );
   }

   // --- テスト C: 対照実験。星マスクなし・ディザリングなしでは星が残ることを確かめる
   // --- Test C: control. Without masking and without dithering the stars must remain
   P.maskStars = false;
   P.prefix = "nomask";
   engine = new LTMFEngine( P );
   results = engine.run();
   tFlushLog();
   if ( results.length > 0 )
   {
      c = tCompare( results[ 0 ].path, 1 );
      check( "C: control without masking is clearly worse", c.max > 0.05, "max=" + ( 100 * c.max ).toFixed( 2 ) + "% rms=" + ( 100 * c.rms ).toFixed( 3 ) + "%" );
   }

   // --- テスト E: 黒レベルの自動読み取り
   // --- Test E: automatic black level
   // E1: FITS には EXIF がないので、0(自動)のままだとグループごとにエラーになり、何も出力しない
   // E1: FITS files have no EXIF data, so 0 (automatic) must fail for every group and write nothing
   P = new LTMFParameters;
   P.files = files;
   P.outputDir = dir + "/B";
   P.prefix = "auto";
   check( "E: defaults are black level mode, automatic, with bias", P.darkMode == 2 && P.pedestalADU == 0 && P.writeBias, "mode=" + P.darkMode + " ped=" + P.pedestalADU + " bias=" + P.writeBias );
   engine = new LTMFEngine( P );
   results = engine.run();
   tFlushLog();
   check( "E: automatic black level fails cleanly for FITS", results.length == 0 && tLog.indexOf( "black level could not be read" ) >= 0, "n=" + results.length );

   // E2: DNG の BlackLevel タグ (0xC61A = 512) だけを持つ最小の TIFF を作って読む
   // E2: read a minimal TIFF that only carries the DNG BlackLevel tag (0xC61A = 512)
   var dngPath = dir + "/synthetic.dng";
   var dngWritten = false;
   try
   {
      var hex = "49492A0008000000" + "0300" +
         "FE00" + "0400" + "01000000" + "00000000" +
         "0F01" + "0200" + "05000000" + "32000000" +
         "1AC6" + "0300" + "01000000" + "00020000" +
         "00000000" + "5465737400";
      var f = new File;
      f.createForWriting( dngPath );
      f.write( ByteArray.fromHex( hex ) );
      f.close();
      dngWritten = File.exists( dngPath );
   }
   catch ( x )
   {
      report.push( "INFO  synthetic DNG could not be written: " + x.message );
   }
   if ( dngWritten )
   {
      var level = ltmfReadBlackLevel( dngPath );
      check( "E: DNG BlackLevel tag", level === 512, "level=" + level );
   }
   check( "E: Canon ColorData index table", ltmfCanonBlackLevelIndex( 1313, 10 ) == 504 && ltmfCanonBlackLevelIndex( 1560, 14 ) == 556 &&
      ltmfCanonBlackLevelIndex( 123, 1 ) === null, "" );
   check( "E: implausible black levels are rejected", ltmfPlausibleBlackLevel( [ 2047, 2048, 2048, 2049 ] ) == 2048 &&
      ltmfPlausibleBlackLevel( [ 2048, 0, 2048, 2048 ] ) === null && ltmfPlausibleBlackLevel( [ 100, 3000, 100, 100 ] ) === null, "" );

   // --- テスト D: ダイアログを両方の言語で生成できること、設定を保存・復元できること
   // --- Test D: the dialog can be built in both languages; settings are saved and restored
   var languages = [ "en", "ja" ];
   for ( i = 0; i < languages.length; ++i )
   {
      var built = false,
         detail = "";
      try
      {
         P = new LTMFParameters;
         P.lang = LTMF_lang = languages[ i ];
         P.files = files.slice( 0, 3 );
         var dialog = new LTMFDialog( P );
         built = dialog.filesTree.numberOfChildren == 3 && dialog.runButton.text == tr( "run" );
         detail = "title=" + dialog.windowTitle + " run=" + dialog.runButton.text + " size=" + dialog.width + "x" + dialog.height;
      }
      catch ( x )
      {
         detail = "exception: " + x.message;
      }
      check( "D: dialog (" + languages[ i ] + ")", built, detail );
   }
   var missing = [];
   for ( var key in LTMF_STRINGS.en )
      if ( LTMF_STRINGS.ja[ key ] === undefined )
         missing.push( key );
   for ( var key in LTMF_STRINGS.ja )
      if ( LTMF_STRINGS.en[ key ] === undefined )
         missing.push( key );
   check( "D: every string exists in both languages", missing.length == 0, "missing: " + missing.join( "," ) );
   LTMF_lang = "en";
   P = new LTMFParameters;
   P.smoothScale = 23;
   P.prefix = "roundtrip";
   P.save();
   var Q = new LTMFParameters;
   Q.load();
   check( "D: settings round trip", Q.smoothScale == 23 && Q.prefix == "roundtrip" && Q.files.length == 0, "scale=" + Q.smoothScale + " prefix=" + Q.prefix );
   report.push( "INFO  guessed language: " + ltmfGuessLanguage() );

   report.push( "" );
   report.push( ( failed == 0 ) ? "ALL TESTS PASSED" : failed + " TEST(S) FAILED" );
   return report;
}

var tReport;
try
{
   tReport = tRun();
}
catch ( x )
{
   tReport = [ "EXCEPTION: " + x.message + ( x.stack ? "\n" + x.stack : "" ) ];
}
try
{
   File.writeTextFile( getEnvironmentVariable( "LTMF_TEST_DIR" ) + "/test_report.txt", tReport.join( "\n" ) + "\n" );
}
catch ( x )
{}
console.writeln( tReport.join( "\n" ) );
tFlushLog();
