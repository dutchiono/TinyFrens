const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const elements = new Map(), timers = [], intervals = [], listeners = new Map(), calls = [];
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    dataset:{}, hidden:false, disabled:false, value:'', textContent:'', open:false,
    append() {}, after() {}, closest() { return this; },
    addEventListener() {}, showModal() { this.open=true; }, close() { this.open=false; },
  });
  return elements.get(id);
}
const saved = new Map(); let failStatus = false, failStart = true, releaseState, serverRevision = 0, serverTelegramSelection = [];
const blockedState = new Promise(resolve => { releaseState=resolve; });
let blockState = true;
const context = {
  URLSearchParams, Event, console,
  location:{search:''}, navigator:{clipboard:{writeText:async()=>{}}},
  sessionStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)},
  localStorage:{getItem:()=>null,setItem(){}},
  setInterval:fn=>intervals.push(fn), setTimeout:(fn,ms)=>{timers.push({fn,ms});},
  document:{hidden:false,body:{append(){}},getElementById:element,createElement:()=>element('panel'),addEventListener(){}},
  window:{
    TINYFRENS_SERVER:'https://relay.test', TinyFrensFriends:{identity:()=>({id:'device',token:'private'})},
    TinyFrensCompanionKey:nft=>`${Number(nft.chainId)}:${String(nft.originalAddress).toLowerCase()}:${Number(nft.tokenId)}`,
    TinyFrensQR:{render:()=>{}},
    addEventListener:(event,fn)=>listeners.set(event,fn), dispatchEvent:()=>{},
    TinyFrensTurtleAPI:async (base,route,body)=>{
      calls.push({route,body});
      if (route.endsWith('/state')) {
        if (blockState) await blockedState;
        if (Object.hasOwn(body, 'selection') || Object.hasOwn(body, 'telegramSelection')) serverRevision += 1;
        if (Object.hasOwn(body, 'telegramSelection')) serverTelegramSelection = body.telegramSelection;
        return {account:'a',revision:serverRevision,selection:[],telegramSelection:serverTelegramSelection,addresses:[],devices:1};
      }
      if (route.endsWith('/start')) {
        if (failStart) throw Error('offline');
        return {code:'ABCDEFGHJKLM',expires:Date.now()/1000+600};
      }
      if (route.endsWith('/status')) {
        if (failStatus) throw Error('temporary connection failure');
        return {pending:false};
      }
      return {};
    },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/device-sync.js'),'utf8'),context);
(async()=>{
  // Code creation must not wait for a slow ownership/state sync.
  await timers.find(timer=>timer.ms===500).fn();
  assert.equal(element('createSyncCode').hidden,false);
  assert.equal(element('createSyncCode').disabled,false);
  assert.equal(element('createSyncCode').textContent,'Retry connection');
  failStart=false;
  await element('createSyncCode').onclick();
  assert.equal(element('syncCode').textContent,'ABCD-EFGH-JKLM');
  assert.equal(calls.findLast(call=>call.route.endsWith('/start')).body.renew,true);
  blockState=false;releaseState();await new Promise(resolve=>setImmediate(resolve));
  const first = {chainId:8453,originalAddress:'0x1111111111111111111111111111111111111111',tokenId:1};
  const second = {chainId:8453,originalAddress:'0x2222222222222222222222222222222222222222',tokenId:2};
  await context.window.TinyFrensTelegramSlots.setSlot(first,2);
  await context.window.TinyFrensTelegramSlots.setSlot(second,3);
  await context.window.TinyFrensTelegramSlots.setSlot(first,3);
  assert.equal(JSON.stringify(context.window.TinyFrensTelegramSlots.list().map(item=>[item.tokenId,item.slot])),JSON.stringify([[2,2],[1,3]]),'moving onto an occupied slot swaps existing assignments');
  assert.equal(JSON.stringify(calls.findLast(call=>Object.hasOwn(call.body,'telegramSelection')).body.telegramSelection.map(item=>[item.tokenId,item.slot])),JSON.stringify([[2,2],[1,3]]));
  failStatus=true;
  await intervals.find(fn=>fn.name==='tick')();
  assert.equal(element('syncCode').textContent,'ABCD-EFGH-JKLM','network failure must retain a valid code');
  assert.ok([...saved.values()].some(value=>value.includes('ABCDEFGHJKLM')));
  assert.match(element('syncStatus').textContent,/temporary connection failure/);
  console.log('Device sync client checks passed: busy startup, Telegram slot acknowledgement/swap, visible retry, explicit renewal, transient failure retains code');
})().catch(error=>{console.error(error);process.exitCode=1;});
