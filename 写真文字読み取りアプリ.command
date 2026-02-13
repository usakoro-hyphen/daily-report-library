#!/bin/bash
# 写真文字読み取りアプリ起動スクリプト (.command形式)

# スクリプトのディレクトリに移動
cd "$(dirname "$0")"

# 仮想環境をアクティベートしてアプリを起動
source venv/bin/activate
python ocr_app.py

# ターミナルウィンドウを閉じる
osascript -e 'tell application "Terminal" to close first window' & exit
