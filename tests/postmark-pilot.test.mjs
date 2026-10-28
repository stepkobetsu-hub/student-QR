import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import crypto from 'node:crypto';
const source = fs.readFileSync(new URL('../gas/PostmarkPilot.js', import.meta.url), 'utf8');
const backend = fs.readFileSync(new URL('../gas/コード.js', import.meta.url), 'utf8');
const failures = fs.readFileSync(new URL('../gas/DeliveryFailures.js', import.meta.url), 'utf8');
const uuid = '11111111-2222-3333-4444-555555555555';
function context(overrides = {}) {
  const properties = new Map(Object.entries({ POSTMARK_PILOT_ENABLED:'true', POSTMARK_PILOT_STARTED_AT:'2026-10-28T00:00:00Z', POSTMARK_PILOT_ALLOWLIST:'["test@yahoo.co.jp"]', POSTMARK_SERVER_TOKEN:'fake-test-token', POSTMARK_WEBHOOK_TOKEN:'x'.repeat(40), POSTMARK_PILOT_WEBHOOK_READY:'true', POSTMARK_SERVER_ID:'21178320', ...overrides }));
  let locked = false;
  const calls = [];
  const ctx = { Date, Number, PropertiesService:{ getScriptProperties:() => ({getProperty:k => properties.get(k) ?? null, setProperty:(k,v) => properties.set(k,v)}) }, LockService:{getScriptLock:() => ({hasLock:() => locked, tryLock:() => {locked=true;return true;}, waitLock:() => {locked=true;},releaseLock:() => {locked=false;}})}, Utilities:{getUuid:() => uuid, formatDate:() => '10月28日18時00分'}, Session:{getScriptTimeZone:()=>'Asia/Tokyo'}, UrlFetchApp:{fetch:(url,options) => {calls.push({url,options});return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({ErrorCode:0,MessageID:uuid})};}}, console };
  vm.createContext(ctx); vm.runInContext(failures,ctx); vm.runInContext(backend,ctx);vm.runInContext(source,ctx);
  ctx.shortCheckInHash_ = value => crypto.createHash('sha256').update(value).digest('hex').slice(0,22);
  ctx.getCheckInFromEmail_ = () => 'sender@example.invalid';
  return {ctx, properties, calls, setLocked:v=>{locked=v;}, isLocked:()=>locked};
}
const when = new Date('2026-10-28T10:00:00Z');
test('disabled by default; exact Yahoo allowlist, attendance type and activation cutoff are all mandatory',()=>{
 const {ctx,properties}=context();properties.delete('POSTMARK_PILOT_ENABLED');assert.equal(ctx.postmarkPilotEligible_('test@yahoo.co.jp','入室',when),false);properties.set('POSTMARK_PILOT_ENABLED','true');
 assert.equal(ctx.postmarkPilotEligible_('TEST@YAHOO.CO.JP','入室',when),true);
 for(const email of ['other@yahoo.co.jp','test@yahoo.co.jp.evil.invalid','test@gmail.com'])assert.equal(ctx.postmarkPilotEligible_(email,'入室',when),false);
 assert.equal(ctx.postmarkPilotEligible_('test@yahoo.co.jp','出勤',when),false);assert.equal(ctx.postmarkPilotEligible_('test@yahoo.co.jp','入室',new Date('2026-10-27')),false);
 properties.set('POSTMARK_PILOT_ALLOWLIST','not-json');assert.equal(ctx.postmarkPilotEligible_('test@yahoo.co.jp','入室',when),false);
});
test('missing webhook readiness or token fails closed without a network request',()=>{const {ctx,calls}=context({POSTMARK_PILOT_WEBHOOK_READY:'false'});assert.equal(ctx.sendEmailViaPostmarkPilot_('test@yahoo.co.jp','title','body',{correlationId:'r1'}).errorCode,'POSTMARK_CONFIG_INCOMPLETE');assert.equal(calls.length,0);});
test('photo and correlation metadata survive, secret stays only in HTTP header, replay never resends',()=>{
 const {ctx,calls}=context();const options={correlationId:'receipt-1',attachmentBase64:'YWJj',attachmentName:'photo.jpg'};
 const result=ctx.sendEmailViaPostmarkPilot_('test@yahoo.co.jp','通知','a<br>b',options);assert.equal(result.provider,'POSTMARK');assert.equal(result.messageId,'postmark:'+uuid);
 const payload=JSON.parse(calls[0].options.payload);assert.equal(payload.Attachments[0].Content,'YWJj');assert.equal(payload.Metadata.correlation_id,'receipt-1');assert.equal(payload.MessageStream,'outbound');assert.equal(payload.TextBody,'a\nb');assert.equal(JSON.stringify(result).includes('fake-test-token'),false);
 assert.equal(ctx.sendEmailViaPostmarkPilot_('test@yahoo.co.jp','通知','body',options).replayed,true);assert.equal(calls.length,1);
});
test('existing script lock stays held when ledger reservation runs under queue worker',()=>{const {ctx,setLocked,isLocked}=context();setLocked(true);assert.ok(ctx.reservePostmarkPilotAttempt_('r1','test@yahoo.co.jp').key);assert.equal(isLocked(),true);});
test('timeout and explicit rejection remain reserved; retries cannot produce another email',()=>{
 for (const timeout of [true,false]) {const {ctx,calls,properties}=context();ctx.UrlFetchApp.fetch=(url,options)=>{calls.push({url,options});if(timeout)throw new Error('timeout');return {getResponseCode:()=>422,getContentText:()=>'{"ErrorCode":300}'};};
 const first=ctx.sendEmailViaPostmarkPilot_('test@yahoo.co.jp','title','body',{correlationId:'r1'});assert.equal(first.accepted,false);assert.equal(first.retrySafe,false);assert.equal(ctx.sendEmailViaPostmarkPilot_('test@yahoo.co.jp','title','body',{correlationId:'r1'}).errorCode,'POSTMARK_DELIVERY_UNCERTAIN');assert.equal(calls.length,1);assert.equal(properties.get('POSTMARK_PILOT_ATTEMPTS_USED'),'1');}
});
test('attempt budget is lifetime, bounded below 100, and rejected before any request',()=>{
 const {ctx,calls,properties}=context({POSTMARK_PILOT_MAX_ATTEMPTS:'1'});ctx.sendEmailViaPostmarkPilot_('test@yahoo.co.jp','title','body',{correlationId:'r1'});assert.equal(ctx.sendEmailViaPostmarkPilot_('test@yahoo.co.jp','title','body',{correlationId:'r2'}).errorCode,'POSTMARK_PILOT_BUDGET_EXHAUSTED');assert.equal(calls.length,1);
 properties.set('POSTMARK_PILOT_MAX_ATTEMPTS','100');assert.equal(ctx.reservePostmarkPilotAttempt_('r3','test@yahoo.co.jp').error,'POSTMARK_BUDGET_INVALID');
});
test('diagnostic mode never sends even with pilot enabled',()=>{const {ctx,calls,properties}=context({CHECKIN_MAIL_DIAGNOSTIC_MODE:'TRUE'});assert.equal(ctx.sendEmailViaPostmarkPilot_('test@yahoo.co.jp','title','body',{correlationId:'r1'}).provider,'DIAGNOSTIC');assert.equal(calls.length,0);assert.equal(properties.has('POSTMARK_PILOT_ATTEMPTS_USED'),false);});
test('budget-only fallback uses Brevo for a new notification; ambiguous failure cannot fall back',()=>{
 const {ctx}=context();let brevo=0;ctx.sendEmailViaBrevo=()=>{brevo++;return {accepted:true,provider:'BREVO'};};ctx.claimDeliveryEmailSendDecision_=()=>({stopped:false});
 ctx.sendEmailViaPostmarkPilot_=()=>({errorCode:'POSTMARK_PILOT_BUDGET_EXHAUSTED'});assert.equal(ctx.sendCheckInEmail_('test','test@yahoo.co.jp','','入室',when,'r1').provider,'BREVO');assert.equal(brevo,1);
 ctx.sendEmailViaPostmarkPilot_=()=>({errorCode:'POSTMARK_DELIVERY_UNCERTAIN',provider:'POSTMARK'});assert.equal(ctx.sendCheckInEmail_('test','test@yahoo.co.jp','','入室',when,'r2').provider,'POSTMARK');assert.equal(brevo,1);
});
test('Brevo temporary stops do not suppress Postmark, manual and permanent stops still do',()=>{
 const {ctx}=context();let rows=[];ctx.getDeliveryFailureSheet_=()=>({getLastRow:()=>rows.length+1,getRange:()=>({getValues:()=>rows})});
 function stop(event,state='一時エラー',id='brevo-id'){const row=Array(42).fill('');row[4]='test@yahoo.co.jp';row[5]=event;row[6]=state;row[7]=id;row[19]=true;row[2]=new Date();return row;}
 rows=[stop('deferred')];assert.equal(ctx.claimDeliveryEmailSendDecision_('test@yahoo.co.jp','POSTMARK').stopped,false);assert.equal(ctx.claimDeliveryEmailSendDecision_('test@yahoo.co.jp').stopped,true);
 rows=[stop('hard_bounce')];assert.equal(ctx.claimDeliveryEmailSendDecision_('test@yahoo.co.jp','POSTMARK').kind,'permanent');rows=[stop('deferred','手動停止')];assert.equal(ctx.claimDeliveryEmailSendDecision_('test@yahoo.co.jp','POSTMARK').kind,'manual');
 rows=[stop('soft_bounce','一時エラー','postmark:'+uuid)];assert.equal(ctx.claimDeliveryEmailSendDecision_('test@yahoo.co.jp','POSTMARK').stopped,true);
});
function webhookFixture() {
 const base=context();const {ctx}=base;const recipient={email:'test@yahoo.co.jp',provider:'POSTMARK',messageId:'postmark:'+uuid,correlationId:'r1',status:'SENT'};
 const record={headers:['受付ID'],values:['r1']};let updates=0,failures=0;
 ctx.findDeliveryLogRecord_=()=>record;ctx.getCheckInMailQueueSheet_=()=>({getLastRow:()=>2,getRange:(row,col)=>({createTextFinder:()=>({matchEntireCell:()=>({findNext:()=>({getRow:()=>2})})}),getValue:()=>JSON.stringify([recipient])})});
 ctx.deliveryHash_=x=>x;ctx.deliveryDedupeExists_=()=>false;ctx.updateDeliveryLogFromWebhook_=()=>{updates++;};ctx.updateDeliveredFailureRecords_=()=>{};ctx.findStudentsByDeliveryEmail_=()=>[];ctx.shouldStopForTemporaryErrors_=()=>false;ctx.appendDeliveryFailure_=()=>{failures++;return {};};ctx.notifyDeliveryFailureAdministratorSafely_=()=>{};ctx.notifyDeliveryFailureLineSafely_=()=>{};
 const e={parameter:{postmarkWebhookToken:'x'.repeat(40)}};const body={RecordType:'Delivery',MessageID:uuid,Recipient:'test@yahoo.co.jp',DeliveredAt:'2026-10-28T10:01:00Z',ServerID:21178320,MessageStream:'outbound'};
 return {...base,recipient,e,body,updates:()=>updates,failures:()=>failures};
}
test('webhook checks token, server, stream, provider, recipient and message id before updating',()=>{
 const f=webhookFixture();assert.equal(f.ctx.handlePostmarkWebhookRequest_({},f.body).code,'POSTMARK_WEBHOOK_UNAUTHORIZED');assert.equal(f.ctx.handlePostmarkWebhookRequest_(f.e,{...f.body,ServerID:1}).code,'POSTMARK_WEBHOOK_SCOPE_INVALID');assert.equal(f.ctx.handlePostmarkWebhookRequest_(f.e,{...f.body,Recipient:'other@yahoo.co.jp'}).code,'POSTMARK_RECIPIENT_MISMATCH');assert.equal(f.updates(),0);
 assert.equal(f.ctx.handlePostmarkWebhookRequest_(f.e,f.body).delivered,true);assert.equal(f.updates(),1);f.recipient.provider='BREVO';assert.equal(f.ctx.handlePostmarkWebhookRequest_(f.e,f.body).code,'POSTMARK_RECIPIENT_MISMATCH');
});
test('hard bounce/spam preserve permanent suppression; late temporary event cannot regress delivery',()=>{
 const f=webhookFixture();let stopped;f.ctx.appendDeliveryFailure_=(a,b,c,d,e,g,h)=>{stopped=h;return {};};assert.equal(f.ctx.handlePostmarkWebhookRequest_(f.e,{...f.body,RecordType:'Bounce',Email:'test@yahoo.co.jp',BouncedAt:f.body.DeliveredAt,Type:'HardBounce'}).stopped,true);assert.equal(stopped,true);
 f.recipient.deliveryEvent='delivered';f.recipient.deliveryEventAt='2026-10-28T10:02:00Z';assert.equal(f.ctx.handlePostmarkWebhookRequest_(f.e,{...f.body,RecordType:'Bounce',BouncedAt:'2026-10-28T10:00:00Z',Type:'Transient'}).ignored,true);assert.equal(f.updates(),1);
});
test('health output contains readiness only, not secrets or allowlisted addresses',()=>{const {ctx}=context();const output=JSON.stringify(ctx.postmarkPilotHealth());assert.equal(output.includes('fake-test-token'),false);assert.equal(output.includes('test@yahoo'),false);});
test('delivery ordering does not regress successful recipient and rejects older terminal events',()=>{const {ctx}=context();assert.equal(ctx.shouldApplyDeliveryEvent_('delivered','2026-10-28T10:00:00Z','deferred',new Date('2026-10-28T11:00:00Z')),false);assert.equal(ctx.shouldApplyDeliveryEvent_('spam','2026-10-28T11:00:00Z','delivered',new Date('2026-10-28T10:00:00Z')),false);});
test('server verification returns booleans without leaking ApiTokens, hook URLs, or raw errors',()=>{const {ctx,calls}=context();ctx.UrlFetchApp.fetch=(url,options)=>{calls.push({url,options});return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({ID:21178320,DeliveryType:'Live',ApiTokens:['sensitive'],DeliveryHookUrl:'https://private.invalid/?token=secret'})};};const result=ctx.verifyPostmarkPilotServer();assert.equal(result.ok,true);assert.equal(calls[0].url,'https://api.postmarkapp.com/server');assert.equal(calls[0].options.method,'get');assert.equal(/sensitive|private|secret/.test(JSON.stringify(result)),false);});
test('reconciliation only GETs accepted Postmark messages and uses matching Delivered events, never Sent status',()=>{const {ctx,calls}=context();const row=Array(17).fill('');row[10]=JSON.stringify([{provider:'POSTMARK',messageId:'postmark:'+uuid,email:'test@yahoo.co.jp'}]);ctx.getCheckInMailQueueSheet_=()=>({getLastRow:()=>2,getRange:()=>({getValues:()=>[row]})});let updated=0;ctx.findDeliveryLogRecord_=()=>({});ctx.updateDeliveryLogFromWebhook_=()=>updated++;ctx.updateDeliveredFailureRecords_=()=>{};ctx.UrlFetchApp.fetch=(url,options)=>{calls.push({url,options});return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({MessageID:uuid,MessageStream:'outbound',Sandboxed:false,Status:'Sent',MessageEvents:[{Type:'Delivered',Recipient:'wrong@yahoo.co.jp',ReceivedAt:'2026-10-28T11:00:00Z'}]})};};assert.equal(ctx.reconcilePostmarkPilotDeliveries().delivered,0);assert.equal(updated,0);assert.equal(calls[0].options.method,'get');assert.match(calls[0].url,/messages\/outbound\/.+\/details$/);});
