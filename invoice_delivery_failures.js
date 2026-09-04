(function(){
  'use strict';

  const INVOICE_API='https://step-invoice-api.stepkobetsu.workers.dev/api/app/delivery-failures?limit=200';
  const INVOICE_APP='https://stepkobetsu-hub.github.io/invoice-pdf/#invoices';
  const PORTAL_AUTH_API='https://script.google.com/macros/s/AKfycbypkUc0MqZ07E7pZRglNPeRM56WbCcuWaLpRzi9bVFcPklHDxaaLC7GfzG6ozTGCbEX/exec';
  const AUTH_KEY='stepStaffAppAuth';
  const INVOICE_SOURCE='INVOICE_PDF';
  let invoiceFailures=[];
  let lastError='';
  let loading=false;

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const text=id=>String(document.getElementById(id)?.value||'').trim();
  const checked=id=>Boolean(document.getElementById(id)?.checked);

  function readJsonStorage(storage,key){
    try{return JSON.parse(storage.getItem(key)||'null')}catch(_){return null}
  }

  function savedCredentials(){
    const saved=readJsonStorage(localStorage,'deliveryFailuresSavedLogin')||{};
    const code=String(saved.code||localStorage.getItem('stepStaffAppCode')||'').trim();
    const password=String(saved.password||localStorage.getItem('stepStaffAppPassword')||sessionStorage.getItem('deliveryFailuresPassword')||'');
    return {code,password};
  }

  function currentToken(){
    const auth=readJsonStorage(localStorage,AUTH_KEY)||{};
    return String(auth.systemPortalSessionToken||'').trim();
  }

  async function createCommonSession(){
    const existing=readJsonStorage(localStorage,AUTH_KEY)||{};
    if(existing.systemPortalSessionToken)return String(existing.systemPortalSessionToken);
    const {code,password}=savedCredentials();
    if(!code||!password)throw new Error('請求書の不達情報を確認するための共通スタッフ認証を作成できません。いったんこの画面で再ログインしてください。');
    const response=await fetch(PORTAL_AUTH_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'staffLogin',code,password}),redirect:'follow'});
    const result=await response.json().catch(()=>null);
    if(!response.ok||!(result?.success||result?.ok)||!result?.systemPortalSessionToken)throw new Error(String(result?.error||result?.message||'共通スタッフ認証に失敗しました。'));
    if(!['2','3','4'].includes(String(result.permissionLevel||'')))throw new Error('請求書の不達情報を表示する権限がありません。');
    localStorage.setItem(AUTH_KEY,JSON.stringify({...existing,code,name:result.name||existing.name||'',permissionLevel:String(result.permissionLevel||''),systemPortalSessionToken:result.systemPortalSessionToken,systemPortalExpiresAt:result.systemPortalExpiresAt||'',savedAt:new Date().toISOString()}));
    return String(result.systemPortalSessionToken);
  }

  async function fetchInvoiceFailures(retry=true){
    let token=currentToken();
    if(!token)token=await createCommonSession();
    const response=await fetch(INVOICE_API,{headers:{Authorization:`Bearer ${token}`,'Accept':'application/json'}});
    if(response.status===401&&retry){
      const old=readJsonStorage(localStorage,AUTH_KEY)||{};
      delete old.systemPortalSessionToken;
      delete old.systemPortalExpiresAt;
      localStorage.setItem(AUTH_KEY,JSON.stringify(old));
      await createCommonSession();
      return fetchInvoiceFailures(false);
    }
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result?.ok)throw new Error(String(result?.error||`請求書API ${response.status}`));
    return Array.isArray(result.data?.failures)?result.data.failures:[];
  }

  function formatDate(value){
    if(!value)return '―';
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return String(value);
    return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date);
  }

  function statusText(item){
    if(item.downloadedAt)return 'PDF閲覧済み';
    if(item.firstOpenedAt)return 'URL閲覧済み';
    if(item.deliveryStatus==='opened')return 'URL閲覧済み';
    if(item.deliveryStatus==='downloaded')return 'PDF閲覧済み';
    return '送付済み';
  }

  function filteredFailures(){
    const source=text('source');
    if(source&&source!==INVOICE_SOURCE)return [];
    const email=text('email').toLowerCase(),student=text('student').toLowerCase(),school=text('school').toLowerCase(),event=text('event'),state=text('state'),confirm=text('confirmStatus');
    if(confirm==='確認済み')return [];
    return invoiceFailures.filter(item=>{
      if(email&&!String(item.email||'').toLowerCase().includes(email))return false;
      if(student&&!`${item.customerCode||''} ${item.partnerName||''}`.toLowerCase().includes(student))return false;
      if(school&&!String(item.school||'').toLowerCase().includes(school))return false;
      if(event&&String(item.event||'')!==event)return false;
      if(state&&String(item.state||'')!==state)return false;
      if(checked('stopped')&&!item.deliverySuspended)return false;
      return true;
    });
  }

  function ensureStyles(){
    if(document.getElementById('invoiceFailureCentralStyle'))return;
    const style=document.createElement('style');
    style.id='invoiceFailureCentralStyle';
    style.textContent=`
      #invoiceFailureCentral{border:1px solid #b8d3f5;background:#fbfdff}
      #invoiceFailureCentral .invoiceFailureHead{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
      #invoiceFailureCentral h2{margin:0;color:#18314d;font-size:1.12rem}
      #invoiceFailureCentral .invoiceFailureIntro{color:#536174;line-height:1.65;margin:6px 0 0}
      #invoiceFailureCentral .invoiceFailureCount{display:inline-block;background:#fde8e7;color:#b42318;border-radius:999px;padding:4px 10px;font-weight:900}
      #invoiceFailureCentral .invoiceFailureOk{background:#e8f5ec;color:#157347;padding:12px;border-radius:10px;font-weight:800;margin-top:12px}
      #invoiceFailureCentral .invoiceFailureError{background:#fff0f0;color:#a00;padding:12px;border-radius:10px;margin-top:12px}
      #invoiceFailureCentral .invoiceFailureRows{display:grid;gap:10px;margin-top:12px}
      #invoiceFailureCentral .invoiceFailureRow{border:1px solid #d9e3ee;border-left:5px solid #b42318;border-radius:12px;padding:12px;background:#fff}
      #invoiceFailureCentral .invoiceFailureTop{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
      #invoiceFailureCentral .invoiceFailureEmail{font-weight:900;overflow-wrap:anywhere}
      #invoiceFailureCentral .invoiceFailureState{display:inline-block;padding:4px 9px;border-radius:999px;background:#fde8e7;color:#b42318;font-weight:900}
      #invoiceFailureCentral .invoiceFailureMeta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}
      #invoiceFailureCentral .invoiceFailureMeta div{background:#f4f7fb;border-radius:9px;padding:8px;min-width:0;overflow-wrap:anywhere}
      #invoiceFailureCentral .invoiceFailureMeta small{display:block;color:#687588;margin-bottom:3px}
      #invoiceFailureCentral .invoiceFailureActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      #invoiceFailureCentral .invoiceFailureNote{margin-top:12px;padding:10px 12px;border-left:4px solid #d58b00;background:#fff8e6;line-height:1.6}
      @media(max-width:760px){#invoiceFailureCentral .invoiceFailureMeta{grid-template-columns:1fr 1fr}}
    `;
    document.head.appendChild(style);
  }

  function ensureUi(){
    const source=document.getElementById('source');
    if(source&&!source.querySelector(`option[value="${INVOICE_SOURCE}"]`)){
      const option=document.createElement('option');
      option.value=INVOICE_SOURCE;option.textContent='請求書';source.appendChild(option);
    }
    if(document.getElementById('invoiceFailureCentral'))return;
    const table=document.querySelector('#app .tableWrap');
    if(!table)return;
    const section=document.createElement('section');
    section.id='invoiceFailureCentral';
    section.className='card';
    section.innerHTML=`<div class="invoiceFailureHead"><div><h2>請求書メールの不達</h2><p class="invoiceFailureIntro">請求書システムの送信結果から、対応が必要な不達だけを表示します。通常の「送付済み・開封・PDF閲覧済み」は請求書システム側に残します。</p></div><span id="invoiceFailureCount" class="invoiceFailureCount">0件</span></div><div id="invoiceFailureBody"></div><div class="invoiceFailureNote">送信元：<strong>admin@educrest.jp</strong> ／ 返信先：stepkobetsu@gmail.com。未開封だけでは不達扱いにしません。</div>`;
    table.parentNode.insertBefore(section,table);
  }

  function syncExistingVisibility(){
    const source=text('source');
    const invoiceOnly=source===INVOICE_SOURCE;
    document.querySelector('#app .tableWrap')?.classList.toggle('hidden',invoiceOnly);
    document.getElementById('cards')?.classList.toggle('hidden',invoiceOnly);
    document.getElementById('invoiceFailureCentral')?.classList.toggle('hidden',Boolean(source&&source!==INVOICE_SOURCE));
  }

  function renderInvoiceFailures(){
    ensureUi();syncExistingVisibility();
    const count=document.getElementById('invoiceFailureCount'),body=document.getElementById('invoiceFailureBody');
    if(!count||!body)return;
    const rows=filteredFailures();
    count.textContent=`${rows.length}件`;
    if(loading){body.innerHTML='<div class="msg">請求書の不達情報を確認しています…</div>';return;}
    if(lastError){body.innerHTML=`<div class="invoiceFailureError">請求書の不達情報を取得できませんでした：${esc(lastError)}<br><button class="btn" type="button" id="retryInvoiceFailures">再読込</button></div>`;document.getElementById('retryInvoiceFailures')?.addEventListener('click',()=>refreshInvoiceFailures(true));return;}
    if(!rows.length){body.innerHTML='<div class="invoiceFailureOk">現在、条件に該当する請求書メールの不達はありません。</div>';return;}
    body.innerHTML=`<div class="invoiceFailureRows">${rows.map(item=>`<article class="invoiceFailureRow"><div class="invoiceFailureTop"><div><div class="invoiceFailureEmail">${esc(item.email)}</div><div>${esc(item.customerCode)}　${esc(item.partnerName)}</div></div><span class="invoiceFailureState">${esc(item.state)}</span></div><div class="invoiceFailureMeta"><div><small>発生日時</small>${esc(formatDate(item.occurredAt))}</div><div><small>請求書番号</small>${esc(item.invoiceNumber||'―')}</div><div><small>送信状況</small>${esc(statusText(item))}</div><div><small>イベント</small>${esc(item.event||'―')}</div><div><small>校舎</small>${esc(item.school||'―')}</div><div><small>対象月</small>${esc(item.subjectMonth||'―')}</div><div><small>再送回数</small>${esc(item.resendCount||0)}回</div><div><small>PDF</small>${item.downloadedAt?esc(formatDate(item.downloadedAt)):'未閲覧'}</div></div><div class="invoiceFailureActions"><a class="btn primary" href="${INVOICE_APP}" target="_blank" rel="noopener noreferrer">請求書システムで確認・再送</a></div></article>`).join('')}</div>`;
  }

  async function refreshInvoiceFailures(force=false){
    if(loading&&!force)return;
    loading=true;lastError='';renderInvoiceFailures();
    try{invoiceFailures=await fetchInvoiceFailures();}
    catch(error){invoiceFailures=[];lastError=String(error?.message||error);}
    finally{loading=false;renderInvoiceFailures();}
  }

  function installHooks(){
    ensureStyles();ensureUi();renderInvoiceFailures();
    ['email','student','school','event','state','confirmStatus','unconfirmed','stopped','includeArchived'].forEach(id=>{
      const element=document.getElementById(id);if(!element)return;
      element.addEventListener(element.tagName==='INPUT'&&element.type!=='checkbox'?'input':'change',renderInvoiceFailures);
    });
    document.getElementById('source')?.addEventListener('change',()=>{syncExistingVisibility();renderInvoiceFailures();if(!invoiceFailures.length&&!loading)void refreshInvoiceFailures();});
    const original=window.loadItems;
    if(typeof original==='function')window.loadItems=async function(){const result=await original.apply(this,arguments);await refreshInvoiceFailures();return result;};
    const app=document.getElementById('app');
    if(app){new MutationObserver(()=>{if(!app.classList.contains('hidden'))void refreshInvoiceFailures();}).observe(app,{attributes:true,attributeFilter:['class']});if(!app.classList.contains('hidden'))void refreshInvoiceFailures();}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installHooks);else installHooks();
})();
