from pathlib import Path

path=Path('delivery_failures.html')
text=path.read_text(encoding='utf-8')
tag='<script src="invoice_delivery_failures.js?v=20260904-invoice-central"></script>'
if tag not in text:
    if '</body>' not in text:
        raise SystemExit('closing body tag not found')
    text=text.replace('</body>',tag+'\n</body>',1)
path.write_text(text,encoding='utf-8')
