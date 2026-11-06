# ひとことToDo

思いついたら3秒で書ける、自分だけのToDoアプリ（iPhone向けWebアプリ）。

- ログイン不要。データはすべて利用者の端末内（IndexedDB）に保存し、外部へ送信しない
- 仕事／プライベートの分類、期限、重要マーク、メモ、画像添付
- 「#仕事」「#プ」「!」による素早い入力
- ホーム画面に追加してアプリとして使用可能（オフライン対応）
- バックアップの書き出し・読み込み（JSONファイル、画像込み）

## ファイル構成

| ファイル | 役割 |
|---|---|
| index.html / style.css / app.js | アプリ本体 |
| sw.js | オフライン用のキャッシュ |
| manifest.webmanifest / icons/ | ホーム画面用の名前とアイコン |
| privacy.html / terms.html | プライバシーポリシー・利用規約（連絡先は要記入） |

## 公開（GitHub Pages）

1. GitHub にリポジトリを作り、このフォルダの中身を push する
2. リポジトリの Settings → Pages → Branch を `main` / `/ (root)` にして保存
3. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開される

## 更新するとき

`sw.js` の `CACHE` と `app.js` の `APP_VERSION` の番号を上げてから公開すると、利用者の端末にも新しい版が届く。

## 手元で試す

```
python3 -m http.server 8000
```
→ http://localhost:8000/
