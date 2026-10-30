// ==UserScript==
// @name         Jira Sprint Analysis
// @namespace    https://github.com/taomorrow/jira-sprint-analysis
// @version      0.1.5
// @description  按 Sprint 对比昨日与今日状态，查看变化明细并导出 CSV。
// @author       taomorrow
// @match        https://jira.xpaas.lenovo.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      *.logic.azure.com
// @connect      *.api.powerplatform.com
// @connect      *.api.powerautomate.com
// @run-at       document-idle
// @homepageURL  https://github.com/taomorrow/jira-sprint-analysis
// @downloadURL  https://raw.githubusercontent.com/taomorrow/jira-sprint-analysis/main/jira-sprint-analysis.user.js
// @updateURL    https://raw.githubusercontent.com/taomorrow/jira-sprint-analysis/main/jira-sprint-analysis.user.js
// ==/UserScript==
(function () {
  'use strict';
  const NONE = '∅';
  const STATUS_NAMES=['Completed','DEPLOYED','Grooming','In Progress','New','Open','Ready For Deploy','Ready For Test','Ready For UAT','SIT','Testing','UAT'];
  const normalized=name=>String(name||'').trim().replace(/\s+/g,' ').toLowerCase();
  function comparisonPeriod(now,mode='day'){
    const day=86400000,offset=8*3600000;
    const date=t=>new Date(t+offset).toISOString().slice(0,10);
    const midnight=Date.parse(date(now)+'T00:00:00+08:00');
    if(mode==='week'){
      const weekday=new Date(midnight+offset).getUTCDay();
      const monday=midnight-((weekday+6)%7)*day;
      return {cutoff:monday,before:'上周日终',after:'本周截至当前',rate:'周环比',created:'本周创建',
        description:`By week｜上周 ${date(monday-7*day)}～${date(monday-day)}（周日结束时） → 本周 ${date(monday)}～${date(monday+6*day)}（截至当前，未满周）`};
    }
    return {cutoff:midnight,before:'昨日日终',after:'今日截至当前',rate:'日环比',created:'今日创建',
      description:`By day｜昨日 ${date(midnight-day)}（日终） → 今日 ${date(now)}（截至当前）`};
  }
  function selectStatusGroups(source,selection){
    const names=selection===null?STATUS_NAMES:STATUS_NAMES.filter(n=>selection.includes(normalized(n)));
    const allowed=new Map(names.map(n=>[normalized(n),n]));
    return source.map(g=>{
      const rows=new Map();
      for(const row of g.rows.values()){
        const key=normalized(row.name);if(!allowed.has(key))continue;
        if(!rows.has(key))rows.set(key,{id:key,name:allowed.get(key),before:[],after:[]});
        rows.get(key).before.push(...row.before);rows.get(key).after.push(...row.after);
      }
      if(selection!==null)for(const [id,name] of allowed)if(!rows.has(id))rows.set(id,{id,name,before:[],after:[]});
      return {...g,rows,issues:g.issues.filter(x=>allowed.has(normalized(x.before?.name))||allowed.has(normalized(x.after?.name)))};
    });
  }
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
  function matchesSprint(issue,field,ids){
    const list=sprints(issue.fields[field]);
    return list.length ? list.some(x=>ids.includes(x.id)) : ids.includes(NONE);
  }
  function filterGroups(source,statusIds){
    if(statusIds===null)return source;
    const allowed=new Set(statusIds);
    return source.map(g=>({...g,rows:new Map([...g.rows].filter(([id])=>allowed.has(id))),
      issues:g.issues.filter(x=>allowed.has(x.before?.id)||allowed.has(x.after?.id))}));
  }
  function rowsWithTotal(g){
    const rows=[...g.rows.values()].sort((a,b)=>a.name.localeCompare(b.name));
    return [...rows,{name:'所选状态合计',before:rows.flatMap(r=>r.before),after:rows.flatMap(r=>r.after)}];
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
  function validateTeamsUrl(value){
    let u;try{u=new URL(String(value).trim());}catch{throw new Error('请输入有效的 Teams Workflows HTTPS Webhook 地址。');}
    const allowed=['logic.azure.com','api.powerplatform.com','api.powerautomate.com'];
    if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port||!allowed.some(h=>u.hostname.endsWith('.'+h))||!u.pathname.includes('/workflows/'))throw new Error('仅支持微软 Teams Workflows 的 HTTPS 地址（logic.azure.com / api.powerplatform.com / api.powerautomate.com），不支持旧版 Connector。');
    return u.href;
  }
  function buildTeamsReport(groups,meta,period,jiraUrl){
    const body=[{type:'TextBlock',text:'Jira Sprint Analysis',size:'Large',weight:'Bolder',wrap:true},
      {type:'TextBlock',text:meta,wrap:true,size:'Small'},
      {type:'TextBlock',text:'口径：当前成员回溯；仅包含所选状态。'+period.description,wrap:true,size:'Small'}];
    const lines=['Jira Sprint Analysis',meta,'口径：当前成员回溯；仅包含所选状态。'+period.description];
    for(const g of groups){
      body.push({type:'TextBlock',text:g.name+' ['+g.id+']',weight:'Bolder',wrap:true,separator:true});
      lines.push('',g.name+' ['+g.id+']');
      const changes=g.issues.filter(x=>x.changed).length,created=g.issues.filter(x=>!x.before&&x.after).length;
      const summary=`净状态变化 ${changes} 条；${period.created} ${created} 条`;
      body.push({type:'TextBlock',text:summary,wrap:true});lines.push(summary);
      const header=`状态｜${period.before} → ${period.after}｜增减｜${period.rate}`;
      body.push({type:'TextBlock',text:header,weight:'Bolder',wrap:true});lines.push(header);
      for(const r of rowsWithTotal(g)){
        const a=r.before.length,b=r.after.length,d=b-a;
        const row=`${r.name}｜${a} → ${b}｜${d>0?'+':''}${d}｜${rate(a,b)}`;
        body.push({type:'TextBlock',text:row,wrap:true,spacing:'Small'});lines.push(row);
      }
    }
    // No issue titles, assignees or changelogs are sent.
    const payload={type:'message',attachments:[{contentType:'application/vnd.microsoft.card.adaptive',contentUrl:null,content:{$schema:'http://adaptivecards.io/schemas/adaptive-card.json',type:'AdaptiveCard',version:'1.2',body,actions:[{type:'Action.OpenUrl',title:'打开 Jira 查询',url:jiraUrl}]}}]};
    return {payload,preview:lines.join('\n')+'\n\n打开 Jira 查询：'+jiraUrl};
  }
  const core = {sprints,statusAt,rate,aggregate,csvCell,pageQuery,matchesSprint,filterGroups,rowsWithTotal,STATUS_NAMES,normalized,comparisonPeriod,selectStatusGroups,validateTeamsUrl,buildTeamsReport};
  if (typeof window === 'undefined' && typeof module === 'object' && module.exports) { module.exports = core; return; }
  // An older duplicate userscript may run first. Replace its panel rather than silently exiting.
  const existing=document.getElementById('jsa-host');
  if(existing){
    const previous=existing.dataset.jsaVersion||existing.shadowRoot?.querySelector('h1 small')?.textContent?.replace(/^v/,'')||'0.0.0';
    const parts=v=>v.split('.').map(Number),a=parts(previous),b=parts('0.1.5');
    const comparison=a.reduce((r,n,i)=>r||n-(b[i]||0),0);
    if(comparison>=0)return;
    existing.remove();
  }
  const host=document.createElement('div'); host.id='jsa-host';host.dataset.jsaVersion='0.1.5'; document.body.append(host);
  const root=host.attachShadow({mode:'open'});
  root.innerHTML=`<style>
  :host{all:initial;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172b4d}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;border:1px solid #c9d3e0;border-radius:6px;background:white;color:#172b4d;padding:7px 12px}button:hover{background:#edf3ff}.primary:hover,#launch:hover{background:#0747a6}#close{white-space:nowrap}button:disabled{opacity:.5;cursor:wait}.primary,#launch{background:#0052cc;color:white;border-color:#0052cc}#launch{position:fixed;right:24px;bottom:24px;z-index:2147483646;box-shadow:0 5px 20px #091e4240}#overlay{position:fixed;inset:0;background:#091e4260;z-index:2147483647;padding:3vh 3vw;display:none}#panel{background:#f7f9fc;border-radius:14px;max-width:1280px;margin:auto;height:94vh;overflow:auto;box-shadow:0 20px 80px #091e4255;padding:24px}header{display:flex;align-items:center;justify-content:space-between}h1{font-size:24px;margin:0}h2{font-size:17px;margin:0 0 12px}.muted{color:#5e6c84}p{margin:8px 0}.controls{display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin:18px 0}label{display:flex;flex-direction:column;gap:5px}input,select{border:1px solid #b3bfd0;border-radius:5px;padding:7px;background:white;color:#172b4d}fieldset{margin:0;border:1px solid #b3bfd0;border-radius:6px;padding:8px;background:white;min-width:280px;max-width:100%}.choices{height:140px;overflow:auto;max-width:430px}.choices label{display:flex;flex-direction:row;align-items:center;gap:8px;padding:3px;cursor:pointer}.choices input{margin:0}.tools{display:flex;gap:8px;margin-bottom:5px}.tools button{padding:2px 8px}legend{padding:0 5px}.card{overflow-x:auto;background:white;border:1px solid #dfe5ed;border-radius:9px;margin:16px 0;padding:18px}.notice{padding:10px 14px;background:#eaf1ff;border-radius:6px}#message{white-space:pre-wrap}#message.error{background:#fff0ed;color:#ae2a19;padding:12px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;border-bottom:1px solid #e8ecf2;padding:9px 10px}th{background:#f4f6fa;color:#5e6c84}td button{border:0;padding:0;color:#0052cc;background:none;text-decoration:underline}.delta{font-variant-numeric:tabular-nums;font-weight:600}a{color:#0052cc}#detail{overflow:auto}small{font-size:12px}@media(max-width:650px){#panel{padding:14px}.controls{display:block}label{margin:10px 0}#sprints{min-width:0;width:100%}th,td{padding:6px}h1{font-size:20px}}
  </style><button id="launch">◷ Sprint Analysis v0.1.5</button><div id="overlay"><section id="panel" role="dialog" aria-modal="true" aria-label="Sprint Analysis"><header><div><h1>Sprint Analysis <small class="muted">v0.1.5</small></h1><p class="muted"><span id="period-description"></span> · Asia/Shanghai（UTC+08:00）</p></div><button id="close" aria-label="关闭">关闭</button></header>
  <div class="notice">口径：以本次查询匹配的成员回溯对比时点的状态；不还原历史 Sprint 成员或历史筛选条件。已关闭 Sprint 也可能保留在任务 Sprint 字段中；同一任务可出现在多个 Sprint，各 Sprint 不可直接相加。</div>
  <div class="controls"><label>对比维度<select id="period"><option value="day">By day · 昨天 / 今天</option><option value="week">By week · 上周 / 本周（周一至周日）</option></select></label><button id="load">载入当前页面（全部分页）</button><fieldset id="sprint-box"><legend>Sprint（勾选，可多选）</legend><div class="tools"><button id="sprint-all" type="button">全选</button><button id="sprint-none" type="button">清空</button></div><div id="sprints" class="choices"></div></fieldset><fieldset id="status-box"><legend>状态（默认全部，可多选）</legend><label><input type="checkbox" id="status-all" checked>全部指定状态（以下 12 个）</label><p class="muted">直接勾选下面的状态即可切换为指定状态。</p><div id="statuses" class="choices"></div></fieldset><button id="run" class="primary">开始分析</button><button id="export" disabled>导出 CSV</button><button id="teams-config">Teams 配置</button><button id="teams-preview" disabled>预览并推送到 Teams</button></div>
  <p class="muted">统计当前页面查询的全部分页，不扩大到整个 Sprint。修改 Jira 搜索条件后请先点击 Search，再重新载入。若页面排除了已解决任务，完成数量也会受限。</p><p id="message" role="status">点击“载入当前页面”读取全部结果；本工具只读取 Jira，不修改任务。</p><div id="results"></div><div id="detail"></div></section></div>`;
  const teamsDialog=document.createElement('div');teamsDialog.id='teams-dialog';teamsDialog.setAttribute('role','dialog');teamsDialog.setAttribute('aria-modal','true');teamsDialog.style.cssText='display:none;position:fixed;inset:0;background:#091e4280;z-index:2147483647;padding:4vh 4vw;overflow:auto';
  const teamsBox=document.createElement('section');teamsBox.className='card';teamsBox.style.cssText='max-width:900px;margin:0 auto;padding:24px;max-height:90vh;overflow:auto';teamsDialog.append(teamsBox);root.append(teamsDialog);
  const $=id=>root.getElementById(id); let field, groups=[], busy=false, reportMeta='', loadedQuery='', reportJiraUrl='', activePeriod=comparisonPeriod(Date.now());
  $('period-description').textContent=activePeriod.description;
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
    if(busy)return;busy=true;const controls=['load','run','sprint-box','status-box','period'];controls.forEach(id=>$(id).disabled=true);$('export').disabled=true;$('teams-preview').disabled=true;
    groups=[];$('results').replaceChildren();$('detail').replaceChildren();
    try{await job();}catch(e){message(e.name==='AbortError'?'请求超过 30 秒，请检查网络或 VPN 后重试。':e.message,true);}finally{busy=false;controls.forEach(id=>$(id).disabled=false);$('export').disabled=!groups.length;$('teams-preview').disabled=!groups.length;}
  }
  function selected(){return [...$('sprints').querySelectorAll('input:checked')].map(o=>o.value);}
  function selectedStatuses(){return $('status-all').checked?null:[...$('statuses').querySelectorAll('input:checked')].map(o=>o.value);}
  function choice(parent,id,name,checked){
    const label=document.createElement('label'), input=document.createElement('input');input.type='checkbox';input.value=id;input.checked=checked;label.append(input,document.createTextNode(name));parent.append(label);
  }
  function invalidate(){if(busy)return;groups=[];$('results').replaceChildren();$('detail').replaceChildren();$('export').disabled=true;$('teams-preview').disabled=true;message(`已选择 ${selected().length} 个 Sprint；状态：${$('status-all').checked?'全部':selectedStatuses().length+' 项'}。请点击“开始分析”。`);}
  $('period').onchange=()=>{$('period-description').textContent=comparisonPeriod(Date.now(),$('period').value).description;invalidate();};
  $('sprints').onchange=invalidate;
  $('statuses').onchange=()=>{$('status-all').checked=false;invalidate();};
  $('status-all').onchange=()=>{for(const x of $('statuses').querySelectorAll('input'))x.checked=false;invalidate();};
  for(const [id,checked] of [['sprint-all',true],['sprint-none',false]])$(id).onclick=()=>{for(const x of $('sprints').querySelectorAll('input'))x.checked=checked;invalidate();};
  async function load(){
    loadedQuery='';$('sprints').replaceChildren();
    await detectField();const query=await currentQuery(), issues=await search(query), map=new Map();
    for(const i of issues){const list=sprints(i.fields[field]);if(!list.length)map.set(NONE,{id:NONE,name:'未分配 Sprint',state:''});for(const s of list)map.set(s.id,s);}
    $('sprints').replaceChildren();
    const options=[...map.values()].sort((a,b)=>(/active/i.test(b.state)?1:0)-(/active/i.test(a.state)?1:0)||b.name.localeCompare(a.name));
    for(const s of options)choice($('sprints'),s.id,`${s.name}${s.state?' · '+s.state:''} [${s.id}]`,/^active$/i.test(s.state));
    if(!selected().length&&$('sprints').querySelector('input'))$('sprints').querySelector('input').checked=true;
    $('statuses').replaceChildren();$('status-all').checked=true;
    for(const name of STATUS_NAMES)choice($('statuses'),normalized(name),name,false);
    loadedQuery=query;
    message(`已读取当前页面全部 ${issues.length} 条任务、${options.length} 个 Sprint 分组。可多选后分析。\nJQL：${loadedQuery}${issues.length?'':'（当前页面没有可见任务）'}`);
  }
  function details(title,items){
    const box=$('detail');box.replaceChildren();box.className='card';text('h2',title,box);
    const table=document.createElement('table');box.append(table);const tr=document.createElement('tr');table.append(tr);['Issue','摘要',activePeriod.before+' → '+activePeriod.after].forEach(h=>text('th',h,tr));
    for(const x of items){const row=document.createElement('tr');table.append(row);const td=document.createElement('td');row.append(td);const a=text('a',x.issue.key,td);a.href='/browse/'+encodeURIComponent(x.issue.key);a.target='_blank';a.rel='noopener noreferrer';text('td',x.issue.fields.summary,row);text('td',`${x.before?.name||'尚未创建'} → ${x.after?.name||'尚未创建'}`,row);}
    if(!items.length)text('p','没有对应任务。',box);
    box.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function render(){
    const result=$('results');result.replaceChildren();text('p',reportMeta,result);
    for(const g of groups){
      const card=document.createElement('section');card.className='card';result.append(card);text('h2',g.name+' · '+g.id,card);
      const changes=g.issues.filter(x=>x.changed), created=g.issues.filter(x=>!x.before&&x.after);
      const detail=text('button',`查看变化 ${changes.length} 条（${activePeriod.created} ${created.length} 条）`,card);detail.onclick=()=>details(g.name+' · 净状态变化 / 新建任务',changes);
      const table=document.createElement('table');card.append(table);const head=document.createElement('tr');table.append(head);['状态',activePeriod.before,activePeriod.after,'增减',activePeriod.rate].forEach(h=>text('th',h,head));
      const rows=rowsWithTotal(g);
      for(const r of rows){const tr=document.createElement('tr');table.append(tr);text('td',r.name,tr);for(const side of ['before','after']){const td=document.createElement('td');tr.append(td);const b=text('button',String(r[side].length),td);b.onclick=()=>{const keys=new Set(r[side].map(i=>i.key));details(`${g.name} · ${r.name} · ${side==='before'?activePeriod.before:activePeriod.after}`,g.issues.filter(x=>keys.has(x.issue.key)));};}const delta=r.after.length-r.before.length;text('td',(delta>0?'+':'')+delta,tr).className='delta';text('td',rate(r.before.length,r.after.length),tr);}
    }
  }
  async function run(){
    const ids=selected();if(!ids.length)throw new Error('请先载入并选择 Sprint。');await detectField();
    const statusIds=selectedStatuses();if(statusIds!==null&&!statusIds.length)throw new Error('请至少选择一个状态，或勾选全部状态。');
    const jql=await currentQuery();
    if(jql!==loadedQuery)throw new Error('当前页面查询已改变，请重新“载入当前页面”后再分析。');
    const now=Date.now();activePeriod=comparisonPeriod(now,$('period').value);const cutoff=activePeriod.cutoff;
    $('period-description').textContent=activePeriod.description;
    const pageIssues=await search(jql), issues=pageIssues.filter(i=>matchesSprint(i,field,ids)), full=new Array(issues.length);let cursor=0,done=0,failed;
    await Promise.all(Array.from({length:Math.min(3,issues.length)},async()=>{while(cursor<issues.length&&!failed){const i=cursor++;try{full[i]=await history(issues[i]);message(`读取完整历史 ${++done} / ${issues.length}…`);}catch(e){failed=e;}}}));
    if(failed)throw failed;
    const scoped=full.filter(i=>matchesSprint(i,field,ids));
    const allGroups=aggregate(scoped,field,ids,cutoff,now);
    const calculated=selectStatusGroups(allGroups,statusIds);
    const stateNames=statusIds===null?'全部指定的 12 个状态':[...$('statuses').querySelectorAll('input:checked')].map(x=>x.parentElement.textContent).join('、');
    reportMeta=`查询开始 ${new Date(now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}（上海）｜${activePeriod.description}｜当前页面全部分页｜JQL：${jql}｜所选 Sprint：${ids.join("、")}｜状态：${stateNames}｜当前成员回溯`;
    reportJiraUrl=location.origin+'/issues/?'+new URLSearchParams({jql});
    groups=calculated;render();message(`分析完成：页面共 ${pageIssues.length} 条；所选 Sprint 匹配 ${scoped.length} 条；所选状态涉及 ${new Set(groups.flatMap(g=>g.issues.map(x=>x.issue.key))).size} 条，${groups.length} 个 Sprint 分组。合计仅包含所选状态。`);
  }
  let teamsSending=false,teamsFocus;
  function openTeams(title){
    teamsFocus=root.activeElement||document.activeElement;teamsBox.replaceChildren();text('h2',title,teamsBox);teamsDialog.style.display='block';teamsDialog.setAttribute('aria-label',title);
  }
  function closeTeams(){if(teamsSending)return;teamsDialog.style.display='none';teamsBox.replaceChildren();teamsFocus?.focus();}
  function teamsButton(id,label,action){const b=text('button',label,teamsBox);b.id=id;b.style.margin='8px 8px 0 0';b.onclick=action;return b;}
  function teamsConfig(){
    if(teamsSending)return;
    openTeams('Teams 配置');
    text('p','使用 Teams Workflows 的“收到 Webhook 请求时发布到频道/聊天”模板。当前支持仅凭 Webhook URL 调用的工作流；不支持要求 Microsoft OAuth 令牌的触发器。',teamsBox);
    text('p','地址仅保存到当前油猴脚本存储；不会写入 GitHub，也不会自动发送消息。配置保存后不会进行联网测试。',teamsBox);
    const stored=typeof GM_getValue==='function'?GM_getValue('teams-config',{}):{};
    const label=text('label','目标名称（用于预览，例如项目日报频道）',teamsBox),name=document.createElement('input');name.id='teams-name';name.value=stored.name||'';name.maxLength=120;label.append(name);
    const urlLabel=text('label','Workflows Webhook URL',teamsBox),url=document.createElement('input');url.id='teams-url';url.type='password';url.autocomplete='off';url.spellcheck=false;url.value=stored.url||'';urlLabel.append(url);
    const status=text('p','',teamsBox);status.id='teams-config-status';status.setAttribute('role','status');
    teamsButton('teams-save','保存配置',()=>{try{
      const value=validateTeamsUrl(url.value);if(!name.value.trim())throw new Error('请填写目标名称，以便发送前核对。');
      if(typeof GM_setValue!=='function')throw new Error('请通过 Tampermonkey 安装此脚本，才能保存配置。');
      GM_setValue('teams-config',{name:name.value.trim(),url:value});status.textContent='配置已保存，仅本地存储；未发送任何消息。';
    }catch(e){status.textContent=e.message;}});
    teamsButton('teams-clear','清除配置',()=>{if(typeof GM_deleteValue==='function')GM_deleteValue('teams-config');name.value='';url.value='';status.textContent='本地 Teams 配置已清除。';});
    teamsButton('teams-cancel','关闭',closeTeams);name.focus();
  }
  function teamsPreview(){
    if(busy||teamsSending||!groups.length)return;
    const config=typeof GM_getValue==='function'?GM_getValue('teams-config',{}):{};
    if(!config.url){teamsConfig();return;}
    try{
      const destination=validateTeamsUrl(config.url);
      const report=buildTeamsReport(groups,reportMeta,activePeriod,reportJiraUrl);
      const data=JSON.stringify(report.payload),bytes=new TextEncoder().encode(data).length;
      if(bytes>26*1024)throw new Error('报告超过 Teams 单条消息大小限制，请减少所选 Sprint 后重试；未发送。');
      openTeams('Teams 推送预览');
      text('p','目标：'+config.name,teamsBox);
      // Keep the URL signature out of DOM preview and error messages.
      text('p','Webhook 主机：'+new URL(destination).hostname+'（密钥已隐藏；目标名称由本地配置提供）',teamsBox);
      text('p',`将发送当前报告的统计摘要、JQL 和 Jira 查询链接，共 ${bytes} 字节。不包含逐条任务标题、负责人或完整历史。以下是全部消息内容；Teams 卡片排版可能不同。`,teamsBox);
      const preview=text('pre',report.preview,teamsBox);preview.id='teams-preview-content';preview.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6fa;padding:16px;max-height:48vh;overflow:auto';
      const status=text('p','尚未发送。确认预览后点击下方按钮。',teamsBox);status.id='teams-send-status';status.setAttribute('role','status');
      const cancel=teamsButton('teams-preview-cancel','取消',closeTeams);
      const send=teamsButton('teams-send','确认推送',()=>{
        if(teamsSending||send.disabled)return;
        if(typeof GM_xmlhttpRequest!=='function'){status.textContent='缺少油猴跨域请求权限，请更新安装脚本并确认权限。';return;}
        teamsSending=true;send.disabled=true;cancel.disabled=true;status.textContent='正在提交到 Teams Workflows…';
        let settled=false,request;
        const finish=message=>{if(settled)return;settled=true;clearTimeout(watchdog);teamsSending=false;cancel.disabled=false;status.textContent=message;};
        const watchdog=setTimeout(()=>{finish('请求超时，投递结果未知。请先查看 Teams / 工作流运行记录，避免重复发送。');request?.abort?.();},30000);
        // One explicit POST only; do not auto-retry a possibly delivered message.
        try{request=GM_xmlhttpRequest({method:'POST',url:destination,headers:{'Content-Type':'application/json'},data,timeout:30000,anonymous:true,redirect:'error',
          onload:r=>{if(r.status>=200&&r.status<300)finish('Webhook 已接受请求（HTTP '+r.status+'）。请在 Teams 或工作流运行记录中确认投递；HTTP 成功不代表卡片已发布。');
            else finish('Teams Webhook 返回 HTTP '+r.status+'；请检查工作流地址、认证方式及运行记录。未自动重试。');},
          onerror:()=>finish('提交失败：请检查网络、油猴域名授权及工作流认证。投递结果可能未知；未自动重试。'),
          ontimeout:()=>finish('请求超时，投递结果未知。请先查看 Teams / 工作流运行记录，避免重复发送。'),
          onabort:()=>finish('请求已中止，投递结果未知。请先检查 Teams。')});}
        catch{finish('无法提交请求，请检查油猴权限。未自动重试。');}
      });send.className='primary';cancel.focus();
    }catch(e){message(e.message,true);}
  }
  $('teams-config').onclick=teamsConfig;$('teams-preview').onclick=teamsPreview;
  if(typeof GM_registerMenuCommand==='function')GM_registerMenuCommand('Teams 配置',teamsConfig);
  $('load').onclick=()=>guard(load);$('run').onclick=()=>guard(run);
  let lastFocus;
  $('launch').onclick=()=>{lastFocus=document.activeElement;$('overlay').style.display='block';$('close').focus();};
  const close=()=>{$('overlay').style.display='none';lastFocus?.focus();};$('close').onclick=close;
  root.addEventListener('keydown',e=>{if(teamsDialog.style.display!=='none'){
    if(e.key==='Escape'){e.preventDefault();closeTeams();}
    if(e.key==='Tab'){const nodes=[...teamsBox.querySelectorAll('button,input')].filter(x=>!x.disabled),first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&root.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&root.activeElement===last){e.preventDefault();first?.focus();}}return;
  }if(e.key==='Escape')close();if(e.key==='Tab'&&$('overlay').style.display==='block'){const nodes=[...$('panel').querySelectorAll('button,input,select,a')].filter(x=>!x.disabled);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&root.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&root.activeElement===last){e.preventDefault();first.focus();}}});
  $('export').onclick=()=>{
    const rows=[['统计说明',reportMeta],['Sprint ID','Sprint','状态',activePeriod.before,activePeriod.after,'增减',activePeriod.rate]];
    for(const g of groups){const stats=rowsWithTotal(g);for(const r of stats)rows.push([g.id,g.name,r.name,r.before.length,r.after.length,r.after.length-r.before.length,rate(r.before.length,r.after.length)]);}
    const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='jira-sprint-analysis-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
})();
