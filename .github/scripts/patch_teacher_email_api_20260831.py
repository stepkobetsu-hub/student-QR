from pathlib import Path

p = Path('gas/コード.js')
s = p.read_text(encoding='utf-8')

# Add teacher row lookup by code if missing.
anchor = "function findTeacherRowByQrData_(sheet, qrData) {"
helper = '''function findTeacherRowByCode_(sheet, code) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, TEACHER_COL_CODE, lastRow - 1, 1).getValues();
  const target = String(code || '').trim();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === target) return i + 2;
  }
  return -1;
}

'''
if 'function findTeacherRowByCode_' not in s and anchor in s:
    s = s.replace(anchor, helper + anchor, 1)

# Replace getStudent_ so 7000-series codes are resolved from the teacher master and P is returned.
start = s.find('function getStudent_(code) {')
end = s.find('\nfunction saveStudentQrData_', start)
if start != -1 and end != -1:
    new_func = '''function getStudent_(code) {
  const target = String(code || '').trim();
  if (!target) return { ok: false, message: '番号を入力してください' };

  // 7000番台は講師マスターを正本とする。
  if (/^7\\d{3}$/.test(target)) {
    const teacherSheet = getTeacherMasterSheet_();
    const teacherRow = findTeacherRowByCode_(teacherSheet, target);
    if (teacherRow === -1) return { ok: false, message: '該当する講師が見つかりません' };
    const email = String(teacherSheet.getRange(teacherRow, TEACHER_COL_EMAIL).getDisplayValue() || '').trim();
    return {
      ok: true,
      isTeacher: true,
      name: teacherSheet.getRange(teacherRow, TEACHER_COL_NAME).getValue(),
      school: '講師',
      qrData: teacherSheet.getRange(teacherRow, TEACHER_COL_QR).getValue(),
      email: email,
      teacherEmail: email,
      emailChecked: true,
      emailSource: '講師マスターP列'
    };
  }

  const sheet = getMasterSheet_();
  const row = findStudentRow_(sheet, target);
  if (row === -1) return { ok: false, message: '該当する生徒が見つかりません（生徒番号を確認してください）' };

  return {
    ok: true,
    name: sheet.getRange(row, COL_STUDENT_NAME).getValue(),
    school: sheet.getRange(row, COL_SCHOOL).getValue(),
    qrData: sheet.getRange(row, COL_QR_DATA).getValue()
  };
}
'''
    s = s[:start] + new_func + s[end:]

# Replace getNotifyEmails_ so teacher queries return the P-column address explicitly.
start = s.find('function getNotifyEmails_(code) {')
end = s.find('\nfunction saveNotifyEmails_', start)
if start != -1 and end != -1:
    old_block = s[start:end]
    # Preserve existing student implementation by wrapping only a teacher preamble.
    brace = old_block.find('{')
    body = old_block[brace+1:]
    new_func = '''function getNotifyEmails_(code) {
  const target = String(code || '').trim();
  if (!target) return { ok: false, message: '番号を入力してください' };

  if (/^7\\d{3}$/.test(target)) {
    const teacherSheet = getTeacherMasterSheet_();
    const teacherRow = findTeacherRowByCode_(teacherSheet, target);
    if (teacherRow === -1) return { ok: false, message: '該当する講師が見つかりません' };
    const email = String(teacherSheet.getRange(teacherRow, TEACHER_COL_EMAIL).getDisplayValue() || '').trim();
    return {
      ok: true,
      isTeacher: true,
      name: teacherSheet.getRange(teacherRow, TEACHER_COL_NAME).getValue(),
      teacherEmail: email,
      email: email,
      emails: email ? [email] : [],
      deliveryEmails: email ? [email] : [],
      emailChecked: true,
      emailSource: '講師マスターP列'
    };
  }
''' + body
    s = s[:start] + new_func + s[end:]

p.write_text(s, encoding='utf-8')
