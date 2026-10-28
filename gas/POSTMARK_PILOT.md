# Yahoo入退室通知のPostmark限定試験（導入前レビュー）

この差分は本番未適用・未送信です。Script Propertiesにトークンが存在するという利用者の報告はありますが、値や存在の実機検証は行っていません。

## 本番への適用条件

**本番Headをバックアップし、関数単位の差分だけを取り込んでください。リポジトリのコード.jsを丸ごと上書きしてはいけません。** 本番にはリポジトリにないDeliveryHistoryV2/EdgeRosterSync等が見えており、全量置換は機能を失う恐れがあります。既存doPostの順序、認証、送信キュー形式、Brevo Webhook、URLとデプロイIDを維持します。

適用する内容は、新規 `PostmarkPilot.js` と、コード.js の doPost / processCheckInMailQueueRow_ / updateCheckInRecipientDeliveryState_ / checkInMailErrorCode_ / sendCheckInEmail_ の小差分、DeliveryFailures.js の handleBrevoWebhook_ / updateDeliveryLogFromWebhook_ / getDeliveryEmailStopDecision_ / claimDeliveryEmailSendDecision_ の小差分です。

## 範囲と停止条件

- POSTMARK_PILOT_ENABLED が厳密に `true`、JSON allowlistに一致、Yahooの2ドメイン、生徒の入室・退室、受付時刻が開始日時以降の新規通知だけが対象です。
- Yahoo以外、講師出退勤、QR PDF等は既存経路。対象者の既存Brevo保留メールはこの試験で再送しません。
- 宛先ごとの写真、照合ID、送信サービス、Postmark MessageIDをキューに保存します。既存の「BrevoメッセージID」列名は互換維持し、Postmark IDには `postmark:` を付けます。
- 恒久不達・迷惑メール報告・手動停止は全サービス共通で維持。Brevo由来の自動一時停止のみPostmarkの新規通知を妨げません。
- 永続送信予約をHTTP要求より先に作成します。APIのタイムアウト、結果不明、明示拒否、予約後クラッシュは自動再送・自動Brevoフォールバックをせず、管理者確認へ回します。
- 予算超過はHTTP要求前なので、その新規通知に限りBrevoへ戻します。ただしBrevo側の停止判定を再確認します。
- 生涯予算は既定20試行、最大90試行。失敗・結果不明も消費し、月替わりでも自動リセットしません。Postmark側の他用途使用量をこの台帳では把握できないので、無料100通を全アカウントで保証するものではありません。開始時に管理画面の残通数を確認し、それ以下の予算にしてください。課金プラン変更は行いません。
- 結果不明の予約・使用カウンターを安易に削除/リセットしないでください。Postmark側で照合IDを検索し、受付済みか確認してから個別に処理します。

## Script Properties（秘密値をソース・チャット・ログへ貼らない）

|キー|値・用途|
|---|---|
|POSTMARK_SERVER_TOKEN|Postmark server token（既存保存値を使用）|
|POSTMARK_SERVER_ID|21178320|
|POSTMARK_WEBHOOK_TOKEN|独立した高エントロピー秘密値。32文字以上、64桁hex等|
|POSTMARK_PILOT_ENABLED|初期は `false`|
|POSTMARK_PILOT_ALLOWLIST|許可したYahoo宛先だけのJSON配列。初期 `[]`|
|POSTMARK_PILOT_STARTED_AT|試験開始直前のISO日時。過去へ遡らせない|
|POSTMARK_PILOT_MAX_ATTEMPTS|初期 `20`、残通数に応じて1～90|
|POSTMARK_PILOT_WEBHOOK_READY|初期 `false`。認証付き配信/不達Webhook検証後のみ `true`|

使用カウンターPOSTMARK_PILOT_ATTEMPTS_USEDとPOSTMARK_PILOT_SEND_...は自動管理です。

## 導入・検証順

1. 本番Head全ファイル、既存デプロイバージョン、トリガー一覧を秘密値なしでバックアップ。トークンを公開GitHubへ書かない。
2. 上記関数差分と新規モジュールを取り込み、無効のまま `postmarkPilotHealth()` を実行。秘密値や宛先を返さず、存在フラグと件数だけ確認できます。
3. POSTMARK_SERVER_ID設定後に `verifyPostmarkPilotServer()` を実行。GET /server の応答にはApiTokensが含まれるため、関数は応答をログ出力せず、serverMatches/liveだけ返します。Liveはサーバー種別を示し、アカウント送信承認やDNS認証の代替確認ではありません。
4. 既存WebアプリURLを維持して新版をデプロイする前に、別のステージングで認証・キュー・写真添付・対象外Brevoルートを検証する。
5. Postmark outboundストリームにDelivery / Bounce / SpamComplaintのWebhookを設定。URLは既存GAS /exec に `postmarkWebhookToken=<独立秘密値>` を付けたもの。Brevoトークンと使い回さない。秘密URLは公開文書に保存しない。本文のIncludeContentはオフ。
6. 正しいtoken＋server ID＋outbound＋既存Postmark MessageID＋recipientが一致したイベントだけ処理されること、誤token/他宛先/別serverを拒否することをステージングで検証する。
7. GAS ContentServiceは任意のHTTPステータスを返せないため、Postmarkが再試行せずイベントを取りこぼす場合があります。`reconcilePostmarkPilotDeliveries()` を手動確認し、`setupPostmarkPilotReconciliation()` で5分おきの補完トリガーを作成。補完は既存Postmark送信のGET照会と配信済み反映だけで、送信・再送を行いません。不達/Spamイベントの取りこぼしはPostmark管理画面でも確認が必要です。
8. allowlistをまず少数にし、開始日時を現在時刻に設定。Webhook検証済みフラグをtrue、最後にPILOT_ENABLEDをtrue。将来の新しい打刻だけで比較し、過去の保留メールは再送しません。
9. 受付数・配信完了数・受付から配信までの時間・未確定数をBrevoと比較。配信完了は受信側メールサーバーの受付で、保護者の既読保証ではありません。

## ロールバック

POSTMARK_PILOT_ENABLEDをfalseにすると、以後の新規通知は既存Brevo経路へ戻ります。Postmark受付済みや結果不明のキューを手動でPENDINGへ戻さないでください。二重送信防止の永続予約と補完処理は維持します。本番Headを丸ごと過去へ戻さず、他の変更との関係を確認してください。

## 自動試験

`node --test tests/postmark-pilot.test.mjs`：実送信なしのモック試験。

対象：既定無効、厳密ドメイン/allowlist/開始日/生徒種別、設定不足、写真/Metadata、永続予約、既存lock保持、結果不明時の再送禁止、予算、診断モード、予算時のみBrevo移行、恒久/手動停止維持、Webhook認証とレコード照合、順序逆転、秘密値非公開、GET /server、GET配信補完。

既存全体テストには変更前から19件の失敗があります。ベース103件=84成功/19失敗に対し、差分適用時118件=99成功/同じ19失敗。今回追加分と関連の通過対象46件は成功しています（本番動作の証明ではありません）。

## 公式仕様

- https://postmarkapp.com/developer/api/email-api
- https://postmarkapp.com/developer/api/server-api
- https://postmarkapp.com/developer/api/messages-api
- https://postmarkapp.com/developer/webhooks/delivery-webhook
- https://postmarkapp.com/developer/webhooks/bounce-webhook
- https://postmarkapp.com/developer/webhooks/webhooks-overview
