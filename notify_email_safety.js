(() => {
  function init() {
    const codeEl = document.getElementById('emailStudentCode');
    const searchEl = document.getElementById('emailStudentSearch');
    const searchCountEl = document.getElementById('emailStudentSearchCount');
    const searchListEl = document.getElementById('emailStudentSearchList');
    const saveBtn = document.getElementById('saveEmailBtn');
    if (!codeEl || !saveBtn) return;

    const duplicateLabel = document.querySelector('label[for="emailStudentCode"]');
    const duplicateInfo = document.getElementById('emailStudentInfo');
    if (duplicateLabel) duplicateLabel.style.display = 'none';
    codeEl.style.display = 'none';
    if (duplicateInfo) duplicateInfo.style.display = 'none';

    const emailInputs = [1,2,3,4].map(n => document.getElementById('notifyEmail' + n)).filter(Boolean);
    const emailChecks = [1,2,3,4].map(n => document.getElementById('notifyEnabled' + n)).filter(Boolean);
    let confirmedCode = '';

    const ensureConfirmHint = () => {
      if (!searchCountEl) return;
      const text = (searchCountEl.textContent || '').trim();
      const hasResults = /\d+人見つかりました/.test(text);
      let hint = searchCountEl.querySelector('.confirm-search-hint');
      if (!hasResults || confirmedCode) {
        if (hint) hint.remove();
        return;
      }
      if (!hint) {
        hint = document.createElement('span');
        hint.className = 'confirm-search-hint';
        hint.textContent = '　クリックして確定してください。';
        searchCountEl.appendChild(hint);
      }
      hint.style.color = '#d32f2f';
      hint.style.fontWeight = '800';
      hint.style.fontSize = '14px';
    };

    const clearUnconfirmedSelection = () => {
      confirmedCode = '';
      codeEl.value = '';
      emailInputs.forEach(el => { el.value = ''; });
      emailChecks.forEach(el => { el.checked = true; });
      saveBtn.disabled = true;
      const msg = document.getElementById('emailMsg');
      if (msg) { msg.textContent = ''; msg.className = 'msg'; }
      setTimeout(ensureConfirmHint, 0);
    };

    if (searchEl) {
      searchEl.addEventListener('input', () => {
        clearUnconfirmedSelection();
        setTimeout(ensureConfirmHint, 0);
      }, true);
    }

    if (searchCountEl) {
      const countObserver = new MutationObserver(() => ensureConfirmHint());
      countObserver.observe(searchCountEl, { childList: true, subtree: true, characterData: true });
    }

    if (searchListEl) {
      searchListEl.addEventListener('click', (event) => {
        const row = event.target.closest('.email-student-row');
        if (!row) return;
        confirmedCode = String(row.dataset.code || '').trim();
        ensureConfirmHint();
      }, true);
    }

    if (!document.getElementById('notifyEmailLoadingPopup')) {
      const style = document.createElement('style');
      style.textContent = '#notifyEmailLoadingPopup{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(20,40,30,.30);z-index:9999;padding:20px}#notifyEmailLoadingPopup.show{display:flex}#notifyEmailLoadingPopup .box{width:min(440px,92vw);background:#fff;border:2px solid #2e7d5b;border-radius:14px;box-shadow:0 18px 55px rgba(0,0,0,.24);padding:24px 26px;text-align:center}#notifyEmailLoadingPopup .title{font-size:21px;font-weight:800;color:#1f664a;margin-bottom:8px}#notifyEmailLoadingPopup .text{font-size:14px;line-height:1.7;color:#555}#notifyEmailLoadingPopup .spinner{width:34px;height:34px;margin:0 auto 14px;border:4px solid #dce9e3;border-top-color:#2e7d5b;border-radius:50%;animation:notifySpin .8s linear infinite}@keyframes notifySpin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
      const popup = document.createElement('div');
      popup.id = 'notifyEmailLoadingPopup';
      popup.innerHTML = '<div class="box"><div class="spinner"></div><div class="title">現在登録されているメールを確認中です</div><div class="text">確認が終わるまで保存できません。少しお待ちください。</div></div>';
      document.body.appendChild(popup);
    }

    const popup = document.getElementById('notifyEmailLoadingPopup');
    const showPopup = () => popup.classList.add('show');
    const hidePopup = () => popup.classList.remove('show');

    codeEl.addEventListener('input', () => {
      const code = codeEl.value.trim();
      if (code && confirmedCode === code) showPopup();
      else hidePopup();
    });

    const saveObserver = new MutationObserver(() => {
      if (!saveBtn.disabled) hidePopup();
    });
    saveObserver.observe(saveBtn, { attributes: true, attributeFilter: ['disabled'] });

    const emailMsg = document.getElementById('emailMsg');
    if (emailMsg) {
      const msgObserver = new MutationObserver(() => {
        if (emailMsg.textContent.trim()) hidePopup();
      });
      msgObserver.observe(emailMsg, { childList: true, subtree: true, characterData: true });
    }

    const originalSave = window.saveNotifyEmails;
    if (typeof originalSave === 'function' && !originalSave.__confirmWrapped) {
      const wrapped = async function() {
        if (saveBtn.disabled) return originalSave.apply(this, arguments);
        const ok = window.confirm('本当に保存しますか？\n\n現在表示されている内容で通知先メールを上書きします。');
        if (!ok) return;
        return originalSave.apply(this, arguments);
      };
      wrapped.__confirmWrapped = true;
      window.saveNotifyEmails = wrapped;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
