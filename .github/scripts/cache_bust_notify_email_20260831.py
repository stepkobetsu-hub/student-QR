from pathlib import Path
p = Path('student_qr_register.html')
s = p.read_text(encoding='utf-8')
s = s.replace('notify_email_safety.js?v=20260831-2', 'notify_email_safety.js?v=20260831-3')
p.write_text(s, encoding='utf-8')
