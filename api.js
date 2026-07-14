const API_URL = 'https://script.google.com/macros/s/AKfycbxIH2VtgwRi50xduXgrkYrjD0yrzNfQ5vCWt1XgOzil6LZSgXNj6MJo9jPYvOkjNHdu/exec';

function delay(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function retry(fn, tries = 3){
  let last;
  for(let i=0;i<tries;i++){
    try{ return await fn(); }
    catch(e){ last=e; await delay(600 * (i + 1)); }
  }
  throw last;
}

function jsonpOnce(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = 'cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    const qs = new URLSearchParams({ action, callback: callbackName, ...params });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('通信がタイムアウトしました。もう一度お試しください。'));
    }, 20000);

    function cleanup(){
      clearTimeout(timer);
      try{ delete window[callbackName]; }catch(e){}
      try{ script.remove(); }catch(e){}
    }

    window[callbackName] = (data) => {
      cleanup();
      if(data && data.error) reject(new Error(data.message || 'Apps Scriptでエラーが発生しました'));
      else resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('通信に失敗しました。'));
    };
    script.src = `${API_URL}?${qs.toString()}`;
    document.body.appendChild(script);
  });
}

function jsonp(action, params = {}) {
  return retry(() => jsonpOnce(action, params), 3);
}

async function postJsonOnce(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try{
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) throw new Error('送信に失敗しました。');
    const data = await res.json();
    if (data && data.error) throw new Error(data.message || 'Apps Scriptでエラーが発生しました');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(payload) {
  // メール送信は二重送信防止のため再試行しません。
  if(payload && payload.action === 'sendSelected') return postJsonOnce(payload);
  return retry(() => postJsonOnce(payload), 2);
}

const api = {
  getStudents: () => jsonp('getStudents'),
  getTemplates: () => jsonp('getTemplates'),
  getSettings: () => jsonp('getSettings'),
  getHistory: (params) => jsonp('getHistory', params),
  getAbsences: () => jsonp('getAbsences'),
  sendMail: (payload) => postJson({ action: 'sendSelected', ...payload }),
  archiveHistory: (id) => postJson({ action: 'archiveHistory', id }),
  restoreHistory: (id) => postJson({ action: 'restoreHistory', id }),
  deleteHistoryPermanent: (id) => postJson({ action: 'deleteHistoryPermanent', id }),
  saveTemplate: (payload) => postJson({ action: 'saveTemplate', ...payload }),
  saveSettings: (settings) => postJson({ action: 'saveSettings', settings }),
  saveTemplateAs: (payload) => postJson({ action: 'saveTemplateAs', ...payload }),
  deleteTemplate: (id) => postJson({ action: 'deleteTemplate', id }),
  refreshStudents: () => postJson({ action: 'refreshStudents' }),
  refreshAbsences: () => postJson({ action: 'refreshAbsences' })
};
