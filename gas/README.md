# 本番Apps Scriptバックアップ

プロジェクトID `1ZFzVbJM15igFE7InsX1fu-FlNrYUY45vviozJP0k1uVXy_HvmGfseZ22` から `clasp` で取得し、不達メール管理機能を追加したソースです。

## ファイル

- `コード.js`: 入退室・QR・Brevo送信の既存バックエンド
- `DeliveryFailures.js`: Brevo Transactional Webhookと不達メール管理
- `appsscript.json`: Apps Scriptマニフェスト

APIキー、Webhookトークン、スプレッドシートIDなどの実行時秘密値は、Apps Scriptのスクリプトプロパティで管理し、このリポジトリには保存しません。

## 必要なスクリプトプロパティ

- `BREVO_API_KEY`
- `CHECKIN_LOG_SS_ID`
- `BREVO_WEBHOOK_TOKEN`
- `BREVO_TEMP_ERROR_THRESHOLD`（既定値 `3`）
- `BREVO_TEMP_ERROR_WINDOW_DAYS`（既定値 `7`）

デプロイ時は既存のWebアプリデプロイを更新し、URLを維持してください。
