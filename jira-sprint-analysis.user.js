// ==UserScript==
// @name         Jira Sprint Analysis
// @namespace    https://github.com/taomorrow/jira-sprint-analysis
// @version      0.1.1
// @description  按 Sprint 对比昨日与今日状态，查看变化明细并导出 CSV。
// @author       taomorrow
// @match        https://jira.xpaas.lenovo.com/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/taomorrow/jira-sprint-analysis
// @downloadURL  https://raw.githubusercontent.com/taomorrow/jira-sprint-analysis/main/jira-sprint-analysis.user.js
// @updateURL    https://raw.githubusercontent.com/taomorrow/jira-sprint-analysis/main/jira-sprint-analysis.user.js
// ==/UserScript==
(function () {
  'use strict';
  const NONE = '∅';
  function sprints(value) {
    return (Array.isArray(value) ? value : value ? [value] : []).map(v => {
      if (typeof v === 'object' && v !== null) {
        if (!/^\d+$/.test(String(v.id))) throw new Error('Sprint ID 无效');
        return { id: String(v.id), name: v.name || String(v.id), state: v.state || '' };
      }
      const id = /\bid=(\d+)/.exec(v), name = /\bname=(.*?)(?=,\w+=|\]$)/.exec(v), state = /\bstate=([^,\]]+)/.exec(v);
      if (!id) throw new Error('无法识别 Sprint 字段格式，请反馈版本和字段格式。');
      return { id: id[1], name: name ? name[1] : id[1], state: state ? state[1] : '' };
    });
  }
  function statusAt(issue, cutoff, inclusive = true) {
    const created = Date.parse(issue.fields.created);
    if (!Number.isFinite(created)) throw new Error(`${issue.key}: 创建时间无效`);
    if (inclusive ? created > cutoff : created >= cutoff) return null;
    let status = { id: String(issue.fields.status.id), name: issue.fields.status.name };
    const histories = [...issue.changelog.histories].sort((a,b) => Date.parse(b.created)-Date.parse(a.created) || Number(b.id)-Number(a.id));
    for (const h of histories) {
      const time = Date.parse(h.created);
      if (!Number.isFinite(time)) throw new Error(`${issue.key}: 变更时间无效`);
      if (inclusive ? time <= cutoff : time < cutoff) continue;
      for (const item of [...h.items].reverse()) {
        if (item.field === 'status' || item.fieldId === 'status') {
          if (item.from == null || !item.fromString) throw new Error(`${issue.key}: 状态历史不完整`);
          status = { id: String(item.from), name: item.fromString };
        }
      }
    }
    return status;
  }
  function rate(a,b) { return a === 0 ? (b === 0 ? '—' : '新增') : `${((b-a)/a*100).toFixed(1)}%`; }
  function aggregate(issues, field, selected, cutoff, now) {
    const groups = new Map();
    for (const issue of issues) {
      const memberships = sprints(issue.fields[field]);
      const ids = memberships.length ? [...new Set(memberships.map(s=>s.id))] : [NONE];
      const before = statusAt(issue, cutoff, false), after = statusAt(issue, now);
      for (const id of ids.filter(id=>selected.includes(id))) {
        if (!groups.has(id)) groups.set(id, {id, name: memberships.find(s=>s.id===id)?.name || '未分配 Sprint', rows:new Map(), issues:[]});
        const g=groups.get(id);
        for (const [side,status] of [['before',before],['after',after]]) {
          if (!status) continue;
          if (!g.rows.has(status.id)) g.rows.set(status.id,{id:status.id,name:status.name,before:[],after:[]});
          g.rows.get(status.id)[side].push(issue);
        }
        g.issues.push({issue,before,after,changed:before?.id!==after?.id});
      }
    }
    return [...groups.values()];
  }
  function csvCell(v) { let s=String(v ?? ''); if (/^[\s]*[=+\-@]/.test(s)) s="'"+s; return '"'+s.replaceAll('"','""')+'"'; }
  function pageQuery(doc, href) {
    const url = new URL(href);
    // The visible advanced search editor takes precedence over an old saved-filter ID.
    for (const selector of ['#jqltextarea', 'textarea[name="jqlQuery"]', 'input[name="jql"]']) {
      const el = doc.querySelector(selector);
      let visible=!!el;
      for(let node=el;node && visible;node=node.parentElement){
        const style=doc.defaultView?.getComputedStyle(node);
        if(node.hidden || node.getAttribute('aria-hidden')==='true' || style?.display==='none' || style?.visibility==='hidden')visible=false;
      }
      if (visible && el.value?.trim() && !el.disabled) {
        return {jql:el.value.trim(), source:'当前页面 JQL'};
      }
    }
    const jql=url.searchParams.get('jql');
    if(jql?.trim()) return {jql:jql.trim(),source:'当前页面 URL JQL'};
    const key=/\/browse\/([A-Z][A-Z0-9_]*-\d+)/i.exec(url.pathname)?.[1];
    if(key) return {jql:'key = "'+key+'"',source:'当前任务页面'};
    const filter=url.searchParams.get('filter');
    if(filter && /^\d+$/.test(filter)) return {filter,source:'当前页面查询（从页面筛选器解析）'};
    throw new Error('无法识别当前页面的查询条件。请在 Jira 问题列表点击 Search，或切换 Advanced 后重新载入。');
  }
  const core = {sprints,statusAt,rate,aggregate,csvCell,pageQuery};
  if (typeof module === 'object' && module.exports) { module.exports = core; return; }
  if (document.getElementById('jsa-host')) return;
  const host=document.createElement('div'); host.id='jsa-host'; document.body.append(host);
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
  :host{all:initial;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172b4d}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #c9d3e0;border-radius:6px;background:white;color:#172b4d;padding:7px 12px}button:hover{background:#edf3ff}.primary:hover,#launch:hover{background:#0747a6}#close{white-space:nowrap}button:disabled{opacity:.5;cursor:wait}.primary,#launch{background:#0052cc;color:white;border-color:#0052cc}#launch{position:fixed;right:24px;bottom:24px;z-index:2147483646;box-shadow:0 5px 20px #091e4240}#overlay{position:fixed;inset:0;background:#091e4260;z-index:2147483647;padding:3vh 3vw;display:none}#panel{background:#f7f9fc;border-radius:14px;max-width:1280px;margin:auto;height:94vh;overflow:auto;box-shadow:0 20px 80px #091e4255;padding:24px}header{display:flex;align-items:center;justify-content:space-between}h1{font-size:24px;margin:0}h2{font-size:17px;margin:0 0 12px}.muted{color:#5e6c84}p{margin:8px 0}.controls{display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin:18px 0}label{display:flex;flex-direction:column;gap:5px}input,select{border:1px solid #b3bfd0;border-radius:5px;padding:7px;background:white;color:#172b4d}#sprints{min-width:330px;max-width:100%;height:115px}.card{overflow-x:auto;background:white;border:1px solid #dfe5ed;border-radius:9px;margin:16px 0;padding:18px}.notice{padding:10px 14px;background:#eaf1ff;border-radius:6px}#message{white-space:pre-wrap}#message.error{background:#fff0ed;color:#ae2a19;padding:12px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;border-bottom:1px solid #e8ecf2;padding:9px 10px}th{background:#f4f6fa;color:#5e6c84}td button{border:0;padding:0;color:#0052cc;background:none;text-decoration:underline}.delta{font-variant-numeric:tabular-nums;font-weight:600}a{color:#0052cc}#detail{overflow:auto}small{font-size:12px}@media(max-width:650px){#panel{padding:14px}.controls{display:block}label{margin:10px 0}#sprints{min-width:0;width:100%}th,td{padding:6px}h1{font-size:20px}}
  </style><button id="launch">◷ Sprint Analysis</button><div id="overlay"><section id="panel" role="dialog" aria-modal="true" aria-label="Sprint Analysis"><header><div><h1>Sprint Analysis <small class="muted">v0.1.1</small></h1><p class="muted">昨日日终 → 今日截至查询时 · Asia/Shanghai（UTC+08:00）</p></div><button id="close" aria-label="关闭">关闭</button></header>
  <div class="notice">口径：以本次查询匹配的成员回溯昨日状态；不还原历史 Sprint 成员或历史筛选条件。已关闭 Sprint 也可能保留在任务 Sprint 字段中；同一任务可出现在多个 Sprint，各 Sprint 不可直接相加。</div>
  <div class="controls"><button id="load">载入当前页面（全部分页）</button><label>Sprint（可多选，Ctrl / ⌘）<select id="sprints" multiple aria-label="Sprint"></select></label><button id="run" class="primary">开始分析</button><button id="export" disabled>导出 CSV</button></div>
  <p class="muted">统计当前页面查询的全部分页，不扩大到整个 Sprint。修改 Jira 搜索条件后请先点击 Search，再重新载入。若页面排除了已解决任务，完成数量也会受限。</p><p id="message" role="status">点击“载入当前页面”读取全部结果；本工具只读取 Jira，不修改任务。</p><div id="results"></div><div id="detail"></div></section></div>`;
  const $=id=>root.getElementById(id); let field, groups=[], busy=false, reportMeta='', loadedQuery='';
  const message=(s,error=false)=>{ $('message').textContent=s; $('message').className=error?'error':''; };
  function text(tag,content,parent){const e=document.createElement(tag); e.textContent=content; parent.append(e); return e;}
  async function api(path) {
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),30000);
    try {
      const res=await fetch(path,{credentials:'same-origin',headers:{Accept:'application/json'},signal:controller.signal});
      if (!res.ok) throw new Error(`Jira HTTP ${res.status}：${res.status===401||res.status===403?'请先登录并确认筛选器/任务访问权限。':'请求失败，请稍后重试或检查接口权限。'}`);
      if (!res.headers.get('content-type')?.includes('application/json')) throw new Error('Jira 返回了登录页或非 JSON 内容，请先登录 Jira 后重试。');
      return await res.json();
    } finally {clearTimeout(timeout);}
  }
  async function currentQuery(){
    const query=pageQuery(document,location.href);
    if(query.jql)return query.jql;
    const data=await api('/rest/api/2/filter/'+query.filter);
    if(!data.jql?.trim())throw new Error('当前页面未返回有效的 JQL，请切换 Advanced 后重新载入。');
    return data.jql.trim();
  }
  async function detectField(){
    if(field)return field;
    const fields=await api('/rest/api/2/field');
    const candidates=fields.filter(f=>f.schema?.custom==='com.pyxis.greenhopper.jira:gh-sprint');
    if(candidates.length!==1)throw new Error('无法唯一识别 Sprint 自定义字段，请向维护者反馈 /rest/api/2/field 中的 Sprint 字段定义。');
    return field=candidates[0].id;
  }
  async function search(jql){
    let start=0,total,all=[]; const seen=new Set();
    do {
      const params=new URLSearchParams({jql,fields:`summary,status,created,updated,${field}`,startAt:String(start),maxResults:'100'});
      const page=await api('/rest/api/2/search?'+params);
      if(!Array.isArray(page.issues)||!Number.isFinite(page.total))throw new Error('搜索接口响应格式不支持');
      if(total!==undefined&&total!==page.total)throw new Error('查询过程中任务数量发生变化，请重试以免分页遗漏。');
      total=page.total;
      if(!page.issues.length && start<total)throw new Error('分页提前结束，已停止统计以避免遗漏。');
      for(const issue of page.issues){if(seen.has(issue.key))throw new Error('分页出现重复任务，请重试。');seen.add(issue.key);all.push(issue);}
      start+=page.issues.length;message(`读取任务 ${start} / ${total}…`);
    }while(start<total);
    return all;
  }
  async function history(issue){
    const params=new URLSearchParams({fields:`summary,status,created,updated,${field}`,expand:'changelog'});
    const full=await api('/rest/api/2/issue/'+encodeURIComponent(issue.key)+'?'+params);
    // The issue detail is authoritative. Search-index timestamps can differ or lag.
    // Never infer an actual user edit from a raw updated-string mismatch.
    let c=full.changelog;
    if(!c||!Array.isArray(c.histories)||!Number.isFinite(c.total))throw new Error(`${issue.key} 未返回可验证完整性的变更历史。`);
    if((c.startAt||0)!==0||c.histories.length!==c.total){
      let histories=[],start=0,total;
      do {
        let p;try{p=await api('/rest/api/2/issue/'+encodeURIComponent(issue.key)+'/changelog?startAt='+start+'&maxResults=100');}catch{throw new Error(`${issue.key} 历史被截断，且服务器不支持完整历史分页；本次结果不生成。`);}
        const values=p.values||p.histories;
        if(!Array.isArray(values)||!Number.isFinite(p.total)||(total!==undefined&&p.total!==total)||(!values.length&&start<p.total))throw new Error(`${issue.key} 历史分页不完整，请重试。`);
        total=p.total;histories.push(...values);start+=values.length;
      }while(start<total);
      if(new Set(histories.map(h=>h.id)).size!==total)throw new Error(`${issue.key} 历史分页重复或缺失。`);
      c=full.changelog={histories,total};
    }
    return full;
  }
  async function guard(job){
    if(busy)return;busy=true;const controls=['load','run','sprints'];controls.forEach(id=>$(id).disabled=true);$('export').disabled=true;
    groups=[];$('results').replaceChildren();$('detail').replaceChildren();
    try{await job();}catch(e){message(e.name==='AbortError'?'请求超过 30 秒，请检查网络或 VPN 后重试。':e.message,true);}finally{busy=false;controls.forEach(id=>$(id).disabled=false);$('export').disabled=!groups.length;}
  }
  function selected(){return [...$('sprints').selectedOptions].map(o=>o.value);}
  async function load(){
    loadedQuery='';$('sprints').replaceChildren();
    await detectField();const query=await currentQuery(), issues=await search(query), map=new Map();
    for(const i of issues){const list=sprints(i.fields[field]);if(!list.length)map.set(NONE,{id:NONE,name:'未分配 Sprint',state:''});for(const s of list)map.set(s.id,s);}
    $('sprints').replaceChildren();
    const options=[...map.values()].sort((a,b)=>(/active/i.test(b.state)?1:0)-(/active/i.test(a.state)?1:0)||b.name.localeCompare(a.name));
    for(const s of options){const o=document.createElement('option');o.value=s.id;o.textContent=`${s.name}${s.state?' · '+s.state:''} [${s.id}]`;o.selected=/^active$/i.test(s.state);$('sprints').append(o);}
    if(!selected().length&&$('sprints').options.length)$('sprints').options[0].selected=true;
    loadedQuery=query;
    message(`已读取当前页面全部 ${issues.length} 条任务、${options.length} 个 Sprint 分组。可多选后分析。\nJQL：${loadedQuery}${issues.length?'':'（当前页面没有可见任务）'}`);
  }
  function details(title,items){
    const box=$('detail');box.replaceChildren();box.className='card';text('h2',title,box);
    const table=document.createElement('table');box.append(table);const tr=document.createElement('tr');table.append(tr);['Issue','摘要','昨日 → 今日'].forEach(h=>text('th',h,tr));
    for(const x of items){const row=document.createElement('tr');table.append(row);const td=document.createElement('td');row.append(td);const a=text('a',x.issue.key,td);a.href='/browse/'+encodeURIComponent(x.issue.key);a.target='_blank';a.rel='noopener noreferrer';text('td',x.issue.fields.summary,row);text('td',`${x.before?.name||'尚未创建'} → ${x.after?.name||'尚未创建'}`,row);}
    if(!items.length)text('p','没有对应任务。',box);
    box.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function render(){
    const result=$('results');result.replaceChildren();text('p',reportMeta,result);
    for(const g of groups){
      const card=document.createElement('section');card.className='card';result.append(card);text('h2',g.name+' · '+g.id,card);
      const changes=g.issues.filter(x=>x.changed), created=g.issues.filter(x=>!x.before&&x.after);
      const detail=text('button',`查看变化 ${changes.length} 条（今日创建 ${created.length} 条）`,card);detail.onclick=()=>details(g.name+' · 净状态变化 / 新建任务',changes);
      const table=document.createElement('table');card.append(table);const head=document.createElement('tr');table.append(head);['状态','昨日','今日','增减','日环比'].forEach(h=>text('th',h,head));
      const rows=[...g.rows.values()].sort((a,b)=>a.name.localeCompare(b.name));
      rows.push({name:'合计',before:g.issues.filter(x=>x.before).map(x=>x.issue),after:g.issues.filter(x=>x.after).map(x=>x.issue)});
      for(const r of rows){const tr=document.createElement('tr');table.append(tr);text('td',r.name,tr);for(const side of ['before','after']){const td=document.createElement('td');tr.append(td);const b=text('button',String(r[side].length),td);b.onclick=()=>{const keys=new Set(r[side].map(i=>i.key));details(`${g.name} · ${r.name} · ${side==='before'?'昨日':'今日'}`,g.issues.filter(x=>keys.has(x.issue.key)));};}const delta=r.after.length-r.before.length;text('td',(delta>0?'+':'')+delta,tr).className='delta';text('td',rate(r.before.length,r.after.length),tr);}
    }
  }
  async function run(){
    const ids=selected();if(!ids.length)throw new Error('请先载入并选择 Sprint。');await detectField();
    const jql=await currentQuery();
    if(jql!==loadedQuery)throw new Error('当前页面查询已改变，请重新“载入当前页面”后再分析。');
    const now=Date.now(), date=new Date(now+8*3600000).toISOString().slice(0,10), cutoff=Date.parse(date+'T00:00:00+08:00');
    const issues=await search(jql), full=new Array(issues.length);let cursor=0,done=0,failed;
    await Promise.all(Array.from({length:Math.min(3,issues.length)},async()=>{while(cursor<issues.length&&!failed){const i=cursor++;try{full[i]=await history(issues[i]);message(`读取完整历史 ${++done} / ${issues.length}…`);}catch(e){failed=e;}}}));
    if(failed)throw failed;
    const calculated=aggregate(full,field,ids,cutoff,now);
    reportMeta=`查询开始 ${new Date(now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（上海）｜昨日截止：${date} 00:00 之前｜当前页面全部分页｜JQL：${jql}｜当前成员回溯`;
    groups=calculated;render();message(`分析完成：${issues.length} 条任务，${groups.length} 个分组。任务范围来自当前页面全部分页；状态与历史以任务详情为准。未持久保存任务数据。`);
  }
  $('load').onclick=()=>guard(load);$('run').onclick=()=>guard(run);
  let lastFocus;
  $('launch').onclick=()=>{lastFocus=document.activeElement;$('overlay').style.display='block';$('close').focus();};
  const close=()=>{$('overlay').style.display='none';lastFocus?.focus();};$('close').onclick=close;
  root.addEventListener('keydown',e=>{if(e.key==='Escape')close();if(e.key==='Tab'&&$('overlay').style.display==='block'){const nodes=[...$('panel').querySelectorAll('button,input,select,a')].filter(x=>!x.disabled);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&root.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&root.activeElement===last){e.preventDefault();first.focus();}}});
  $('export').onclick=()=>{
    const rows=[['统计说明',reportMeta],['Sprint ID','Sprint','状态','昨日','今日','增减','日环比']];
    for(const g of groups){const stats=[...g.rows.values(),{name:'合计',before:g.issues.filter(x=>x.before),after:g.issues.filter(x=>x.after)}];for(const r of stats)rows.push([g.id,g.name,r.name,r.before.length,r.after.length,r.after.length-r.before.length,rate(r.before.length,r.after.length)]);}
    const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='jira-sprint-analysis-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
})();
