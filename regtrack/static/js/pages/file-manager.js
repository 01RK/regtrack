(() => {
'use strict';
const $=id=>document.getElementById('fm-'+id), t=App.t, esc=App.esc || (s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
let data,folder='',page=1,total=0,busy=false,requestId=0;
const initial=new URLSearchParams(location.search);
function params(){return {scope:$('scope').value,owner_id:$('owner').value,stage:$('stage').value,folder,page};}
async function api(url,options={}) {
 const headers=new Headers(options.headers||{});
 const operator=App.user || localStorage.getItem('regtrack.user') || '';
 if(operator) headers.set('X-User',encodeURIComponent(operator));
 const response=await fetch(url,{...options,headers});
 if(!response.ok){const d=await response.json().catch(()=>({}));const error=Error(d.error||response.statusText);error.status=response.status;throw error;}
 return response.json();
}
function message(s){$('status').textContent=s;}
function owners(){
 const standard=$('scope').value==='standard';
 $('owner').innerHTML=(standard?data.standards:data.workgroups).map(x=>`<option value="${x.id}">${esc(standard?`${x.number} ${x.name_cn}`:x.name)}</option>`).join('');
 $('stage').innerHTML=(standard?data.stages:data.stages.filter(x=>x.code==='OTHER')).map(x=>`<option value="${x.code}">${esc(t(x.name,x.en))}</option>`).join('');
 if(standard) $('stage').value='OTHER';
}
function setBusy(value){busy=value;for(const id of ['scope','owner','stage','new','upload','refresh','up','prev','next'])$(id).disabled=value;}
async function load(){
 const ticket=++requestId;
 if(!$('owner').value){$('rows').innerHTML='';message(t('请先创建标准或工作组。','Create a standard or workgroup first.'));return;}
 try{
  const d=await api('/api/file-manager?'+new URLSearchParams(params()));if(ticket!==requestId)return;
  total=d.total;
  $('breadcrumb').innerHTML=`<button type="button" class="btn btn-link btn-sm" data-path="">${t('根目录','Root')}</button>`;
  let path='';for(const part of folder.split('/').filter(Boolean)){path+=(path?'/':'')+part;$('breadcrumb').insertAdjacentHTML('beforeend',` / <button type="button" class="btn btn-link btn-sm" data-path="${esc(path)}">${esc(part)}</button>`);}
  $('rows').innerHTML=d.folders.map(x=>`<tr><td><button type="button" class="btn btn-link" data-folder="${esc(x.path)}">&#128193; ${esc(x.name)}</button></td><td colspan="3">${t('文件夹','Folder')}</td><td><button type="button" class="btn btn-sm btn-outline-danger" data-delete-folder="${x.id}">${t('删除','Delete')}</button></td></tr>`).join('')+d.items.map(x=>`<tr><td>${esc(x.name)}</td><td>${new Intl.NumberFormat().format(x.size_bytes)} B</td><td>${esc(x.uploaded_by)}</td><td>${esc(x.uploaded_at)}</td><td><a class="btn btn-sm btn-outline-secondary" href="/api/file-manager/${x.id}/download">${t('下载','Download')}</a> <button type="button" class="btn btn-sm btn-outline-danger" data-delete="${x.id}">${t('删除','Delete')}</button></td></tr>`).join('');
  if(!d.folders.length&&!d.items.length)$('rows').innerHTML=`<tr><td colspan="5">${t('此文件夹为空，可上传文件或新建文件夹。','This folder is empty. Upload files or create a folder.')}</td></tr>`;
  $('page').textContent=`${page} / ${Math.max(1,Math.ceil(total/100))}`;
  $('prev').disabled=busy||page<=1;$('next').disabled=busy||page*100>=total;
  $('up').disabled=busy||!folder;message('');
 }catch(e){message(e.message);}
}
$('scope').addEventListener('change',()=>{owners();folder='';page=1;load();});
for(const id of ['owner','stage'])$(id).addEventListener('change',()=>{folder='';page=1;load();});
$('refresh').addEventListener('click',load);
$('up').addEventListener('click',()=>{folder=folder.split('/').slice(0,-1).join('/');page=1;load();});
$('prev').addEventListener('click',()=>{if(page>1){page--;load();}});
$('next').addEventListener('click',()=>{if(page*100<total){page++;load();}});
$('breadcrumb').addEventListener('click',e=>{const b=e.target.closest('[data-path]');if(b){folder=b.dataset.path;page=1;load();}});
$('rows').addEventListener('click',async e=>{
 const removeFolder=e.target.closest('[data-delete-folder]');
 if(removeFolder){
  if(!confirm(t('删除此文件夹及其全部文件？无法撤销。','Delete this folder and all its files? This cannot be undone.')))return;
  try{await api('/api/file-manager/folders/'+removeFolder.dataset.deleteFolder,{method:'DELETE'});await load();}catch(error){message(error.message);}
  return;
 }
 const f=e.target.closest('[data-folder]');if(f){folder=f.dataset.folder;page=1;load();return;}
 const b=e.target.closest('[data-delete]');if(!b||!confirm(t('确定删除此文件？','Delete this file?')))return;
 try{await api('/api/file-manager/'+b.dataset.delete,{method:'DELETE'});await load();}catch(e){message(e.message);}
});
$('new').addEventListener('click',async()=>{
 const name=prompt(t('文件夹名称','Folder name'));if(!name)return;
 try{await api('/api/file-manager/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...params(),name})});await load();}catch(e){message(e.message);}
});
$('upload').addEventListener('change',async()=>{
 const selected=Array.from($('upload').files);if(!selected.length)return;
 const destination=params();setBusy(true);
 try{
  for(let i=0;i<selected.length;i++){
   message(t(`正在上传 ${i+1}/${selected.length}：${selected[i].name}`,`Uploading ${i+1}/${selected.length}: ${selected[i].name}`));
   const form=new FormData();Object.entries(destination).forEach(([k,v])=>form.append(k,v));form.append('file',selected[i]);
   try{await api('/api/file-manager/upload',{method:'POST',body:form});}
   catch(error){
    if(error.status!==409)throw error;
    if(!confirm(t(`已有同名文件 ${selected[i].name}，是否覆盖？`,`Replace existing file ${selected[i].name}?`)))continue;
    form.set('overwrite','1');
    await api('/api/file-manager/upload',{method:'POST',body:form});
   }
  }
  await load();
 }catch(e){message(e.message);}finally{setBusy(false);$('upload').value='';$('prev').disabled=page<=1;$('next').disabled=page*100>=total;$('up').disabled=!folder;}
});
App.ready(async()=>{try{
 data=await api('/api/file-manager/scopes');
 if(initial.get('scope')==='workgroup')$('scope').value='workgroup';owners();
 if(initial.has('owner_id'))$('owner').value=initial.get('owner_id');
 if(initial.has('stage'))$('stage').value=initial.get('stage');
 await load();
}catch(e){message(e.message);}});
})();
