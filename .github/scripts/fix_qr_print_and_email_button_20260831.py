from pathlib import Path

# New QR pages must print at the same portrait card size used by the existing QR pages.
# Existing batch QR cards are 54mm x 74mm, so force the two new pages to the same size.
print_css = r'''
<style id="qr-existing-card-size-20260831">
@page { size: A4 portrait; margin: 0; }
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }
  body * { visibility: hidden !important; }
  .qr, .qr * { visibility: visible !important; }
  .head, .side-menu, .panel h2, .panel > label, .panel > input,
  .panel > .hint, .panel > .info, .panel > .status, .panel > .actions,
  .panel > .msg, .print, .pdf, .qr-mail-box { display: none !important; }
  .wrap, .page-shell, .content-main, .panel {
    display: block !important;
    width: auto !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    box-shadow: none !important;
  }
  .qr {
    display: block !important;
    visibility: visible !important;
    position: absolute !important;
    top: 40px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    box-sizing: border-box !important;
    width: 54mm !important;
    height: 74mm !important;
    min-height: 74mm !important;
    max-width: 54mm !important;
    margin: 0 !important;
    padding: 4mm 3mm !important;
    border: 1px solid #999 !important;
    border-radius: 2mm !important;
    overflow: hidden !important;
    text-align: center !important;
    page-break-inside: avoid !important;
  }
  .qr .pill {
    display: none !important;
  }
  .qr .school {
    margin: 0 0 2mm !important;
    font-size: 9pt !important;
    line-height: 1.2 !important;
  }
  .qr .code {
    margin: 0 !important;
    font-size: 12pt !important;
    line-height: 1.2 !important;
  }
  .qr .student {
    margin: 0 0 2mm !important;
    font-size: 10pt !important;
    line-height: 1.2 !important;
  }
  .qr img {
    display: block !important;
    width: 36mm !important;
    height: 36mm !important;
    margin: 1mm auto 0 !important;
  }
}
</style>
'''

for filename in ('student_qr_create.html', 'teacher_qr_create.html'):
    path = Path(filename)
    text = path.read_text(encoding='utf-8')
    if 'qr-existing-card-size-20260831' not in text:
        text = text.replace('</head>', print_css + '</head>')
    path.write_text(text, encoding='utf-8')

# Notification email save button: match the orange used by the QR issue button.
path = Path('student_qr_register.html')
text = path.read_text(encoding='utf-8')
text = text.replace(
    'id="saveEmailBtn" onclick="saveNotifyEmails()" style="background:#c0392b;"',
    'id="saveEmailBtn" onclick="saveNotifyEmails()" style="background:#b5651d;"'
)
path.write_text(text, encoding='utf-8')
