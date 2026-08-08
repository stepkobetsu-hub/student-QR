# STEP 出退くん 高速受付基盤

既存のGoogle Apps Scriptを正本として維持しながら、QR読取直後の氏名・入退室表示と、複数タブレット間の当日状態共有だけをCloudflareで高速化する試験基盤です。

## Cloudflareに保存する情報

- 生徒・講師ID
- 氏名
- QR照合キー
- 当日の入退室／出退勤状態
- 受付ID、端末ID、受付時刻

メールアドレス、メール本文、ポイント履歴は保存しません。写真はApps Scriptへの送信待ちの間だけ一時保存し、送信成功後に削除します。

## 処理順

1. 毎朝7時（JST）にGoogle側から在籍者名簿を同期
2. 未登録QRを受けた場合は、その校舎の名簿を自動同期して同じ受付を1回だけ再判定
3. QR読取後、校舎ごとのDurable Objectが順番を一元判定
4. 60秒以内の同一QRは重複として状態を反転しない
5. 端末は応答を受けて氏名と入退室を即時表示
6. 写真、正式ログ、メール、ポイントは受付ID付きで既存Apps Scriptへバックグラウンド送信
7. Apps Scriptへの送信に失敗した場合はDurable ObjectのAlarmから自動再送

未登録QRによる名簿同期には校舎ごとに30秒のクールダウンを設け、複数端末からの同時読取で
Google側へ同期要求が集中しないようにします。これにより、朝7時以降に登録された生徒も、
原則として最初のQR読取時から利用できます。

## 必要なSecrets

- `TERMINAL_TOKEN`: タブレット受付API用（校舎別Secret未登録時の共通予備）
- `TERMINAL_TOKEN_JINRYO`: 神領校端末用
- `TERMINAL_TOKEN_OTEMACHI`: 大手町校端末用
- `SYNC_TOKEN`: 管理者による名簿同期用
- `ROSTER_SOURCE_TOKEN`: Apps Script名簿出力認証用

Secretsはソースや設定ファイルに記載せず、`wrangler secret put`で環境別に登録します。

`ROSTER_SOURCE_URL`、`CHECKIN_WRITE_URL`、`CHECKIN_WRITE_ENABLED`は環境別の通常変数です。
ステージングは`CHECKIN_WRITE_ACTION=edgeCheckInProbe`を使い、正式記録・ポイント・メールを作らず書き戻し経路だけを検証します。
本番は検証完了まで`CHECKIN_WRITE_ENABLED=false`のままにします。

## 手動名簿同期

Apps Scriptの名簿出力APIから即時同期するときは、`SYNC_TOKEN`で認証した
`POST /v1/admin/sync-from-source`を使用します。応答には校舎名と同期人数だけを返し、
名簿本文は返しません。毎朝7時の自動同期は従来どおりCronから同じ処理を呼び出します。
