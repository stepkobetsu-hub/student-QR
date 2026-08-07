# STEP 出退くん 高速受付基盤

既存のGoogle Apps Scriptを正本として維持しながら、QR読取直後の氏名・入退室表示と、複数タブレット間の当日状態共有だけをCloudflareで高速化する試験基盤です。

## Cloudflareに保存する情報

- 生徒・講師ID
- 氏名
- QR照合キー
- 当日の入退室／出退勤状態
- 受付ID、端末ID、受付時刻

メールアドレス、写真、メール本文、ポイント履歴は保存しません。

## 処理順

1. 毎朝7時（JST）にGoogle側から在籍者名簿を同期
2. QR読取後、校舎ごとのDurable Objectが順番を一元判定
3. 60秒以内の同一QRは重複として状態を反転しない
4. 端末は応答を受けて氏名と入退室を即時表示
5. 写真、正式ログ、メール、ポイントは既存Apps Scriptへバックグラウンド送信

## 必要なSecrets

- `TERMINAL_TOKEN`: タブレット受付API用
- `SYNC_TOKEN`: 管理者による名簿同期用
- `ROSTER_SOURCE_URL`: Apps Script名簿出力URL
- `ROSTER_SOURCE_TOKEN`: Apps Script名簿出力認証用

Secretsはソースや設定ファイルに記載せず、`wrangler secret put`で環境別に登録します。

## 手動名簿同期

Apps Scriptの名簿出力APIから即時同期するときは、`SYNC_TOKEN`で認証した
`POST /v1/admin/sync-from-source`を使用します。応答には校舎名と同期人数だけを返し、
名簿本文は返しません。毎朝7時の自動同期は従来どおりCronから同じ処理を呼び出します。
