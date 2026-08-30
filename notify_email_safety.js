(() => {
  function init() {
    const codeEl = document.getElementById('emailStudentCode');
    const saveBtn = document.getElementById('saveEmailBtn');
    if (!codeEl || !saveBtn) return;

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
      if (codeEl.value.trim()) showPopup();
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
