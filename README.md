# 日報図書館

テキストファイルとワードライブラリを管理するWebアプリケーション。

## 機能

### テキストファイルライブラリ
- `.txt` ファイルの読み込み（ドラッグ&ドロップ対応）
- Firestore へのリアルタイム同期・保存
- ファイル名検索・ページネーション
- 編集モード（タイトル・本文の更新）
- パスワード保護付き削除機能

### ワードライブラリ
- `…` `＝` `=` で区切られた用語を自動抽出
- 50音・アルファベット・記号フィルター
- ふりがな自動取得（Gemini API）
- 用語検索・ページネーション
- ランダム表示（最大3件）
- 用語詳細モーダル（出典・説明・最終閲覧日）
- 編集モード（読み・説明の更新）
- パスワード保護付き削除機能

### OCR（カメラ文字認識）
- デバイスカメラから画像キャプチャ
- Google Gemini Vision API による日本語OCR
- 認識結果からの用語自動抽出
- オフライン時はOCR無効化

### PWA・オフライン対応
- Service Worker によるオフラインキャッシュ
- Firestore 永続キャッシュ（マルチタブ対応）
- オンライン復帰時に自動同期

## 技術スタック

| 分類 | 内容 |
|------|------|
| フロントエンド | HTML5 / CSS3 / JavaScript (ES6+ Modules) |
| データベース | Firebase Firestore v11.4.0 |
| OCR / AI | Google Gemini 2.0 Flash API |
| PWA | Service Worker |
| セキュリティ | Web Crypto API (SHA-256) |

## データ構造（Firestore）

**`library` コレクション** — テキストファイル
```json
{
  "title": "ファイル名",
  "content": "本文（===BLOCK_SEPARATOR=== 区切り）",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

**`wordLibrary` コレクション** — 用語
```json
{
  "word": "用語名",
  "delimiters": ["…"],
  "sourceTitle": "出典ファイル名",
  "reading": "よみがな",
  "explanation": "説明文",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "lastSeen": "2025-01-01T00:00:00.000Z"
}
```

**`config` コレクション** — アプリ設定
```json
{
  "geminiApiKey": "ユーザー設定のAPIキー"
}
```

## セキュリティ

- 削除・設定操作はパスワード保護（SHA-256ハッシュ検証）
- APIキー入力欄は別パスワードで保護
- XSS対策（HTML エスケープ処理）

## ファイル構成

```
日報図書館/
├── index.html          # メインHTML
├── styles.css          # スタイルシート
├── script.js           # アプリロジック（Firebase / Gemini / OCR）
├── sw.js               # Service Worker
├── site.webmanifest    # PWA設定
├── favicon.ico         # ファビコン
└── *.png               # PWAアイコン
```

## デプロイ

GitHub Pages で公開中。

**URL**: https://usakoro-hyphen.github.io/daily-report-library/

---

**ライセンス**: MIT License
