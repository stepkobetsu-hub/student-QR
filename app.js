const W = ['日','月','火','水','木','金','土'];
let students=[], templates=[], selected=new Map(), currentTemplate=null, files=[], activeGrades=new Set(['全生徒']), sortMode='asc', historyMode='normal';
const $=id=>document.getElementById(id);
function fmtDate(d){const x=new Date(d+'T00:00:00');return `${d.replaceAll('-','/')}（${W[x.getDay()]}）`}
function jpDateOnly(d){const x=new Date(d+'T00:00:00');return `${x.getMonth()+1}月${x.getDate()}日`}
function jpShort(d){const x=new Date(d+'T00:00:00');return `${x.getMonth()+1}月${x.getDate()}日（${W[x.getDay()]}）`}
function today(){return new Date().toISOString().slice(0,10)}
function timeText(){return $('timeSelect').value==='custom'?$('customTime').value:$('timeSelect').value}
function gradeMatchOne(g,f){if(f==='全生徒'||f==='全学年')return true;if(f==='全小学生')return g.startsWith('小');if(f==='全中学生')return g.startsWith('中');if(f==='全高校生')return g.startsWith('高');return g===f}
function gradeMatch(g){if(!activeGrades.size)return false;if(activeGrades.has('全生徒'))return true;return [...activeGrades].some(f=>gradeMatchOne(g,f))}
const GRADE_ORDER=['小1','小2','小3','小4','小5','小6','中1','中2','中3','高1','高2','高3'];
function gradeRank(g){const i=GRADE_ORDER.indexOf(g);return i>=0?i:999}
function gradeClass(g){if(String(g).startsWith('小'))return 'gradeElem';if(String(g).startsWith('中'))return 'gradeJr';if(String(g).startsWith('高'))return 'gradeHigh';return ''}
function filtered(){const sc=$('schoolFilter').value, q=$('nameFilter').value.trim().toLowerCase();const list=students.filter(s=>(sc==='全校舎'||s.school===sc)&&gradeMatch(s.grade)&&(!q||s.name.toLowerCase().includes(q)));list.sort((a,b)=>{const d=gradeRank(a.grade)-gradeRank(b.grade); if(d) return sortMode==='desc'?-d:d; return a.name.localeCompare(b.name,'ja')});return list}
function renderStudents(){const list=filtered();$('listCount').textContent=`${list.length}人表示 / ${students.length}人取得`; $('studentList').innerHTML=list.map(s=>`<div class="studentRow ${selected.has(s.id)?'selected':''}" data-id="${s.id}"><input type="checkbox" ${selected.has(s.id)?'checked':''}><b>${s.name}</b><span class="gradeBadge ${gradeClass(s.grade)}">${s.grade}</span><span>${s.school}</span></div>`).join('')||'<div class="muted" style="padding:12px">該当する生徒がいません。</div>'; document.querySelectorAll('.studentRow').forEach(r=>r.onclick=()=>toggleStudent(r.dataset.id));renderSelected()}
function toggleStudent(id){const s=students.find(x=>x.id===id); if(!s)return; selected.has(id)?selected.delete(id):selected.set(id,s); renderStudents()}
function renderSelected(){const arr=[...selected.values()];$('selectedCount').textContent=`${arr.length}人`; $('selectedSummary').classList.add('hidden'); $('selectedList').innerHTML=arr.length?arr.map(s=>`<div class="selectedItem"><span class="badge ${gradeClass(s.grade)}">${s.grade}</span><b>${s.name}さん</b><span>${s.school}</span><button class="chipX" title="解除" onclick="selected.delete('${s.id}');renderStudents();updatePreview()">×</button></div>`).join(''):'<span class="muted">まだ選択されていません。</span>'}
function decideSelection(){activeGrades.clear(); $('nameFilter').value=''; renderGradeButtons(); renderStudents(); updatePreview(); document.getElementById('studentList')?.scrollIntoView({behavior:'smooth',block:'nearest'});}
function applyTemplate(){const id=$('templateSelect').value; currentTemplate=templates.find(t=>t.id===id); if(!currentTemplate)return; $('subjectInput').value=currentTemplate.subject; $('bodyInput').value=currentTemplate.body; updatePreview()}
function previewPhone(){const arr=[...selected.values()]; if(arr.length===1){return arr[0].school==='大手町校'?'0568-27-9581':'0568-41-8937'} return '各生徒の校舎電話番号が入ります'}
function escapeHTML(s){return String(s||'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]||ch))}
function makeBody(){let b=$('bodyInput').value||''; const d=$('dateInput').value; const t=timeText(); const arr=[...selected.values()]; const sample=arr.length>=2?'__EACH_STUDENT_NAME__':(arr[0]?.name||'山田太郎'); const dateFull=jpShort(d); const weekday=W[new Date(d+'T00:00:00').getDay()]; return b.replaceAll('{{日付}}（{{曜日}}）',dateFull).replaceAll('{{日付}}{{曜日}}',dateFull).replaceAll('{{生徒名}}',sample).replaceAll('{{日付}}',dateFull).replaceAll('{{曜日}}',weekday).replaceAll('{{時間帯}}',t).replaceAll('{{電話番号}}',previewPhone())}
function updatePreview(){ const raw=makeBody(); const html=escapeHTML(raw).replaceAll('__EACH_STUDENT_NAME__','<span class="previewPlaceholder">〈各々の生徒名が入ります〉</span>'); $('preview').innerHTML=html }
function buildAttachments(){return Promise.all(files.map(f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res({name:f.name,type:f.type,data:r.result.split(',')[1]});r.onerror=rej;r.readAsDataURL(f)})))}

const GRADE_OPTIONS=['全生徒','全小学生','全中学生','全高校生','小1','小2','小3','小4','小5','小6','中1','中2','中3','高1','高2','高3'];
function renderGradeButtons(){
  const box=$('gradeButtons');
  box.innerHTML=GRADE_OPTIONS.map(g=>`<button type="button" class="gradeBtn ${activeGrades.has(g)?'active':''}" data-grade="${g}">${g}</button>`).join('');
  box.querySelectorAll('.gradeBtn').forEach(btn=>btn.onclick=()=>toggleGrade(btn.dataset.grade));
}
function toggleGrade(g){
  if(g==='全生徒'){
    if(activeGrades.has('全生徒')) activeGrades.clear();
    else activeGrades=new Set(['全生徒']);
  }else{
    activeGrades.delete('全生徒');
    activeGrades.has(g)?activeGrades.delete(g):activeGrades.add(g);
  }
  renderGradeButtons();
  renderStudents();
}

async function load(){
  $('dateInput').value=today();
  syncDate();
  renderGradeButtons();

  // Ver.31.2.2：まずブラウザ保存の生徒一覧を即表示し、裏で最新を取得します。
  const cached = localStorage.getItem('step_students_v313');
  if(cached){
    try{
      students = JSON.parse(cached) || [];
      renderStudents();
    }catch(e){}
  }

  const cachedTemplates = localStorage.getItem('step_templates_v313');
  if(cachedTemplates){
    try{
      templates = JSON.parse(cachedTemplates) || [];
      $('templateSelect').innerHTML=templates.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
      applyTemplate();
    }catch(e){}
  }

  try{
    templates=await api.getTemplates();
    localStorage.setItem('step_templates_v313', JSON.stringify(templates));
    $('templateSelect').innerHTML=templates.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
    applyTemplate();
  }catch(e){
    if(!templates.length){
      alert('テンプレートの読み込みに失敗しました：'+e.message);
    }
  }

  api.getStudents().then(list=>{
    students=list||[];
    localStorage.setItem('step_students_v313', JSON.stringify(students));
    renderStudents();
  }).catch(e=>{ if(!students.length) alert(e.message); });

  loadAbsences();
}
function syncDate(){ $('dateDisplay').value=fmtDate($('dateInput').value) }
function openNativeDate(){ $('dateInput').showPicker?.(); $('dateInput').click() }
function showConfirm(){const arr=[...selected.values()]; const title=$('subjectInput').value; const d=jpShort($('dateInput').value); const t=timeText(); let msg=`送信件数：${arr.length}件\n件名：${title}\n`; if((currentTemplate?.id||'').includes('tokkun')) msg+=`案内日時：${d} ${t}\n`; msg+=`\n送信先：\n${arr.map(s=>`${s.grade} ${s.name}さん`).join('、')}`; return confirm(msg)}
function showSendProgress(){let m=$('sendModal'); if(!m){m=document.createElement('div');m.id='sendModal';m.className='modalOverlay';document.body.appendChild(m)} m.innerHTML=`<div class="modalBox"><h2>送信中です…</h2><div class="progressBar"><div></div></div><p>画面を閉じずにお待ちください。</p></div>`; m.classList.remove('hidden')}
function showSendResult(res){let m=$('sendModal'); if(!m){m=document.createElement('div');m.id='sendModal';m.className='modalOverlay';document.body.appendChild(m)} const sent=res?.sentCount||0; const errors=res?.errors||[]; const ok=errors.length===0; m.innerHTML=`<div class="modalBox ${ok?'success':'warn'}"><h2>${ok?'✅ 配信が完了しました':'⚠ 配信結果を確認してください'}</h2><div class="resultCount">送信成功：${sent}件</div><div class="resultCount">送信失敗：${errors.length}件</div>${errors.length?`<pre class="errorList">${errors.join('\n')}</pre>`:''}<button class="btn primary" onclick="document.getElementById('sendModal').classList.add('hidden')">OK</button></div>`; m.classList.remove('hidden')}
function showSendError(e){let m=$('sendModal'); if(!m){m=document.createElement('div');m.id='sendModal';m.className='modalOverlay';document.body.appendChild(m)} m.innerHTML=`<div class="modalBox warn"><h2>送信できませんでした</h2><pre class="errorList">${e.message||e}</pre><button class="btn primary" onclick="document.getElementById('sendModal').classList.add('hidden')">OK</button></div>`; m.classList.remove('hidden')}
async function send(){if(!selected.size){alert('送信先を選択してください');return} if(!showConfirm())return; $('status').textContent='送信中です…'; showSendProgress(); try{const at=await buildAttachments(); const res=await api.sendMail({templateId:currentTemplate?.id||'',subject:$('subjectInput').value,body:$('bodyInput').value,studentIds:[...selected.keys()],dateText:jpDateOnly($('dateInput').value),dateValue:$('dateInput').value,weekday:W[new Date($('dateInput').value+'T00:00:00').getDay()],timeText:timeText(),attachments:at}); if(!res || res.error) throw new Error(res?.message || '送信結果が確認できませんでした'); const errText=(res.errors&&res.errors.length)?`（エラー：${res.errors.join(' / ')}）`:''; $('status').textContent=`送信完了：${res.sentCount||0}件${errText}`; showSendResult(res); selected.clear(); files=[]; renderFiles(); renderStudents(); loadHistory();}catch(e){$('status').textContent='エラー：'+e.message; showSendError(e)}}
function renderFiles(){ $('fileList').innerHTML=files.map(f=>`📎 ${f.name}`).join('<br>') }
async function loadHistory(){
  const archived = historyMode==='archive' ? '1' : '';
  const data=await api.getHistory({from:$('historyFrom').value,to:$('historyTo').value,q:$('historySearch').value,archived});
  const emptyMsg = historyMode==='archive' ? 'アーカイブはありません。' : '履歴がありません。';
  $('historyList').innerHTML=data.map(h=>{
    const actions = historyMode==='archive'
      ? `<div class="historyActions"><button class="btn small primary" onclick="restoreHistory('${h.id}')">復元</button><button class="btn small danger" onclick="deleteHistoryPermanent('${h.id}')">完全削除</button></div>`
      : `<button class="xbtn" title="アーカイブ" onclick="archiveHistory('${h.id}')">×</button>`;
    const label = historyMode==='archive' ? '<span class="archiveBadge">アーカイブ</span>' : '';
    return `<div class="historyItem">${actions}${label}<div class="historyMeta">送信日：${h.sentDateLabel}</div><div class="historyTitle">${h.titleLine}</div><div class="historyMeta">送信先：${h.targetLine}</div><details class="details"><summary>本文・詳細を表示</summary><pre>${h.body||''}</pre></details></div>`
  }).join('')||`<div class="muted">${emptyMsg}</div>`
}
async function archiveHistory(id){if(!confirm('この履歴を画面から非表示（アーカイブ）にしますか？'))return; await api.archiveHistory(id); loadHistory()}
async function restoreHistory(id){await api.restoreHistory(id); loadHistory()}
async function deleteHistoryPermanent(id){if(!confirm('この履歴を完全削除します。元に戻せません。よろしいですか？'))return; await api.deleteHistoryPermanent(id); loadHistory()}
function renderAbsences(data){$('absenceList').innerHTML=(data||[]).map(a=>`<div class="absenceItem ${a.isToday?'today':''}"><b>${a.dateLabel}</b>${a.receivedLabel?` <span class="receivedTime">${a.receivedLabel}</span>`:''}<div>${a.school}　${a.name}</div><div>${a.kind}　${a.reason||''}</div><div class="muted">${a.other||''}</div></div>`).join('')||'<div class="muted">本日以降の欠席遅刻連絡はありません。</div>'; const t=$('absenceAutoStatus'); if(t){t.textContent='最終確認：'+new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});}}
async function loadAbsences(){const cached=localStorage.getItem('step_absences_v313'); if(cached){try{renderAbsences(JSON.parse(cached)||[])}catch(e){}} const data=await api.getAbsences(); localStorage.setItem('step_absences_v313',JSON.stringify(data||[])); renderAbsences(data);}
window.archiveHistory=archiveHistory;window.restoreHistory=restoreHistory;window.deleteHistoryPermanent=deleteHistoryPermanent;
document.addEventListener('DOMContentLoaded',()=>{load().catch(e=>alert(e.message)); $('dateDisplay').onclick=openNativeDate; $('dateInput').onchange=()=>{syncDate();updatePreview()}; ['timeSelect','customTime','subjectInput'].forEach(id=>$(id).oninput=updatePreview); $('templateSelect').onchange=applyTemplate; ['schoolFilter','nameFilter'].forEach(id=>$(id).oninput=renderStudents);  const refreshStudentsNow=async()=>{if(!confirm('生徒マスタから最新情報を取り込みますか？'))return; $('listCount').textContent='生徒情報を更新中…'; try{const r=await api.refreshStudents(); students=await api.getStudents(); localStorage.setItem('step_students_v313', JSON.stringify(students)); selected.clear(); renderStudents(); alert('生徒情報を更新しました：'+(r.count||students.length)+'人');}catch(e){alert('更新エラー：'+e.message)}}; if($('refreshStudentsBtn')) $('refreshStudentsBtn').onclick=refreshStudentsNow; if($('refreshStudentsTopBtn')) $('refreshStudentsTopBtn').onclick=refreshStudentsNow; $('selectVisibleBtn').onclick=()=>{filtered().forEach(s=>selected.set(s.id,s));renderStudents()}; $('clearVisibleBtn').onclick=()=>{filtered().forEach(s=>selected.delete(s.id));renderStudents()}; $('invertVisibleBtn').onclick=()=>{filtered().forEach(s=>selected.has(s.id)?selected.delete(s.id):selected.set(s.id,s));renderStudents()}; $('clearAllSelectedBtn').onclick=()=>{selected.clear();renderStudents();updatePreview()}; if($('decideSelectionBtn')) $('decideSelectionBtn').onclick=decideSelection; $('clearGradeBtn').onclick=()=>{activeGrades.clear();renderGradeButtons();renderStudents()}; $('sortAscBtn').onclick=()=>{sortMode='asc';renderStudents()}; $('sortDescBtn').onclick=()=>{sortMode='desc';renderStudents()}; $('toggleBodyBtn').onclick=()=>$('bodyEditor').classList.toggle('hidden'); $('saveBodyBtn').onclick=updatePreview; $('sendBtn').onclick=send; $('fileInput').onchange=e=>{files=[...files,...e.target.files];renderFiles()}; const dz=$('dropZone'); dz.ondragover=e=>{e.preventDefault();dz.classList.add('drag')}; dz.ondragleave=()=>dz.classList.remove('drag'); dz.ondrop=e=>{e.preventDefault();dz.classList.remove('drag');files=[...files,...e.dataTransfer.files];renderFiles()}; $('absenceTab').onclick=()=>{$('absencePanel').classList.remove('hidden');$('historyPanel').classList.add('hidden');$('absenceTab').classList.add('active');$('historyTab').classList.remove('active')}; $('historyTab').onclick=()=>{$('historyPanel').classList.remove('hidden');$('absencePanel').classList.add('hidden');$('historyTab').classList.add('active');$('absenceTab').classList.remove('active');loadHistory()}; $('reloadHistory').onclick=()=>{historyMode='normal';$('showArchiveBtn').classList.remove('hidden');$('showNormalHistoryBtn').classList.add('hidden');loadHistory()}; const clearHistBtn=$('clearHistorySearchBtn'); if(clearHistBtn) clearHistBtn.onclick=()=>{ $('historySearch').value=''; $('historyFrom').value=''; $('historyTo').value=''; historyMode='normal'; $('showArchiveBtn').classList.remove('hidden'); $('showNormalHistoryBtn').classList.add('hidden'); loadHistory();}; if($('showArchiveBtn')) $('showArchiveBtn').onclick=()=>{historyMode='archive';$('showArchiveBtn').classList.add('hidden');$('showNormalHistoryBtn').classList.remove('hidden');loadHistory()}; if($('showNormalHistoryBtn')) $('showNormalHistoryBtn').onclick=()=>{historyMode='normal';$('showArchiveBtn').classList.remove('hidden');$('showNormalHistoryBtn').classList.add('hidden');loadHistory()}; const refreshAbsenceBtn=$('refreshAbsenceCacheBtn'); if(refreshAbsenceBtn) refreshAbsenceBtn.onclick=async()=>{refreshAbsenceBtn.disabled=true; refreshAbsenceBtn.textContent='更新中…'; try{const r=await api.refreshAbsences(); if(r && r.items){localStorage.setItem('step_absences_v313',JSON.stringify(r.items)); renderAbsences(r.items);} else {await loadAbsences();} alert('欠席連絡を更新しました：'+(r.count||0)+'件');}catch(e){alert('欠席連絡の更新エラー：'+e.message)} finally{refreshAbsenceBtn.disabled=false; refreshAbsenceBtn.textContent='欠席連絡を手動更新';}}; setInterval(()=>{loadAbsences().catch(()=>{})},60000);});
