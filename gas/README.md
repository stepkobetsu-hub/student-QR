# 本番Apps Scriptバックアップ

非公開の本番Apps Scriptプロジェクトから `clasp` で取得し、不達メール管理機能を追加したソースです。具体的なプロジェクト識別子や本番URLは公開リポジトリへ記録しません。

## ファイル

- `コード.js`: 入退室・QR・Brevo送信の既存バックエンド
- `DeliveryFailures.js`: Brevo Transactional Webhookと不達メール管理
- `DeliveryHistory.js`: エラー当日・直前5回・過去全エラーの送信履歴取得
- `MyQrApi.js`: 塾生本人認証・期限付きセッション・本人QR取得
- `appsscript.json`: Apps Scriptマニフェスト

APIキー、Webhookトークン、スプレッドシートIDなどの実行時秘密値は、Apps Scriptのスクリプトプロパティで管理し、このリポジトリには保存しません。

## 必要なスクリプトプロパティ

- `BREVO_API_KEY`
- `CHECKIN_LOG_SS_ID`
- `BREVO_WEBHOOK_TOKEN`
- `BREVO_TEMP_ERROR_THRESHOLD`（既定値 `3`）
- `BREVO_TEMP_ERROR_WINDOW_DAYS`（既定値 `7`）
- `DELIVERY_FAILURE_REPORT_EMAILS`（不達報告先をJSON配列で最大4件。値は公開リポジトリへ記録しない）

不達メール管理画面の「報告メール設定」から、AK=2・3・4のスタッフが報告先を1〜4件に変更できます。Brevoから新しい不達イベントを受信したとき、重複判定後に登録先へ個別送信します。

デプロイ時は既存のWebアプリデプロイを更新し、URLを維持してください。

## Issue #2「自分のQR」本番

- 生徒認証: 既存の生徒認証APIを利用。認証列と保存先の具体値は非公開
- QR正本: 非公開の本番生徒マスタ
- セッション: 6時間。端末保存はランダムトークンと期限のみ。パスワードと生徒番号は保存しない
- 本人限定: `myQrGet` はクライアントの生徒番号を参照せず、サーバー側セッションに紐づく本人IDのみ使用
- Apps Script version: `18`
- デプロイ: 既存デプロイIDを維持（具体値は非公開の運用記録で管理）
- Web API: 非公開の本番プロジェクト（公開リポジトリには `/exec` URLを記載しない）
- 接続先の上書きが必要な場合は Script Properties の `MY_QR_STUDENT_AUTH_API_URL` と `MY_QR_STAFF_AUTH_API_URL` で管理
- 変更前バックアップ: 2026-08-01に `clasp pull` でversion 15相当のHead全5ファイルを取得後、別作業コピーからversion 18を反映

旧管理GETは、成績管理共通認証APIが発行したスタッフセッション（権限2・3・4）のサーバー側検証を必須とします。`student_qr_register.html` の既存UI・既存公開URLは維持します。
