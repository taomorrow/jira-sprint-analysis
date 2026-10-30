const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const core=require('../jira-sprint-analysis.user.js');
const cutoff=Date.parse('2026-10-29T00:00:00+08:00');
const now=Date.parse('2026-10-29T15:00:00+08:00');
function issue(key='DEMO-1') {return {key,fields:{summary:'<img src=x onerror=alert(1)>',created:'2026-10-27T09:00:00+08:00',updated:'2026-10-29T09:00:00+08:00',status:{id:'3',name:'Done'},customfield_1:[{id:7,name:'Demo Sprint',state:'active'}]},changelog:{startAt:0,total:2,histories:[{id:'1',created:'2026-10-28T10:00:00+08:00',items:[{field:'status',from:'1',fromString:'Open',to:'2',toString:'In Progress'}]},{id:'2',created:'2026-10-29T00:00:00+08:00',items:[{field:'status',from:'2',fromString:'In Progress',to:'3',toString:'Done'}]}]}};}
test('exclusive midnight and multiple historical transitions',()=>{
 const i=issue();assert.equal(core.statusAt(i,cutoff,false).name,'In Progress');assert.equal(core.statusAt(i,cutoff).name,'Done');assert.equal(core.statusAt(i,cutoff-86400000,false).name,'Open');
 assert.equal(core.statusAt(i,Date.parse('2026-10-26T00:00:00Z')),null);
 i.fields.created='2026-10-29T00:00:00+08:00';assert.equal(core.statusAt(i,cutoff,false),null);
});
test('object and legacy sprint formats, retained membership, no sprint',()=>{
 assert.deepEqual(core.sprints(['com.atlassian.Sprint@x[id=8,rapidViewId=1,state=CLOSED,name=Demo,with comma,startDate=x]']),[{id:'8',name:'Demo,with comma',state:'CLOSED'}]);
 const i=issue();i.fields.customfield_1.push({id:8,name:'Older',state:'closed'});
 assert.equal(core.aggregate([i],'customfield_1',['7','8'],cutoff,now).length,2);
 i.fields.customfield_1=[];assert.equal(core.aggregate([i],'customfield_1',['∅'],cutoff,now)[0].name,'未分配 Sprint');
});
test('aggregation preserves state totals, zero denominator and new issues',()=>{
 const a=issue(),b=issue('DEMO-2');b.fields.created='2026-10-29T08:00:00+08:00';b.changelog={histories:[]};
 const [g]=core.aggregate([a,b],'customfield_1',['7'],cutoff,now);
 assert.equal(g.rows.get('2').before.length,1);assert.equal(g.rows.get('3').after.length,2);assert.equal(g.issues.filter(x=>!x.before).length,1);
 assert.equal(core.rate(0,2),'新增');assert.equal(core.rate(0,0),'—');assert.equal(core.rate(4,3),'-25.0%');
 assert.equal(core.csvCell('=1+1'),'"\'=1+1"');assert.equal(core.csvCell('a,"b"'),'"a,""b"""');
});
async function fixture({truncated=false,fail=false,mismatch=false,multi=false,beforeRun}={}) {
 const dom=new JSDOM('<body></body>',{url:'https://jira.xpaas.lenovo.com/issues/?filter=180929&jql=project%20%3D%20DEMO',runScripts:'outside-only'});
 const {window:w}=dom;const calls=[];let detailCalls=0;
 w.Date.now=()=>now;
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.addEventListener('error',e=>{throw e.error;});
 const i=issue();i.fields.created='2020-01-01T00:00:00+08:00';
 w.fetch=async path=>{calls.push(path);const u=new URL(path,w.location.origin);let data;
 if(u.pathname.endsWith('/field'))data=[{id:'customfield_1',schema:{custom:'com.pyxis.greenhopper.jira:gh-sprint'}}];
 else if(u.pathname.endsWith('/status'))data=[{id:'1',name:'Open'},{id:'2',name:'In Progress'},{id:'3',name:'Done'},{id:'4',name:'SIT'}];
 else if(u.pathname.endsWith('/search')){const start=Number(u.searchParams.get('startAt'));data={total:2,issues:[{...i,key:start===0?'DEMO-1':'DEMO-2',fields:{...i.fields,customfield_1:multi&&start===1?[{id:8,name:'Other Sprint',state:'future'}]:i.fields.customfield_1}}]};}
 else if(u.pathname.endsWith('/changelog')){if(fail)return {ok:false,status:404};data={total:2,values:i.changelog.histories};}
 else {detailCalls++;data=JSON.parse(JSON.stringify(i));data.key=u.pathname.split('/').at(-1);if(multi&&data.key==='DEMO-2')data.fields.customfield_1=[{id:8,name:'Other Sprint',state:'future'}];if(mismatch)data.fields.updated='2026-10-29T01:00:00.000Z';if(truncated)data.changelog.histories=data.changelog.histories.slice(0,1);}
 return {ok:true,headers:{get:()=> 'application/json'},json:async()=>data};};
 w.eval(fs.readFileSync(require.resolve('../jira-sprint-analysis.user.js'),'utf8'));
 const root=w.document.getElementById('jsa-host').shadowRoot;
 async function click(id){root.getElementById(id).click();for(let n=0;n<100&&root.getElementById('run').disabled;n++)await new Promise(r=>setTimeout(r,1));assert.equal(root.getElementById('run').disabled,false);}
 await click('load');if(beforeRun)beforeRun(root,w);await click('run');return {dom,root,calls,click,get detailCalls(){return detailCalls;}};
}
test('UI integration: all current-query pages, refreshed histories, safe text and drilldown',async()=>{
 const f=await fixture();assert.match(f.root.getElementById('message').textContent,/分析完成/);
 assert.ok(f.calls.some(x=>x.includes('startAt=1')));assert.equal(f.detailCalls,2);
 f.root.getElementById('results').querySelectorAll('td button')[1].click();assert.match(f.root.getElementById('detail').textContent,/<img src=x/);assert.equal(f.root.getElementById('detail').querySelector('img'),null);
 await f.click('run');assert.equal(f.detailCalls,4);f.dom.window.close();
});
test('UI integration: truncated history fallback and hard failure',async()=>{
 const f=await fixture({truncated:true});assert.match(f.root.getElementById('message').textContent,/分析完成/);assert.ok(f.calls.some(x=>x.includes('/changelog?')));f.dom.window.close();
 const b=await fixture({truncated:true,fail:true});assert.match(b.root.getElementById('message').textContent,/历史被截断/);assert.equal(b.root.getElementById('results').children.length,0);assert.equal(b.root.getElementById('export').disabled,true);b.dom.window.close();
});

test('current page JQL wins over saved filter, editor wins over URL, no fixed fallback',()=>{
 const d=new JSDOM('<textarea id="jqltextarea">project = OSP</textarea>').window.document;
 assert.equal(core.pageQuery(d,'https://example.test/issues/?filter=180929&jql=project%3DCSP').jql,'project = OSP');
 d.querySelector('textarea').style.display='none';
 assert.equal(core.pageQuery(d,'https://example.test/issues/?jql=project%3DCSP').jql,'project=CSP');
 d.querySelector('textarea').remove();
 assert.equal(core.pageQuery(d,'https://example.test/issues/?filter=180929&jql=project%3DCSP').jql,'project=CSP');
 assert.equal(core.pageQuery(d,'https://example.test/issues/?filter=123').filter,'123');
 assert.equal(core.pageQuery(d,'https://example.test/browse/CSP-778').jql,'key = "CSP-778"');
 assert.throws(()=>core.pageQuery(d,'https://example.test/issues/'),/无法识别/);
});
test('different updated serialization never falsely reports a concurrent edit',async()=>{
 const f=await fixture({mismatch:true});
 assert.match(f.root.getElementById('message').textContent,/分析完成/);
 const searches=f.calls.filter(c=>c.includes('/search?'));
 assert.ok(searches.length>=4);
 for(const path of searches)assert.equal(new URL(path,'https://example.test').searchParams.get('jql'),'project = DEMO');
 assert.ok(!f.calls.some(c=>c.includes('/filter/')));
 f.dom.window.close();
});

test('Sprint checkboxes exclude unrelated tasks before loading histories',async()=>{
 const f=await fixture({multi:true});
 assert.equal(f.detailCalls,1);
 assert.match(f.root.getElementById('message').textContent,/页面共 2 条；所选 Sprint 匹配 1 条/);
 assert.doesNotMatch(f.root.getElementById('results').textContent,/Other Sprint/);
 const other=f.root.querySelector('#sprints input[value="8"]');other.click();
 assert.equal(f.root.getElementById('export').disabled,true);
 await f.click('run');assert.equal(f.detailCalls,3);
 assert.match(f.root.getElementById('results').textContent,/Other Sprint/);
 f.dom.window.close();
});
test('selected statuses use independent yesterday/today totals, include transitions out',async()=>{
 const f=await fixture({beforeRun(root){
 root.getElementById('status-all').click();root.querySelector('#statuses input[value="2"]').click();
 }});
 const result=f.root.getElementById('results');
 const labels=[...result.querySelectorAll('tr td:first-child')].map(x=>x.textContent);
 assert.ok(labels.includes('In Progress'));assert.ok(!labels.includes('Done'));
 const total=[...result.querySelectorAll('tr')].at(-1);
 assert.deepEqual([...total.querySelectorAll('td')].map(x=>x.textContent),['所选状态合计','2','0','-2','-100.0%']);
 result.querySelector('button').click();assert.match(f.root.getElementById('detail').textContent,/In Progress → Done/);
 f.dom.window.close();
});
test('clicking a named status from default All selects that status, not every other status',async()=>{
 const f=await fixture({beforeRun(root){root.querySelector('#statuses input[value="2"]').click();}});
 const labels=[...f.root.getElementById('results').querySelectorAll('tr td:first-child')].map(x=>x.textContent);
 assert.deepEqual(labels,['In Progress','所选状态合计']);
 f.dom.window.close();
});
test('198-result paging, Sprint + two statuses and CSV use the same selected scope',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://jira.xpaas.lenovo.com/issues/?jql=project%3DDEMO',runScripts:'outside-only'}),w=dom.window;
 w.Date.now=()=>now;w.HTMLElement.prototype.scrollIntoView=function(){};
 // Jira pages may define a global module; that must not disable the userscript.
 w.module={exports:{}};
 const samples=Array.from({length:198},(_,n)=>{
 const i=issue('DEMO-'+(n+1));const before=['2','4','1','2'][n%4],after=['4','3','2','2'][n%4],names={'1':'Open','2':'In Progress','3':'Done','4':'SIT'};
 i.fields.status={id:after,name:names[after]};i.fields.customfield_1=[{id:n<4?7:8,name:n<4?'Selected Sprint':'Excluded Sprint',state:n<4?'active':'future'}];
 i.changelog={total:1,startAt:0,histories:[{id:'1',created:'2026-10-29T08:00:00+08:00',items:[{field:'status',from:before,fromString:names[before],to:after,toString:names[after]}]}]};return i;
 });
 const starts=[],details=[];
 w.fetch=async path=>{const u=new URL(path,w.location.origin);let data;
 if(u.pathname.endsWith('/field'))data=[{id:'customfield_1',schema:{custom:'com.pyxis.greenhopper.jira:gh-sprint'}}];
 else if(u.pathname.endsWith('/status'))data=[{id:'1',name:'Open'},{id:'2',name:'In Progress'},{id:'3',name:'Done'},{id:'4',name:'SIT'}];
 else if(u.pathname.endsWith('/search')){const start=Number(u.searchParams.get('startAt'));starts.push(start);data={total:198,issues:samples.slice(start,start+50)};}
 else{const key=u.pathname.split('/').at(-1);details.push(key);data=samples.find(i=>i.key===key);}
 return {ok:true,headers:{get:()=> 'application/json'},json:async()=>structuredClone(data)};};
 let exported;w.Blob=class{constructor(parts){exported=parts.join('');}};w.URL.createObjectURL=()=> 'blob:mock';w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 const source=fs.readFileSync(require.resolve('../jira-sprint-analysis.user.js'),'utf8');
 // Reproduce an old panel winning the previous early-return check.
 const old=w.document.createElement('div');old.id='jsa-host';old.attachShadow({mode:'open'}).innerHTML='<h1><small>v0.1.1</small></h1>';w.document.body.append(old);
 w.eval(source);const root=w.document.getElementById('jsa-host').shadowRoot;
 assert.match(root.getElementById('launch').textContent,/0.1.3/);assert.equal(old.isConnected,false);
 async function click(id){root.getElementById(id).click();for(let n=0;n<500&&root.getElementById('run').disabled;n++)await new Promise(r=>setTimeout(r,1));assert.equal(root.getElementById('run').disabled,false);}
 await click('load');
 root.querySelector('#statuses input[value="2"]').click();root.querySelector('#statuses input[value="4"]').click();
 await click('run');
 assert.deepEqual(starts,[0,50,100,150,0,50,100,150]);assert.deepEqual(details.sort(),['DEMO-1','DEMO-2','DEMO-3','DEMO-4']);
 const rows=[...root.querySelectorAll('#results tr')].slice(1).map(r=>[...r.querySelectorAll('td')].map(x=>x.textContent));
 assert.deepEqual(rows,[['In Progress','2','2','0','0.0%'],['SIT','1','1','0','0.0%'],['所选状态合计','3','3','0','0.0%']]);
 await click('export');assert.ok(exported.includes('"In Progress","2","2"'));assert.ok(exported.includes('"SIT","1","1"'));assert.ok(!exported.includes('Excluded Sprint'));assert.ok(!exported.includes('"Done"'));
 w.eval(source);assert.equal(w.document.querySelectorAll('#jsa-host').length,1);
 dom.window.close();
});
