#!/bin/sh
# 自動テストを新しい PixInsight インスタンスで実行する
# Runs the automated test in a new PixInsight instance.
#   使い方 / usage: tests/run_tests.sh [PixInsight 実行ファイルのパス / path to the PixInsight executable]
#
# PixInsight の -r 引数は ASCII 以外を含むパスを扱えないことがあるため、
# スクリプトを一時フォルダーにコピーしてから実行する。
# The -r argument of PixInsight may fail with non-ASCII paths, so the scripts
# are copied to a temporary folder first.
PI="${1:-/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export LTMF_TEST_DIR="$(mktemp -d)"
mkdir -p "$LTMF_TEST_DIR/src/tests"
cp "$HERE/../LightsToMasterFlat.js" "$LTMF_TEST_DIR/src/"
cp "$HERE/test_engine.js" "$LTMF_TEST_DIR/src/tests/"
# PixInsight は起動時にカレントフォルダーへファイルを作ることがあるので、作業フォルダーに移動しておく
# PixInsight may create files in the current folder at startup, so run it from the work folder.
cd "$LTMF_TEST_DIR"
"$PI" -n --automation-mode --no-focus-stealing -r="$LTMF_TEST_DIR/src/tests/test_engine.js" --force-exit > "$LTMF_TEST_DIR/pixinsight.log" 2>&1
if [ -f "$LTMF_TEST_DIR/test_report.txt" ]; then
   cat "$LTMF_TEST_DIR/test_report.txt"
   grep -q "ALL TESTS PASSED" "$LTMF_TEST_DIR/test_report.txt"
   STATUS=$?
else
   echo "テストレポートがありません / no test report. Log:"
   tail -40 "$LTMF_TEST_DIR/pixinsight.log"
   STATUS=1
fi
[ $STATUS -eq 0 ] && rm -rf "$LTMF_TEST_DIR" || echo "作業フォルダーを残しました / work folder kept: $LTMF_TEST_DIR"
exit $STATUS
