from pathlib import Path

SHEET_URL = 'https://docs.google.com/spreadsheets/d/1L5aFDXAmfUDkBg8d7X3WqJgMhdMq5tM5sfUZ2G-M58E/edit?usp=drivesdk'

p = Path('student_qr_create.html')
s = p.read_text(encoding='utf-8')
student_css = '''\n<style id="student-missing-email-emphasis-20260831">\n#qrNotifyEmails .empty{color:#d93025!important;font-size:19px!important;font-weight:900!important;}\n</style>\n'''
if 'student-missing-email-emphasis-20260831' not in s:
    s = s.replace('</head>', student_css + '</head>')
p.write_text(s, encoding='utf-8')

p = Path('teacher_qr_create.html')
s = p.read_text(encoding='utf-8')

teacher_css = '''\n<style id="teacher-email-status-20260831">\n.teacher-email-title{margin-bottom:7px;color:#555;font-size:13px;font-weight:800}.teacher-email-value{color:#234b3b;font-size:14px;line-height:1.8;word-break:break-all}.teacher-email-value.missing{color:#d93025;font-size:19px;font-weight:900}.teacher-email-value.unknown{display:inline-block;padding:8px 12px;border-radius:8px;background:#fff4d6;color:#9a6500;font-size:14px;font-weight:800}.teacher-email-link{display:inline-flex;min-height:44px;margin-top:10px;padding:10px 16px;align-items:center;justify-content:center;border-radius:8px;background:#2e7d5b;color:#fff;font-size:14px;font-weight:800;text-decoration:none}.teacher-email-source{margin-top:5px;color:#777;font-size:12px}\n</style>\n'''
if 'teacher-email-status-20260831' not in s:
    s = s.replace('</head>', teacher_css + '</head>')

old_contacts = '<div id="contacts" class="contacts"></div>'
new_contacts = f'''<div id="contacts" class="contacts"><div class="teacher-email-title">登録済みメールアドレス</div><div id="teacherEmailValue" class="teacher-email-value">確認中...</div><div class="teacher-email-source">講師マスター P列</div><a class="teacher-email-link" href="{SHEET_URL}" target="_blank" rel="noopener">メールアドレス登録・変更</a></div>'''
if old_contacts in s:
    s = s.replace(old_contacts, new_contacts, 1)

old_vars = "let session=null,timer=null,seq=0,student=null,qrData='',currentCode='';"
new_vars = "let session=null,timer=null,seq=0,student=null,qrData='',currentCode='',currentTeacherEmail='',teacherEmailChecked=false;"
if old_vars in s:
    s = s.replace(old_vars, new_vars, 1)

old_reset = "$('contacts').textContent='';"
new_reset = "currentTeacherEmail='';teacherEmailChecked=false;if($('teacherEmailValue')){$('teacherEmailValue').textContent='';$('teacherEmailValue').className='teacher-email-value';}"
if old_reset in s:
    s = s.replace(old_reset, new_reset, 1)

render_helper = '''\nfunction renderTeacherEmail(value, checked){\n  currentTeacherEmail=String(value||'').trim();\n  teacherEmailChecked=checked===true;\n  const el=$('teacherEmailValue');\n  if(!el)return;\n  if(currentTeacherEmail){el.textContent=currentTeacherEmail;el.className='teacher-email-value';return;}\n  if(teacherEmailChecked){el.textContent='メールアドレス未登録';el.className='teacher-email-value missing';return;}\n  el.textContent='メール登録状況をAPIから確認できません';el.className='teacher-email-value unknown';\n}\n'''
anchor = 'function showQR(notice)'
if 'function renderTeacherEmail(value, checked)' not in s:
    import re
    s = re.sub(r'\nfunction renderTeacherEmail\(value\)\{.*?\n\}\n(?=function showQR\(notice\))', render_helper, s, count=1, flags=re.S)
    if 'function renderTeacherEmail(value, checked)' not in s and anchor in s:
        s = s.replace(anchor, render_helper + anchor, 1)

old_render_tail = "$('contacts').textContent='登録済みの連絡先：確認中...'"
if old_render_tail in s:
    s = s.replace(old_render_tail, "if(!currentTeacherEmail)renderTeacherEmail('', false)", 1)

lookup_marker = "student={code,name:r.name||'(氏名なし)'};"
if lookup_marker in s:
    import re
    s = re.sub(re.escape(lookup_marker) + r"renderTeacherEmail\([^;]+;", lookup_marker + "renderTeacherEmail(r.email||r.teacherEmail||'', r.teacherEmailChecked===true||r.emailChecked===true);", s, count=1)
    if "renderTeacherEmail(r.email||r.teacherEmail||'', r.teacherEmailChecked===true||r.emailChecked===true);" not in s:
        s = s.replace(lookup_marker, lookup_marker + "renderTeacherEmail(r.email||r.teacherEmail||'', r.teacherEmailChecked===true||r.emailChecked===true);", 1)

old_notify = "try{const c=await jsonp({action:'getNotifyEmails',code});const a=[];const add=v=>{v=String(v||'').trim();if(v&&!a.some(x=>x.toLowerCase()===v.toLowerCase()))a.push(v)};add(c&&c.teacherEmail);add(c&&c.email);(Array.isArray(c&&c.emails)?c.emails:[]).forEach(add);if(a.length)renderTeacherEmail(a[0]);else if(!currentTeacherEmail)renderTeacherEmail('')}catch(e){if(!currentTeacherEmail)renderTeacherEmail('')}"
new_notify = "try{const c=await jsonp({action:'getNotifyEmails',code});const a=[];const add=v=>{v=String(v||'').trim();if(v&&!a.some(x=>x.toLowerCase()===v.toLowerCase()))a.push(v)};add(c&&c.teacherEmail);add(c&&c.email);(Array.isArray(c&&c.emails)?c.emails:[]).forEach(add);const checked=!!(c&&(c.teacherEmailChecked===true||c.emailChecked===true));if(a.length)renderTeacherEmail(a[0],true);else if(!currentTeacherEmail)renderTeacherEmail('',checked)}catch(e){if(!currentTeacherEmail)renderTeacherEmail('',false)}"
if old_notify in s:
    s = s.replace(old_notify, new_notify, 1)

p.write_text(s, encoding='utf-8')
