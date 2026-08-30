from pathlib import Path

old_sidebar = '.page-shell{display:grid;grid-template-columns:228px minmax(0,1fr);gap:24px;align-items:start}.side-menu{background:#fff;border:1px solid var(--border);border-radius:14px;padding:12px;box-shadow:0 5px 18px rgba(31,65,49,.06)}.side-menu a{display:block;text-decoration:none;color:var(--main);font-weight:700;background:#eef5f1;border:1px solid #d7e2dc;border-radius:8px;padding:14px;margin-bottom:10px;line-height:1.35}.side-menu a:last-child{margin-bottom:0}.side-menu a.active{background:var(--main);color:#fff}.content-main{min-width:0}'
new_sidebar = '.page-shell{display:grid;grid-template-columns:220px minmax(0,1fr);gap:22px;align-items:start}.side-menu{position:sticky;top:24px;align-self:start;background:#fff;border:1px solid var(--border);border-radius:14px;padding:12px;box-shadow:0 5px 18px rgba(31,65,49,.06)}.side-menu a{display:block;text-decoration:none;color:var(--main);font-size:14px;font-weight:700;background:#eef6f1;border:1px solid var(--border);border-radius:8px;padding:13px 14px;margin-bottom:8px;line-height:1.35}.side-menu a:last-child{margin-bottom:0}.side-menu a.active{background:var(--main);color:#fff}.content-main{min-width:0}'

# Student create page
p = Path('student_qr_create.html')
s = p.read_text(encoding='utf-8')
s = s.replace('.wrap{max-width:1000px;margin:auto}', '.wrap{max-width:1280px;margin:auto}')
s = s.replace(old_sidebar, new_sidebar)
s = s.replace('.qr-mail-box{display:none;margin-top:14px;padding:14px 16px;border:1px solid #d8e0dc;border-radius:10px;background:#fafcfb;text-align:left}', '.qr-mail-box{display:none;margin-top:14px;padding-top:14px;border-top:1px solid #cbdde8;background:transparent;text-align:left}')
old_status = '<div id="status" class="status"><div id="statusTitle" class="status-title"></div><div id="statusDetail" class="status-detail"></div><div id="contacts" class="contacts"></div></div>'
new_status = '<div id="status" class="status"><div id="statusTitle" class="status-title"></div><div id="statusDetail" class="status-detail"></div><div id="contacts" class="contacts" style="display:none"></div><div id="qrMailBox" class="qr-mail-box"><div class="qr-mail-title">登録済みの通知先メールアドレス</div><div id="qrNotifyEmails" class="qr-mail-list"></div><div class="qr-actions"><a class="qr-mail-link" href="student_qr_register.html#email">メールアドレス登録・変更</a></div></div></div>'
if old_status in s:
    s = s.replace(old_status, new_status)
old_mail = '<div id="qrMailBox" class="qr-mail-box"><div class="qr-mail-title">登録済みの通知先メールアドレス</div><div id="qrNotifyEmails" class="qr-mail-list"></div><div class="qr-actions"><button id="print" class="print">QRコード印刷</button><a class="qr-mail-link" href="student_qr_register.html#email">メールアドレス登録・変更</a></div></div>'
if old_mail in s:
    s = s.replace(old_mail, '<div class="qr-actions"><button id="print" class="print">QRコード印刷</button></div>')
s = s.replace("$('contacts').textContent=a.length?'登録済みの連絡先：'+a.join(' ／ '):'登録済みの連絡先：なし';renderQrNotifyEmails(c)", "renderQrNotifyEmails(c)")
s = s.replace("$('contacts').textContent='登録済みの連絡先：確認中...'", "$('contacts').textContent=''", 1)
p.write_text(s, encoding='utf-8')

# Teacher create page layout
p = Path('teacher_qr_create.html')
s = p.read_text(encoding='utf-8')
s = s.replace('.wrap{max-width:1000px;margin:auto}', '.wrap{max-width:1280px;margin:auto}')
s = s.replace(old_sidebar, new_sidebar)
p.write_text(s, encoding='utf-8')

# Main register page
p = Path('student_qr_register.html')
s = p.read_text(encoding='utf-8')
css_marker = '</style>\n\n<style id="hide-duplicate-email-selection-ui">'
extra_css = '''  .check-qr-status-email { margin-top:14px; padding-top:14px; border-top:1px solid rgba(23,105,170,.22); }
  .check-qr-status-email-title { margin-bottom:7px; color:#555; font-size:13px; font-weight:800; }
  .check-qr-status-email-list { color:#234b3b; font-size:14px; line-height:1.8; word-break:break-all; }
  .check-qr-status-email-list .empty { color:#d93025; font-size:18px; font-weight:900; }
  .check-qr-status-email-link { display:inline-flex; min-height:44px; margin-top:10px; padding:10px 16px; align-items:center; justify-content:center; border-radius:8px; background:var(--main-color); color:#fff; font-size:14px; font-weight:800; text-decoration:none; }
'''
if 'check-qr-status-email-title' not in s and css_marker in s:
    s = s.replace(css_marker, extra_css + '</style>\n\n<style id="hide-duplicate-email-selection-ui">')
target = '    <div class="panel-secondary" style="margin-top:24px;">\n    <button id="checkLoadQrBtn" onclick="loadSelectedQrCards()" disabled>選択したQRを表示する</button>'
status_html = '''    <div class="panel-secondary" style="margin-top:24px;">
    <div id="checkQrStatusBox" class="new-qr-status has-current" style="display:none; margin-top:0; margin-bottom:18px;">
      <div class="new-qr-status-title">生徒用QRは登録済みです</div>
      <div class="new-qr-status-detail">登録済みのQRを下に表示しています。この画面からそのまま印刷できます。</div>
      <div class="check-qr-status-email">
        <div class="check-qr-status-email-title">登録済みの通知先メールアドレス</div>
        <div id="checkQrNotifyEmails" class="check-qr-status-email-list"></div>
        <a href="#email" class="check-qr-status-email-link" onclick="openCheckStudentEmailEditor(event)">メールアドレス登録・変更</a>
      </div>
    </div>
    <button id="checkLoadQrBtn" onclick="loadSelectedQrCards()" disabled>選択したQRを表示する</button>'''
if 'id="checkQrStatusBox"' not in s and target in s:
    s = s.replace(target, status_html)
reset_anchor = "  checkBatchMsgEl.className = 'msg';\n}"
if "const checkStatusBox = document.getElementById('checkQrStatusBox')" not in s and reset_anchor in s:
    s = s.replace(reset_anchor, "  checkBatchMsgEl.className = 'msg';\n  const checkStatusBox = document.getElementById('checkQrStatusBox');\n  if (checkStatusBox) checkStatusBox.style.display = 'none';\n}", 1)
load_end = "  checkLoadQrBtnEl.textContent = '選択したQRを表示する';\n}"
if 'await renderCheckQrStatus(cards);' not in s and load_end in s:
    s = s.replace(load_end, "  checkLoadQrBtnEl.textContent = '選択したQRを表示する';\n  await renderCheckQrStatus(cards);\n}", 1)
helpers = '''\nasync function renderCheckQrStatus(cards) {\n  const box = document.getElementById('checkQrStatusBox');\n  const list = document.getElementById('checkQrNotifyEmails');\n  if (!box || !list) return;\n  if (!Array.isArray(cards) || cards.length !== 1) { box.style.display='none'; list.innerHTML=''; return; }\n  box.style.display='block';\n  list.innerHTML='<span style="color:#777">メール情報を確認中...</span>';\n  try {\n    const r = await authorizedJsonp({ action:'getNotifyEmails', code:cards[0].code });\n    const all=[];\n    const add=value=>{ value=String(value||'').trim(); if(value&&!all.some(item=>item.toLowerCase()===value.toLowerCase())) all.push(value); };\n    add(r&&r.guardianEmail);\n    (Array.isArray(r&&r.deliveryEmails)?r.deliveryEmails:[]).forEach(add);\n    (Array.isArray(r&&r.emails)?r.emails:[]).forEach(add);\n    add(r&&r.email); add(r&&r.teacherEmail);\n    list.innerHTML=all.length?all.map(value=>'<div>・'+escapeQrHtml(value)+'</div>').join(''):'<span class="empty">メールアドレス未登録</span>';\n  } catch(e) { list.innerHTML='<span class="empty">取得できませんでした</span>'; }\n}\n\nfunction openCheckStudentEmailEditor(event) {\n  if(event) event.preventDefault();\n  const code=currentCheckedCode||(loadedQrCards.length===1?loadedQrCards[0].code:'');\n  switchTab('email');\n  if(!code) return;\n  emailStudentSearchEl.value=code;\n  renderEmailStudentSearch();\n  if(qrStudentRosterLoaded) selectEmailStudent(code);\n}\n'''
helper_anchor = '\nasync function sendCheckQrPdf() {'
if 'function openCheckStudentEmailEditor' not in s and helper_anchor in s:
    s = s.replace(helper_anchor, helpers + helper_anchor, 1)
persistence = '''\n<script id="qr-tab-persistence-20260831">\n(() => {\n  const validTabs=new Set(['existing','check','email','points','csv']);\n  const hashTab=()=>{const value=(location.hash||'').replace(/^#/,'').trim();return validTabs.has(value)?value:null;};\n  const originalSwitchTab=window.switchTab;\n  if(typeof originalSwitchTab!=='function') return;\n  window.switchTab=function(tab){originalSwitchTab(tab);if(validTabs.has(tab))history.replaceState(null,'','#'+tab);};\n  const restore=()=>{const tab=hashTab();if(tab)originalSwitchTab(tab);};\n  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',restore,{once:true});else restore();\n  window.addEventListener('hashchange',restore);\n})();\n</script>\n'''
if 'qr-tab-persistence-20260831' not in s:
    s = s.replace('</body>', persistence + '</body>')
p.write_text(s, encoding='utf-8')
