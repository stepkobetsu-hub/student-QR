from pathlib import Path

SHEET_URL = 'https://docs.google.com/spreadsheets/d/1L5aFDXAmfUDkBg8d7X3WqJgMhdMq5tM5sfUZ2G-M58E/edit?usp=drivesdk'

# Ensure the student create page always emphasizes a missing notification email.
p = Path('student_qr_create.html')
s = p.read_text(encoding='utf-8')
student_css = '''\n<style id="student-missing-email-emphasis-20260831">\n#qrNotifyEmails .empty{color:#d93025!important;font-size:19px!important;font-weight:900!important;}\n</style>\n'''
if 'student-missing-email-emphasis-20260831' not in s:
    s = s.replace('</head>', student_css + '</head>')
p.write_text(s, encoding='utf-8')

# Teacher create page: show P-column email returned by the teacher lookup,
# highlight missing email, and provide a direct edit link to the teacher master.
p = Path('teacher_qr_create.html')
s = p.read_text(encoding='utf-8')

teacher_css = '''\n<style id="teacher-email-status-20260831">\n.teacher-email-title{margin-bottom:7px;color:#555;font-size:13px;font-weight:800}.teacher-email-value{color:#234b3b;font-size:14px;line-height:1.8;word-break:break-all}.teacher-email-value.missing{color:#d93025;font-size:19px;font-weight:900}.teacher-email-link{display:inline-flex;min-height:44px;margin-top:10px;padding:10px 16px;align-items:center;justify-content:center;border-radius:8px;background:#2e7d5b;color:#fff;font-size:14px;font-weight:800;text-decoration:none}.teacher-email-source{margin-top:5px;color:#777;font-size:12px}\n</style>\n'''
if 'teacher-email-status-20260831' not in s:
    s = s.replace('</head>', teacher_css + '</head>')

old_contacts = '<div id="contacts" class="contacts"></div>'
new_contacts = f'''<div id="contacts" class="contacts"><div class="teacher-email-title">登録済みメールアドレス</div><div id="teacherEmailValue" class="teacher-email-value">確認中...</div><div class="teacher-email-source">講師マスター P列</div><a class="teacher-email-link" href="{SHEET_URL}" target="_blank" rel="noopener">メールアドレス登録・変更</a></div>'''
if old_contacts in s:
    s = s.replace(old_contacts, new_contacts, 1)

old_vars = "let session=null,timer=null,seq=0,student=null,qrData='',currentCode='';"
new_vars = "let session=null,timer=null,seq=0,student=null,qrData='',currentCode='',currentTeacherEmail='';"
if old_vars in s:
    s = s.replace(old_vars, new_vars, 1)

old_reset = "$('contacts').textContent='';"
new_reset = "currentTeacherEmail='';if($('teacherEmailValue')){$('teacherEmailValue').textContent='';$('teacherEmailValue').className='teacher-email-value';}"
if old_reset in s:
    s = s.replace(old_reset, new_reset, 1)

render_helper = '''\nfunction renderTeacherEmail(value){\n  currentTeacherEmail=String(value||'').trim();\n  const el=$('teacherEmailValue');\n  if(!el)return;\n  if(currentTeacherEmail){el.textContent=currentTeacherEmail;el.className='teacher-email-value';}\n  else{el.textContent='メールアドレス未登録';el.className='teacher-email-value missing';}\n}\n'''
anchor = 'function showQR(notice)'
if 'function renderTeacherEmail(value)' not in s and anchor in s:
    s = s.replace(anchor, render_helper + anchor, 1)

old_render_tail = "$('contacts').textContent='登録済みの連絡先：確認中...'"
if old_render_tail in s:
    s = s.replace(old_render_tail, "if(!currentTeacherEmail)renderTeacherEmail('')", 1)

# Prefer email from the teacher lookup response (P-column in the current teacher API).
lookup_marker = "student={code,name:r.name||'(氏名なし)'};"
if lookup_marker in s and "renderTeacherEmail(r.email||r.teacherEmail||'')" not in s:
    s = s.replace(lookup_marker, lookup_marker + "renderTeacherEmail(r.email||r.teacherEmail||'');", 1)

# If the legacy notify-email call returns any usable address, use it too;
# importantly, do not overwrite a teacher P-column email with an empty result.
old_notify = "try{const c=await jsonp({action:'getNotifyEmails',code});const a=[...new Set((c.emails||[]).map(v=>String(v||'').trim()).filter(Boolean))];$('contacts').textContent=a.length?'登録済みの連絡先：'+a.join(' ／ '):'登録済みの連絡先：なし'}catch(e){}"
new_notify = "try{const c=await jsonp({action:'getNotifyEmails',code});const a=[];const add=v=>{v=String(v||'').trim();if(v&&!a.some(x=>x.toLowerCase()===v.toLowerCase()))a.push(v)};add(c&&c.teacherEmail);add(c&&c.email);(Array.isArray(c&&c.emails)?c.emails:[]).forEach(add);if(a.length)renderTeacherEmail(a[0]);else if(!currentTeacherEmail)renderTeacherEmail('')}catch(e){if(!currentTeacherEmail)renderTeacherEmail('')}"
if old_notify in s:
    s = s.replace(old_notify, new_notify, 1)

# Keep the edit/status area visible whenever a valid teacher was found.
# The status block itself is already shown by render().
p.write_text(s, encoding='utf-8')
