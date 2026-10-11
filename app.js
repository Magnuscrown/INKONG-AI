(function(){
'use strict';
var $=function(i){return document.getElementById(i)};
function h(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function ls(k,d){try{return JSON.parse(localStorage.getItem(k))||d}catch(e){return d}}
function sv(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
/* SETTINGS */
var CFG={SEARX_URL:'',CAPTION_PROXY:''};
var HOOKS=["Your chats live on your device. Clear your browser and they're gone.","The AI runs on your own phone or laptop, not on our servers.","Ask in any language. INKONG answers in yours.","Free chat, search, tools and games. Ads keep it free.","No account needed. Start typing.","Search the web, then read or translate any result.","Saved chats stay in this browser, nowhere else."];
var TOOLS={
fact:{i:'🔎',n:'Fact Check',h:'Check facts in text, audio or video',s:'Paste text, or tap ⋯ and attach an audio or video file. INKONG turns speech into text behind the scenes and shows only the score, what is true and what is false.',p:'Paste text, or attach a file with ⋯...'},
trans:{i:'🎙️',n:'Audio/Video to Text',h:'Turn audio or video into text',s:'Tap ⋯, attach an audio or video file, then press send. The text is made on your device and nothing is uploaded.',p:'Attach a file with ⋯, then send...'},
det:{i:'🕵️',n:'AI Text Detector',h:'Paste text to check if AI wrote it',s:'You get an AI-probability score with reasons.',p:'Paste the text to check...'},
qr:{i:'🔗',n:'QR Code Generator',h:'Turn a link or text into a QR code',s:'Works on your device. Nothing is uploaded.',p:'Paste a link or text...'},
pw:{i:'🔐',n:'Password Generator',h:'Make a strong random password',s:'Made on your device with secure random numbers.'}
};
var GAMES=[['⚔️','Action','#ff5a5f'],['🧩','Puzzle','#8b93ff'],['🕹️','Arcade','#f5b942'],['🏎️','Racing','#4ade80'],['⚽','Sports','#38bdf8'],['🃏','Cards','#f472b6']].map(function(g){return{e:g[0],n:g[1],c:g[2],url:''}});
var GAME_HOSTS=[];
function okHost(u,list){try{var x=new URL(u);return x.protocol==='https:'&&list.some(function(h){return x.hostname===h||x.hostname.endsWith('.'+h)})}catch(e){return false}}
var tab='ai',tool=null,tier=0,atts=[],qTarget=null,cur=null,vl=0;
var chats=ls('ik_chats',[]),sq=ls('ik_s',[]),vs=ls('ik_v',[]);

function toast(m){var t=$('toast');t.textContent=m;t.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove('on')},2400)}
function hook(){$('hook').textContent=HOOKS[Math.floor(Math.random()*HOOKS.length)]}hook();

/* ---------- navigation ---------- */
function go(t,tl){
  tab=t;tool=tl||null;
  document.querySelectorAll('.view').forEach(function(v){v.classList.toggle('on',v.id==='v-'+t)});
  document.querySelectorAll('#nav button').forEach(function(b){b.classList.toggle('on',b.dataset.t===t)});
  var showBar=t==='ai'||t==='search'||(t==='qa'&&tool&&tool!=='pw');
  $('bar').classList.toggle('off',!showBar);$('ftray').classList.toggle('off',!showBar);
  $('in').placeholder=t==='search'?'Search anything...':(tool&&TOOLS[tool]?TOOLS[tool].p:'Ask INKONG...');
  if(t==='qa')renderQA();
  if(t==='vid')loadVids();
  if(t!=='vid'){var m=$('vm');if(m)m.remove();stopVids()}
  closeAll();
}
document.querySelectorAll('#nav button').forEach(function(b){b.onclick=function(){go(b.dataset.t)}});

function openDrawer(){renderLists();$('drawer').classList.add('on');$('scrim').classList.add('on')}
function closeAll(){$('drawer').classList.remove('on');$('sheet').classList.remove('on');$('scrim').classList.remove('on')}
$('burger').onclick=openDrawer;$('scrim').onclick=closeAll;
$('more').onclick=function(){var s=$('sheet');if(s.classList.contains('on'))closeAll();else{s.classList.add('on');$('scrim').classList.add('on')}};

var sb=$('sb');
['fact','trans','det'].forEach(function(k){var b=h('button','stack',TOOLS[k].i+' '+TOOLS[k].n);b.onclick=function(){go('qa',k)};sb.appendChild(b)});

/* ---------- AI tab ---------- */
/* TIERS:
   0 = cannot run local AI -> user's own free Gemini key
   1 = CPU phones/laptops  -> SmolLM2-135M (WebAssembly, ~140 MB)  works everywhere
   2 = has WebGPU, 4 GB+   -> Qwen2.5-0.5B (WebGPU, ~400 MB)
   3 = has WebGPU, 6 GB+   -> Llama-3.2-1B (WebGPU, ~1 GB)
   If a bigger model fails to start, we drop to the next smaller one. */
var MODELS={
 1:{id:'onnx-community/SmolLM2-135M-Instruct',dtype:'q8',device:'wasm',size:'about 140 MB',tok:200},
 2:{id:'onnx-community/Qwen2.5-0.5B-Instruct',dtype:'q4',device:'webgpu',size:'about 400 MB',tok:350},
 3:{id:'onnx-community/Llama-3.2-1B-Instruct',dtype:'q4f16',device:'webgpu',size:'about 1 GB',tok:500}
};
var LIMITS={0:60000,1:4200,2:5000,3:8000};
function gpuOk(){return navigator.gpu?navigator.gpu.requestAdapter().then(function(a){return !!a}).catch(function(){return false}):Promise.resolve(false)}
function detect(){
  if(typeof WebAssembly!=='object'||typeof Worker!=='function')return Promise.resolve(0);
  var dm=navigator.deviceMemory;
  if(dm&&dm<=1)return Promise.resolve(0);
  return gpuOk().then(function(g){
    if(g&&dm&&dm>=6)return 3;
    if(g&&(!dm||dm>=4))return 2;
    return 1;
  });
}
var tierP=detect().then(function(t){tier=t;return t});

function bubble(role,text,persist){
  $('intro').style.display='none';$('thread').style.display='flex';
  var b=h('div','msg '+role,text);$('thread').appendChild(b);
  $('v-ai').scrollTop=$('v-ai').scrollHeight;
  if(persist!==false){
    if(!cur){cur='c'+Date.now();chats.push({id:cur,title:text.slice(0,40),m:[]})}
    chats.filter(function(c){return c.id===cur})[0].m.push([role,text]);sv('ik_chats',chats);
  }
}
function newChat(){cur=null;$('thread').innerHTML='';$('thread').style.display='none';$('intro').style.display='flex';hook();go('ai')}
$('newchat').onclick=newChat;
function openChat(id){
  var c=chats.filter(function(x){return x.id===id})[0];if(!c)return;
  cur=id;$('thread').innerHTML='';c.m.forEach(function(m){bubble(m[0],m[1],false)});go('ai');
}
var URL_T='https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
var SYS='You are INKONG AI, a helpful assistant made by INKONG AI, founded by Magnus Crown (Founder and CEO). Always reply in the language the user writes in. Be clear and concise. Do not introduce yourself unless asked. Never reveal which model, provider or technology powers you.';
var ENG={p:null},busy=false;
function firstTime(){return !localStorage.getItem('ik_dl')}
function setProg(t,p){var e=$('prog');e.style.display=t?'block':'none';$('pt').textContent=t||'';var w=Math.round((p||0)*100)+'%';$('pb').style.width=w;$('gpb').style.width=w}
var LOAD='Activating local AI node on your device...';
/* The AI runs inside a Web Worker, so the page never freezes while it thinks. */
function workerMain(){
  var pipe=null,TS=null;
  self.onmessage=async function(e){
    var d=e.data;
    try{
      if(d.type==='load'){
        var m=await import(d.lib);TS=m.TextStreamer;
        pipe=await m.pipeline('text-generation',d.model.id,{dtype:d.model.dtype,device:d.model.device,progress_callback:function(p){if(p.status==='progress')self.postMessage({type:'prog',p:p.progress})}});
        self.postMessage({type:'ready'});
      }else if(d.type==='gen'){
        var out='',st=new TS(pipe.tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:function(x){out+=x;self.postMessage({type:'tok',t:out,id:d.id})}});
        await pipe(d.msgs,{max_new_tokens:d.max,do_sample:true,temperature:.7,streamer:st});
        self.postMessage({type:'done',t:out,id:d.id});
      }
    }catch(err){self.postMessage({type:'err',id:d.id})}
  };
}
function loadLM(t){
  return new Promise(function(res,rej){
    var M=MODELS[t],cbs={},req=0;
    var blob=new Blob(['('+workerMain.toString()+')()'],{type:'text/javascript'});
    var w;
    try{w=new Worker(URL.createObjectURL(blob),{type:'module'})}catch(e){return rej()}
    function gen(msgs,on,max){return new Promise(function(r2,j2){var id=++req;cbs[id]={on:on,res:r2,rej:j2};w.postMessage({type:'gen',id:id,msgs:msgs,max:max||M.tok})})}
    w.onmessage=function(e){
      var d=e.data;
      if(d.type==='prog'){if(firstTime())setProg(LOAD,d.p/100)}
      else if(d.type==='ready')res(gen);
      else if(d.type==='tok'&&cbs[d.id])cbs[d.id].on(d.t);
      else if(d.type==='done'&&cbs[d.id]){cbs[d.id].res(d.t);delete cbs[d.id]}
      else if(d.type==='err'){if(d.id&&cbs[d.id]){cbs[d.id].rej();delete cbs[d.id]}else{w.terminate();rej()}}
    };
    w.onerror=function(){w.terminate();rej()};
    w.postMessage({type:'load',lib:URL_T,model:M});
  });
}
function gemGen(key){return function(msgs,on){
  var body={systemInstruction:{parts:[{text:SYS}]},contents:msgs.filter(function(m){return m.role!=='system'}).map(function(m){return{role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]}})};
  return fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
   .then(function(r){if(!r.ok)throw 'badkey';return r.json()}).then(function(d){var t=d.candidates[0].content.parts[0].text;on(t);return t});
}}
function ensure(ok){
  if(ENG.p)return ENG.p;
  ENG.p=tierP.then(function(){
    var t=tier,key=localStorage.getItem('ik_gem');
    if(t===0)return key?gemGen(key):null;
    if(!ok&&firstTime()&&!confirm('The first time, INKONG downloads a private AI to your device ('+MODELS[t].size+'). It is saved for next time. Continue? Wi-Fi is best.'))return null;
    if(firstTime())setProg(LOAD,0);
    return loadLM(t).catch(function(){
      if(t===3){tier=2;return loadLM(2).catch(function(){tier=1;return loadLM(1)})}
      if(t===2){tier=1;return loadLM(1)}
      throw 0;
    }).then(function(g){
      try{localStorage.setItem('ik_dl','1')}catch(e){}setProg('');
      if(tier===1)toast('Running in Lite Battery-Saver Mode.');
      return g;
    },function(){setProg('');tier=0;return key?gemGen(key):null});
  }).then(function(g){if(!g)ENG.p=null;return g});
  return ENG.p;
}
function history(){var c=chats.filter(function(x){return x.id===cur})[0],m=c?c.m.slice(tier===1?-4:-8):[];return [{role:'system',content:SYS}].concat(m.map(function(x){return{role:x[0]==='ai'?'assistant':'user',content:x[1]}}))}
function okKey(k){return /^[A-Za-z0-9._-]{20,}$/.test(k)}
function keyCard(){
  $('intro').style.display='none';$('thread').style.display='flex';
  var c=h('div','msg ai');
  c.innerHTML='<b>The private AI cannot run on this device right now.</b><br>You can still use INKONG AI free with your own Gemini key. It uses your own free Google quota, not ours.<details><summary>How to get your key</summary><ol><li>Tap Get your key below. It opens Google AI Studio.</li><li>Sign in with your Google account.</li><li>Tap Create API key.</li><li>Copy the key it shows you.</li><li>Come back here, paste it in the box and tap Enter.</li></ol><span style="font-size:12px;color:#9a9aa2">Tip: make a key just for INKONG AI, so you can delete it any time.</span></details>';
  var a=h('a','mini','Get your key');a.href='https://aistudio.google.com/apikey';a.target='_blank';a.rel='noopener';c.appendChild(a);
  var i=h('input','kin');i.placeholder='Paste your key here';c.appendChild(i);
  var b=h('button','mini','Enter');
  b.onclick=function(){var k=i.value.trim().replace(/^["']|["']$/g,'');if(!okKey(k)){toast('That does not look like a key. Copy the whole key.');return}try{localStorage.setItem('ik_gem',k)}catch(e){}ENG.p=null;c.remove();bubble('ai','Key saved on this device only. Ask me anything.')};
  c.appendChild(b);$('thread').appendChild(c);$('v-ai').scrollTop=$('v-ai').scrollHeight;
}
function askAI(){
  tierP.then(function(){
    if(tier===0&&!localStorage.getItem('ik_gem')){keyCard();return}
    busy=true;
    var live=h('div','msg ai');live.innerHTML='<span class="dots"><i></i><i></i><i></i></span>';$('thread').appendChild(live);$('v-ai').scrollTop=$('v-ai').scrollHeight;
    ensure().then(function(gen){
      if(!gen){live.remove();if(tier===0)keyCard();else bubble('ai','The private AI has not been downloaded yet. Send your message again to start it.');return}
      return gen(history(),function(t){live.textContent=t;$('v-ai').scrollTop=$('v-ai').scrollHeight}).then(function(t){live.remove();bubble('ai',t||'...')});
    }).catch(function(e){
      live.remove();
      if(e==='badkey'){try{localStorage.removeItem('ik_gem')}catch(x){}ENG.p=null;bubble('ai','Google rejected that key. Please paste it again.');keyCard()}
      else bubble('ai','The AI could not answer. Please try again.');
    }).then(function(){busy=false});
  });
}
function askLocal(prompt,max){
  return ensure().then(function(gen){
    if(!gen)return null;
    return gen([{role:'system',content:SYS},{role:'user',content:prompt.slice(0,LIMITS[tier]||1500)}],function(){},max);
  });
}

/* ---------- Audio/Video to Text (speech-to-text on the device) ---------- */
function sttMain(){
  var pipe=null;
  self.onmessage=async function(e){
    var d=e.data;
    try{
      if(d.type==='load'){
        var m=await import(d.lib);
        pipe=await m.pipeline('automatic-speech-recognition','onnx-community/whisper-tiny',{dtype:'q8',device:'wasm',progress_callback:function(p){if(p.status==='progress')self.postMessage({type:'prog',p:p.progress})}});
        self.postMessage({type:'ready'});
      }else if(d.type==='run'){
        var r=await pipe(d.audio,{chunk_length_s:30,stride_length_s:5,return_timestamps:false});
        self.postMessage({type:'done',t:(r.text||'').trim()});
      }
    }catch(err){self.postMessage({type:'err'})}
  };
}
var STT=null;
function getSTT(){
  if(STT)return STT;
  STT=new Promise(function(res,rej){
    var w;
    try{w=new Worker(URL.createObjectURL(new Blob(['('+sttMain.toString()+')()'],{type:'text/javascript'})),{type:'module'})}catch(e){return rej()}
    w.onmessage=function(e){var d=e.data;if(d.type==='prog')qbusy('Downloading the speech tool, first time only: '+Math.round(d.p)+'%');else if(d.type==='ready')res(w);else if(d.type==='err')rej()};
    w.onerror=function(){rej()};
    w.postMessage({type:'load',lib:URL_T});
  });
  STT.catch(function(){STT=null});
  return STT;
}
function decodeAudio(file,maxSec){
  return file.arrayBuffer().then(function(buf){
    var AC=window.AudioContext||window.webkitAudioContext,ctx=new AC();
    return new Promise(function(res,rej){ctx.decodeAudioData(buf,res,rej)}).then(function(ab){
      if(ctx.close)ctx.close();
      if(ab.duration>(maxSec||900))throw (maxSec===300?'long5':'long');
      var OC=window.OfflineAudioContext||window.webkitOfflineAudioContext,oc=new OC(1,Math.ceil(ab.duration*16000),16000),src=oc.createBufferSource();
      src.buffer=ab;src.connect(oc.destination);src.start();
      return oc.startRendering().then(function(r){return new Float32Array(r.getChannelData(0))});
    });
  });
}
function transcribeCore(file,status,maxSec){
  if(file.size>60*1024*1024)return Promise.reject('big');
  status('Reading your file');
  return decodeAudio(file,maxSec).then(function(a){
    return getSTT().then(function(w){
      status('Turning speech into text. This can take a few minutes on older devices');
      return new Promise(function(res,rej){
        w.onmessage=function(e){var d=e.data;if(d.type==='done')res(d.t);else if(d.type==='err')rej()};
        w.postMessage({type:'run',audio:a},[a.buffer]);
      });
    });
  });
}
var NOAI='To unlock AI features on this device, add your free Gemini key in the AI tab.';
var LINKMSG='A browser cannot read a video from a link, because social sites block it. Save the video to your device and attach it with the ⋯ button, or paste the text.';
function mediaErr(e){return e==='long5'?'This video or audio is longer than 5 minutes, so it is too long for this tool. Please try a shorter one.':e==='long'?'This is longer than 15 minutes. Try a shorter file.':e==='big'?'This file is too big. Try one under 60 MB.':e==='noai'?NOAI:'Could not read that file. Try an mp3, m4a, wav or mp4 file.'}
function qres(){if(qTarget)return qTarget;var v=$('v-qa'),o=$('qres');if(!o){o=h('div','pad');o.id='qres';v.appendChild(o)}return o}
function qbusy(label){
  var v=$('v-qa'),o=qres();o.innerHTML='';
  var m=h('div','msg ai');m.style.maxWidth='100%';
  var l=h('div',null,label);l.style.cssText='font-weight:600;margin-bottom:6px';m.appendChild(l);
  var d=h('span','dots');d.innerHTML='<i></i><i></i><i></i>';m.appendChild(d);
  o.appendChild(m);v.scrollTop=v.scrollHeight;
}
function transcribeFiles(media){
  var out=[],i=0;
  function step(){
    if(i>=media.length)return Promise.resolve();
    var a=media[i++];
    return transcribeCore(a.file,function(m){qbusy(m+(media.length>1?' (file '+i+' of '+media.length+')':''))},900).then(function(t){out.push({n:a.name,t:t});return step()});
  }
  step().then(function(){
    var txt=out.map(function(o){return (media.length>1?'['+o.n+']\n':'')+(o.t||'No speech was found.')}).join('\n\n');
    qout(txt);
    if(out.some(function(o){return o.t})){
      var cb=h('button','mini','Copy text');
      cb.onclick=function(){if(navigator.clipboard)navigator.clipboard.writeText(txt).then(function(){toast('Copied.')})};
      qres().appendChild(cb);
    }
  }).catch(function(e){qout(mediaErr(e))});
}

var PROMPTS={sum:'Summarize this text in 3 to 5 short lines. Include only the most important points. Do not add an introduction.',fact:'List each factual claim in this transcript and rate it TRUE, MISLEADING, FALSE or UNCLEAR with a short reason and a confidence percentage.',det:'Estimate how likely this text was written by AI. Give a percentage and the reasons.'};
function qout(x){var v=$('v-qa'),o=qres();o.innerHTML='';var m=h('div','msg ai',x);m.style.maxWidth='100%';o.appendChild(m);v.scrollTop=v.scrollHeight}
function isMedia(f){return f&&f.file&&(/^(audio|video)\//.test(f.file.type)||/\.(mp3|wav|m4a|mp4|webm|ogg|mov|aac|3gp|opus)$/i.test(f.name))}
var CL_PROMPT='Read the text and list its factual claims that can be checked, at most 5. Write one short, complete claim per line. No numbering. Write nothing else.\n\nText:\n';
function parseClaims(a){return (a||'').split('\n').map(function(l){return l.replace(/^[\s\-*\d.)]+/,'').trim()}).filter(function(l){return l.length>15&&l.length<300}).slice(0,5)}
function wikiEvidence(claim,n,chars){
  var u='https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrlimit='+n+'&gsrsearch='+encodeURIComponent(claim.slice(0,200))+'&prop=extracts&exintro=1&explaintext=1&exchars='+chars+'&format=json&origin=*';
  return getJ(u).then(function(d){
    var p=(d.query&&d.query.pages)||{};
    return Object.keys(p).map(function(k){return p[k]}).sort(function(a,b){return a.index-b.index}).filter(function(x){return x.extract}).map(function(x){return{t:x.title,x:x.extract.replace(/\s+/g,' '),u:'https://en.wikipedia.org/wiki/'+encodeURIComponent(x.title.replace(/ /g,'_'))}});
  }).catch(function(){return[]});
}
var SK={'Wikipedia':'wiki','World news (GDELT)':'news','Tech news (Hacker News)':'hn','Coding answers (Stack Overflow)':'code','Books (Open Library)':'books','Research papers (Crossref)':'research'};
var PRIMARY={code:['code','wiki'],books:['books','wiki'],research:['research','wiki'],news:['news','wiki'],general:['wiki']};
function topicOf(c){
  var t=c.toLowerCase();
  if(/\b(code|coding|javascript|python|java|html|css|api|function|bug|compiler|programming|software|react|linux|sql|database|github|algorithm)\b/.test(t))return 'code';
  if(/\b(book|novel|author|wrote|written by|poem|bestseller)\b/.test(t))return 'books';
  if(/\b(study|studies|research|scientists|researchers|clinical|trial|journal|cancer|vaccine|disease|treatment|medicine)\b/.test(t))return 'research';
  if(/\b(president|minister|government|election|war|attack|police|court|announced|arrested|killed|protest|market|prices?|stock|economy|today|yesterday|breaking|news|ceo|launched|released)\b|\b20[12]\d\b/.test(t))return 'news';
  return 'general';
}
function srcByKeys(keys,inverse){return SOURCES.filter(function(s){var has=keys.indexOf(SK[s.n])>=0;return inverse?!has:has})}
function gatherEvidence(claim,list){
  var enc=encodeURIComponent(claim.slice(0,180)),n=tier===1?1:2,wc=tier===1?300:450,oc=tier===1?120:160;
  return Promise.all(list.map(function(src){
    if(src.n==='Wikipedia')return withTimeout(wikiEvidence(claim,n,wc),7000).then(function(a){return a.map(function(e){return{s:'Wikipedia',t:e.t,x:e.x,u:e.u}})});
    return withTimeout(src.f(enc).catch(function(){return[]}),src.ms||7000).then(function(a){return a.slice(0,n).map(function(e){return{s:src.n,t:e.t,x:(e.t+(e.s?'. '+e.s:'')).slice(0,oc),u:e.u}})});
  })).then(function(all){return[].concat.apply([],all)});
}
function parseV(a,re,def){var m=re.exec(a||'');return m?m[1].toUpperCase():def}
function ownKnowledge(claim){
  return askLocal('Is this claim true? Answer with one word: TRUE, FALSE or UNSURE.\nClaim: '+claim,8).then(function(a){if(a===null)throw 'noai';return parseV(a,/\b(TRUE|FALSE|UNSURE)\b/i,'UNSURE')});
}
function judge(claim,ev){
  if(!ev.length)return Promise.resolve('UNSURE');
  return askLocal('Claim: '+claim+'\n\nEvidence:\n'+ev.map(function(e,i){return '['+(i+1)+'] '+e.s+': '+e.x}).join('\n')+'\n\nDoes the evidence support or contradict the claim? Answer with one word: SUPPORTED, CONTRADICTED or UNSURE.',8).then(function(a){
    if(a===null)throw 'noai';
    var v=parseV(a,/\b(SUPPORTED|CONTRADICTED|UNSURE)\b/i,'UNSURE');return v==='SUPPORTED'?'TRUE':v==='CONTRADICTED'?'FALSE':'UNSURE';
  });
}
function combine(c,own,sv,ev){
  var v,how;
  if(sv!=='UNSURE'&&own!=='UNSURE'){if(sv===own){v=sv;how='Sources and AI agree'}else{v='UNCLEAR';how='Sources and AI disagree'}}
  else if(sv!=='UNSURE'){v=sv;how='Based on sources'}
  else if(own!=='UNSURE'){v=own;how='AI knowledge only'}
  else{v='UNCLEAR';how='Not enough evidence'}
  return{c:c,v:v,how:how,r:'',src:ev.slice(0,5).map(function(e){return{t:e.s+': '+e.t,u:e.u}})};
}
function seq(arr,fn){var i=0;function step(){if(i>=arr.length)return Promise.resolve();var k=i++;return fn(arr[k],k).then(step)}return step()}
function writeSummary(rows){
  var lines=rows.map(function(r){return (r.v==='TRUE'?'TRUE':r.v==='FALSE'?'FALSE':'NOT CONFIRMED')+': '+r.c}).join('\n');
  var T=rows.filter(function(r){return r.v==='TRUE'}).length,F=rows.filter(function(r){return r.v==='FALSE'}).length,U=rows.length-T-F;
  var base=T+' of '+rows.length+' claims look true, '+F+' look false and '+U+' could not be confirmed.';
  return askLocal('Fact check results:\n'+lines+'\n\nWrite 3 or 4 short, plain sentences telling the reader how much of the text is true, which claims are false or could not be confirmed, and what to double-check. Use only the results above. Do not add new facts.',130).then(function(a){a=(a||'').trim();return a.length>20?a:base}).catch(function(){return base});
}
function showFC(rows,cut,summary){
  var o=qres();o.innerHTML='';
  var box=h('div','msg ai');box.style.maxWidth='100%';
  if(!rows.length){box.textContent='Could not find clear claims to check. Try a longer text, or add your Gemini key in the AI tab for better results.';o.appendChild(box);return}
  var multi=rows.some(function(r){return r.from!==rows[0].from}),T=0,F=0;rows.forEach(function(r){var w=r.how==='AI knowledge only'?.5:1;if(r.v==='TRUE')T+=w;else if(r.v==='FALSE')F+=w});
  var sc=h('div',null,(T+F)?Math.round(100*T/(T+F))+'% reliable':'Not enough evidence');sc.style.cssText='font-size:26px;font-weight:700;margin-bottom:4px';box.appendChild(sc);
  if(summary){var sm=h('div',null,summary);sm.style.cssText='font-size:14px;line-height:1.55;margin:8px 0 10px';box.appendChild(sm)}
  box.appendChild(h('div','sub','AI estimate from '+rows.length+' claim'+(rows.length===1?'':'s')+'. Each claim is checked against several search sources and the AI\'s own knowledge. '+(cut?'Only the first part of the text was checked. ':'')+'It can be wrong, so double-check important facts.'));
  [['TRUE','✅ True'],['FALSE','❌ False'],['UNCLEAR','❓ Not enough evidence or disputed']].forEach(function(g){
    var list=rows.filter(function(r){return r.v===g[0]});if(!list.length)return;
    var hd=h('div',null,g[1]);hd.style.cssText='font-weight:600;margin:14px 0 4px';box.appendChild(hd);
    list.forEach(function(r){
      var d=h('div',null,'• '+r.c+(r.r?' — '+r.r:''));d.style.cssText='font-size:13.5px;margin:0 0 2px;color:var(--sb)';box.appendChild(d);
      var tg=h('div',null,(multi?r.from+' · ':'')+r.how);tg.style.cssText='font-size:11.5px;margin:0 0 4px 12px;color:var(--ac)';box.appendChild(tg);
      if(r.src.length){var s=h('div');s.style.cssText='font-size:12px;margin:0 0 8px 12px';r.src.forEach(function(x){var a=h('a','mini',x.t.slice(0,60));a.href=x.u;a.target='_blank';a.rel='noopener';s.appendChild(a)});box.appendChild(s)}
    });
  });
  o.appendChild(box);$('v-qa').scrollTop=0;
}
function factCheck(inputs){
  var lim=LIMITS[tier]||2600,size=Math.max(800,lim-CL_PROMPT.length-100),per=inputs.length>1?2:3,cutIt=false,list=[],i=0,rows=[];
  function nextIn(){
    if(i>=inputs.length)return Promise.resolve();
    var inp=inputs[i++],all=inp.text.replace(/\s+/g,' ').trim();
    if(all.length>size)cutIt=true;
    qbusy('Finding the claims'+(inputs.length>1?' ('+i+' of '+inputs.length+')':''));
    return askLocal(CL_PROMPT.replace('at most 5','at most '+per)+all.slice(0,size),150).then(function(a){
      if(a===null)throw 'noai';
      parseClaims(a).slice(0,per).forEach(function(c){list.push({c:c,from:inp.name})});
      return nextIn();
    });
  }
  return nextIn().then(function(){
    /* start searching for every claim at once, in the topic's best sources first */
    var items=list.map(function(it){
      var prim=PRIMARY[topicOf(it.c)];
      return{c:it.c,from:it.from,prim:prim,evP:gatherEvidence(it.c,srcByKeys(prim,false)).catch(function(){return[]})};
    });
    return seq(items,function(it,k){
      qbusy('Checking the facts (claim '+(k+1)+' of '+items.length+')');
      return ownKnowledge(it.c).then(function(o){it.own=o});
    }).then(function(){
      return seq(items,function(it,k){
        qbusy('Checking the facts (claim '+(k+1)+' of '+items.length+')');
        return it.evP.then(function(ev){
          return judge(it.c,ev).then(function(sv){
            if(sv!=='UNSURE')return{sv:sv,ev:ev};
            /* best sources could not decide: try the other sources */
            return gatherEvidence(it.c,srcByKeys(it.prim,true)).catch(function(){return[]}).then(function(more){
              var all=ev.concat(more);
              return judge(it.c,all).then(function(sv2){return{sv:sv2,ev:all}});
            });
          });
        }).then(function(r){var row=combine(it.c,it.own,r.sv,r.ev);row.from=it.from;rows.push(row)});
      });
    });
  }).then(function(){if(!rows.length)return '';qbusy('Writing the summary');return writeSummary(rows)}).then(function(sm){showFC(rows,cutIt,sm)});
}
function runTool(id,text,files){
  files=files||[];
  var media=files.filter(function(a){return a.media}),texts=files.filter(function(a){return a.text}),isUrl=/^https?:\/\/\S+$/.test(text);
  if(id==='trans'){
    if(media.length)transcribeFiles(media);
    else if(isUrl)qout(LINKMSG);
    else toast('Tap ⋯ and attach an audio or video file, then send.');
    return;
  }
  if(isUrl&&!media.length&&!texts.length){qout(LINKMSG);return}
  var inputs=[];
  if(text&&!isUrl)inputs.push({name:'Your text',text:text});
  texts.forEach(function(a){inputs.push({name:a.name,text:a.text})});
  if(!inputs.length&&!media.length){toast('Paste text, or attach an audio, video or .txt file.');return}
  var i=0;
  function nextMedia(){
    if(i>=media.length)return Promise.resolve();
    var a=media[i++];
    return transcribeCore(a.file,function(m){qbusy(m+(media.length>1?' (file '+i+' of '+media.length+')':''))},300).then(function(t){if(t&&t.trim())inputs.push({name:a.name,text:t});return nextMedia()});
  }
  qbusy('Getting ready');
  nextMedia().then(function(){
    if(!inputs.length){qout('No speech was found in the file'+(media.length>1?'s':'')+'.');return}
    if(id==='fact')return factCheck(inputs);
    qbusy('Working on it');
    return askLocal(PROMPTS[id]+'\n\n'+inputs.map(function(x){return x.text}).join('\n\n')).then(function(a){qout(a||NOAI)});
  }).catch(function(e){qout(mediaErr(e))});
}

/* ---------- Pop-up tools for the video screen ---------- */
function summarize(inputs){
  qbusy('Summarizing');
  return askLocal(PROMPTS.sum+'\n\n'+inputs.map(function(x){return x.text}).join('\n\n'),170).then(function(a){qout((a||'').trim()||NOAI)});
}
function readTxt(f){return new Promise(function(r){var fr=new FileReader();fr.onload=function(){r(fr.result)};fr.readAsText(f)})}
function closePop(){qTarget=null;$('modal').classList.remove('on')}
function openPop(kind){
  var m=$('mb');m.innerHTML='';
  m.appendChild(h('h3',null,kind==='fact'?'🔎 Check the facts':'📝 Summarize'));
  m.appendChild(h('p',null,'Attach a video or audio file (up to 5 minutes), or paste text. Videos from YouTube cannot be read directly yet, so save the video first.'));
  var picked=null,fi=document.createElement('input');fi.type='file';fi.accept='audio/*,video/*,.txt,text/plain';fi.hidden=true;m.appendChild(fi);
  var fb=h('button','mini','📎 Attach file');fb.onclick=function(){fi.click()};m.appendChild(fb);
  var fn=h('span','sub','');fn.style.marginLeft='6px';m.appendChild(fn);
  fi.onchange=function(){picked=fi.files[0]||null;fn.textContent=picked?picked.name:''};
  var ta=document.createElement('textarea');ta.className='kin';ta.rows=3;ta.placeholder='Or paste text here';ta.style.resize='none';m.appendChild(ta);
  var res=h('div');res.style.margin='8px 0';m.appendChild(res);
  var go1=h('button','mini','Start');
  go1.onclick=function(){
    var text=ta.value.trim();
    if(!picked&&!text){toast('Attach a file or paste some text.');return}
    qTarget=res;res.innerHTML='';
    var inputs=[],p=Promise.resolve();
    if(text)inputs.push({name:'Your text',text:text});
    qbusy('Getting ready');
    if(picked&&isMediaFile(picked))p=transcribeCore(picked,function(x){qbusy(x)},300).then(function(t){if(t&&t.trim())inputs.push({name:picked.name,text:t})});
    else if(picked)p=readTxt(picked).then(function(t){inputs.push({name:picked.name,text:t})});
    p.then(function(){
      if(!inputs.length){qout('No speech or text was found.');return}
      return kind==='fact'?factCheck(inputs):summarize(inputs);
    }).catch(function(e){qout(mediaErr(e))});
  };
  m.appendChild(go1);
  var x=h('button','mini','Close');x.onclick=closePop;m.appendChild(x);
  $('modal').classList.add('on');
}

/* ---------- Search tab: several free sources at once ---------- */
function plain(s){return new DOMParser().parseFromString(s||'','text/html').body.textContent}
function getJ(u){return fetch(u).then(function(r){if(!r.ok)throw 0;return r.json()})}
var gdeltT=0;
function gdeltGet(u){var wait=Math.max(0,gdeltT+5500-Date.now());gdeltT=Date.now()+wait;return new Promise(function(r){setTimeout(r,wait)}).then(function(){return fetch(u)}).then(function(r){return r.text()}).then(function(t){return JSON.parse(t)})}
function kw(q){return q.replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(function(w){return w.length>3}).slice(0,5).join(' ')}
var SOURCES=[
 {n:'Wikipedia',f:function(q){return getJ('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=5&srsearch='+q).then(function(d){return d.query.search.map(function(x){return{t:x.title,u:'https://en.wikipedia.org/wiki/'+encodeURIComponent(x.title.replace(/ /g,'_')),s:plain(x.snippet)}})})}},
 {n:'World news (GDELT)',ms:14000,f:function(q){var raw=decodeURIComponent(q),query=raw.split(/\s+/).length>6?kw(raw):raw;if(query.length<4)return Promise.resolve([]);return gdeltGet('https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=5&sort=hybridrel&query='+encodeURIComponent(query)).then(function(d){return(d.articles||[]).map(function(x){var sd=x.seendate||'';return{t:x.title,u:x.url,s:(x.domain||'')+(sd?' · '+sd.slice(0,4)+'-'+sd.slice(4,6)+'-'+sd.slice(6,8):'')}})})}},
 {n:'Tech news (Hacker News)',f:function(q){return getJ('https://hn.algolia.com/api/v1/search?hitsPerPage=4&query='+q).then(function(d){return d.hits.filter(function(x){return x.title||x.story_title}).map(function(x){return{t:x.title||x.story_title,u:x.url||x.story_url||'https://news.ycombinator.com/item?id='+x.objectID,s:(x.points||0)+' points, '+(x.num_comments||0)+' comments'}})})}},
 {n:'Coding answers (Stack Overflow)',f:function(q){return getJ('https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&pagesize=4&site=stackoverflow&q='+q).then(function(d){return d.items.map(function(x){return{t:plain(x.title),u:x.link,s:'Score '+x.score+', '+x.answer_count+' answers'}})})}},
 {n:'Books (Open Library)',f:function(q){return getJ('https://openlibrary.org/search.json?limit=4&q='+q).then(function(d){return d.docs.map(function(x){return{t:x.title,u:'https://openlibrary.org'+x.key,s:(x.author_name||[]).slice(0,3).join(', ')+(x.first_publish_year?' ('+x.first_publish_year+')':'')}})})}},
 {n:'Research papers (Crossref)',f:function(q){return getJ('https://api.crossref.org/works?rows=4&select=title,URL,container-title&query='+q).then(function(d){return d.message.items.filter(function(x){return x.title&&x.title[0]}).map(function(x){return{t:x.title[0],u:x.URL,s:(x['container-title']||[])[0]||''}})})}}
];
function withTimeout(p,ms){return Promise.race([p,new Promise(function(r){setTimeout(function(){r([])},ms)})])}
function doSearch(q){
  if(sq.indexOf(q)<0){sq.push(q);sv('ik_s',sq)}
  var box=$('res');box.innerHTML='';box.appendChild(h('div','spin'));
  var enc=encodeURIComponent(q),list=SOURCES.slice();
  if(CFG.SEARX_URL)list.unshift({n:'Web',f:function(e){return getJ(CFG.SEARX_URL+'/search?format=json&q='+e).then(function(d){return d.results.slice(0,8).map(function(x){return{t:x.title,u:x.url,s:x.content}})})}});
  Promise.all(list.map(function(src){return withTimeout(src.f(enc).catch(function(){return[]}),src.ms||7000)})).then(function(all){
    box.innerHTML='';var any=false;
    all.forEach(function(items,i){
      if(!items.length)return;any=true;
      var hd=h('div',null,list[i].n);hd.style.cssText='font-size:12px;color:var(--sb);margin:14px 0 8px;letter-spacing:.6px;text-transform:uppercase';box.appendChild(hd);
      items.forEach(function(it){
        var c=h('div','res');c.appendChild(h('b',null,it.t));c.appendChild(h('small',null,it.u));var pe=h('p',null,it.s||'');c.appendChild(pe);
        var tr=h('button','mini','🌐 Translate');tr.onclick=function(){toast('Translating...');askLocal('Translate this text to '+(navigator.language||'English')+'. Reply with the translation only.\n\n'+(it.t+'. '+(it.s||''))).then(function(a){if(a)pe.textContent=a;else toast('Translate needs the AI. Open the AI tab first.')})};
        var o=h('a','mini','↗ Open');o.href=it.u;o.target='_blank';o.rel='noopener';
        c.appendChild(tr);c.appendChild(o);box.appendChild(c);
      });
    });
    if(!any)box.appendChild(h('p','sub','No results. Try different words.'));
  });
}

/* ---------- Quick Actions ---------- */
function renderQA(){
  var v=$('v-qa');v.innerHTML='';
  if(!tool){
    var g=h('div','grid');
    Object.keys(TOOLS).forEach(function(k){var t=h('button','tile');t.appendChild(h('i',null,TOOLS[k].i));t.appendChild(document.createTextNode(TOOLS[k].n));t.onclick=function(){go('qa',k)};g.appendChild(t)});
    v.appendChild(h('div','center','')).style.cssText='min-height:0;padding-bottom:0';
    v.firstChild.appendChild(h('p','hook','⚡ Quick Actions'));v.appendChild(g);return;
  }
  var t=TOOLS[tool],b=h('button','back','← All actions');b.onclick=function(){go('qa')};v.appendChild(b);
  var c=h('div','center');c.appendChild(h('p','hook',t.i+' '+t.h));c.appendChild(h('p','sub',t.s));
  if(tool==='pw'){
    var o=h('div','pw','Tap Generate');c.appendChild(o);
    var gb=h('button','mini','Generate');gb.onclick=function(){o.textContent=makePw(20)};
    var cb=h('button','mini','Copy');cb.onclick=function(){if(navigator.clipboard)navigator.clipboard.writeText(o.textContent).then(function(){toast('Copied')})};
    c.appendChild(gb);c.appendChild(cb);
  }
  v.appendChild(c);
}
function makePw(n){
  var cs='abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*?',a=new Uint32Array(n),s='';
  crypto.getRandomValues(a);for(var i=0;i<n;i++)s+=cs[a[i]%cs.length];return s;
}

/* ---------- Videos: YouTube playlist feed (movies.json) ---------- */
var YT_O='https://www.youtube-nocookie.com',vdb=null,vio=null,vq=[],vcat='For You',vmute=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),vauto=false,vrate=1,vgest=false;
document.addEventListener('pointerdown',function(){vgest=true},{capture:true,once:true});
function vlist(cat){var a=[];Object.keys(vdb).forEach(function(k){if(cat==='For You'||cat===k)(vdb[k]||[]).forEach(function(id){a.push({id:id,cat:k})})});return a.sort(function(){return Math.random()-.5})}
function ytCmd(c,fn,a){var f=c.querySelector('iframe');if(f&&f.contentWindow)f.contentWindow.postMessage(JSON.stringify({event:'command',func:fn,args:a||[]}),YT_O)}
function vplay(c){
  var fr=document.createElement('iframe');
  fr.src=YT_O+'/embed/videoseries?list='+encodeURIComponent(c._x.id)+'&autoplay=1&mute=1&controls=0&disablekb=1&playsinline=1&rel=0&modestbranding=1&fs=0&iv_load_policy=3&enablejsapi=1&origin='+encodeURIComponent(location.origin);
  fr.allow='autoplay; encrypted-media';fr.title='Video';fr.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
  fr.onload=function(){
    if(c._ph.parentNode)c._ph.remove();
    try{fr.contentWindow.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),YT_O)}catch(e){}
    setTimeout(function(){if(vrate!==1)ytCmd(c,'setPlaybackRate',[vrate]);if(!vmute&&vgest)ytCmd(c,'unMute')},1200);
  };
  c.insertBefore(fr,c.firstChild);
}
function stopVids(){document.querySelectorAll('.vc').forEach(function(c){if(c._ld){c._ld=0;c._paused=false;var fr=c.querySelector('iframe');if(fr)fr.remove();if(!c._ph.parentNode)c.insertBefore(c._ph,c.firstChild)}})}
function vmenu(c,url){
  var m=$('vm');if(m)m.remove();
  m=h('div','vm');m.id='vm';
  var row=h('div','vrow');
  [0.5,1,1.5,2].forEach(function(r){var b=h('button','mini',r+'x');if(r===vrate)b.style.borderColor='var(--ac)';b.onclick=function(){vrate=r;document.querySelectorAll('.vc').forEach(function(k){ytCmd(k,'setPlaybackRate',[r])});m.remove()};row.appendChild(b)});
  m.appendChild(row);
  var a=h('button','stack','Auto-scroll: '+(vauto?'On':'Off'));a.onclick=function(){vauto=!vauto;$('vauto').style.display=vauto?'flex':'none';m.remove()};m.appendChild(a);
  var cl=h('button','stack','Clear display');cl.onclick=function(){$('v-vid').classList.add('clr');m.remove()};m.appendChild(cl);
  var yo=h('a','stack','Open on YouTube');yo.href=url;yo.target='_blank';yo.rel='noopener';yo.style.textDecoration='none';yo.style.color='inherit';m.appendChild(yo);
  var x=h('button','stack','Close');x.onclick=function(){m.remove()};m.appendChild(x);
  document.body.appendChild(m);
}
function vcard(x){
  var f=$('feed'),c=h('div','vc'),url='https://www.youtube.com/playlist?list='+x.id,sid='yt:'+x.id,name=x.cat.charAt(0).toUpperCase()+x.cat.slice(1);
  c._x=x;c._ph=h('div','spin ph');c.appendChild(c._ph);
  var tap=h('div','tap');c.appendChild(tap);
  var o=h('div','vo');
  function ib(t,fn,cls){var b=h('button','ico'+(cls?' '+cls:''),t);b.onclick=fn;o.appendChild(b);return b}
  var s1=ib(vs.some(function(y){return y.id===sid})?'♥':'♡',function(){var i=vs.findIndex(function(y){return y.id===sid});if(i<0){vs.push({id:sid,title:name+' playlist',url:url});s1.textContent='♥'}else{vs.splice(i,1);s1.textContent='♡'}sv('ik_v',vs)});
  ib('🔎',function(){openPop('fact')}).title='Check the facts';
  ib('📝',function(){openPop('sum')}).title='Summarize';
  ib(vmute?'🔇':'🔊',function(){vmute=!vmute;document.querySelectorAll('.vc').forEach(function(k){ytCmd(k,vmute?'mute':'unMute')});document.querySelectorAll('.ico.mt').forEach(function(b){b.textContent=vmute?'🔇':'🔊'})},'mt');
  c.appendChild(o);
  c.appendChild(h('div','vt',name));
  var tm=null,lp=false,sx=0,sy=0;
  tap.onpointerdown=function(e){lp=false;sx=e.clientX;sy=e.clientY;clearTimeout(tm);tm=setTimeout(function(){lp=true;vmenu(c,url)},2000)};
  tap.onpointermove=function(e){if(Math.abs(e.clientX-sx)+Math.abs(e.clientY-sy)>12)clearTimeout(tm)};
  tap.onpointercancel=function(){clearTimeout(tm)};
  tap.onpointerup=function(e){
    clearTimeout(tm);
    if(lp||Math.abs(e.clientX-sx)+Math.abs(e.clientY-sy)>12)return;
    if($('v-vid').classList.contains('clr')){$('v-vid').classList.remove('clr');return}
    c._paused=!c._paused;ytCmd(c,c._paused?'pauseVideo':'playVideo');
  };
  f.appendChild(c);vio.observe(c);
}
function vmore(){if(!vq.length)vq=vlist(vcat);vq.splice(0,8).forEach(vcard)}
window.addEventListener('message',function(e){
  if(e.origin!==YT_O||!vauto)return;
  var d;try{d=JSON.parse(e.data)}catch(x){return}
  if(d.event==='onStateChange'&&d.info===0){
    var cs=document.querySelectorAll('.vc');
    for(var i=0;i<cs.length;i++){var fr=cs[i].querySelector('iframe');if(fr&&fr.contentWindow===e.source){var n=cs[i].nextElementSibling;if(n)n.scrollIntoView({behavior:'smooth'});break}}
  }
});
function vbar(){
  if($('vcats'))return;
  var bar=h('div');bar.id='vcats';
  ['For You'].concat(Object.keys(vdb)).forEach(function(n){var b=h('button','mini',n.charAt(0).toUpperCase()+n.slice(1));b.onclick=function(){vl=1;loadVids(n)};bar.appendChild(b)});
  $('v-vid').appendChild(bar);
  var ai=h('div',null,'⟳');ai.id='vauto';$('v-vid').appendChild(ai);
}
function loadVids(cat){
  if(vl&&!cat)return;vl=1;
  var f=$('feed');f.innerHTML='';f.scrollTop=0;f.appendChild(h('div','spin ldg'));
  (vdb?Promise.resolve(vdb):fetch('movies.json').then(function(r){return r.json()})).then(function(d){
    vdb=d;vbar();vcat=cat||'For You';vq=vlist(vcat);f.innerHTML='';
    if(!vq.length){f.appendChild(h('p','sub','No videos yet. Add playlist IDs to movies.json.'));return}
    if(vio)vio.disconnect();
    vio=new IntersectionObserver(function(en){en.forEach(function(x){
      var c=x.target;
      if(x.isIntersecting){
        if(!c._ld){c._ld=1;vplay(c)}else ytCmd(c,'playVideo');
        if(c===f.lastElementChild||c===f.children[f.children.length-3])vmore();
      }else if(c._ld){
        c._ld=0;c._paused=false;var fr=c.querySelector('iframe');if(fr)fr.remove();
        if(!c._ph.parentNode)c.insertBefore(c._ph,c.firstChild);
      }
    })},{threshold:.6});
    vmore();if(vmute)toast('Videos start muted. Tap 🔇 for sound.');
  }).catch(function(){vl=0;f.innerHTML='';f.appendChild(h('p','sub','Videos are not available right now.'))});
}

/* ---------- Games ---------- */
GAMES.forEach(function(g){
  var t=h('button','tile');t.appendChild(h('i',null,g.e));t.appendChild(document.createTextNode(g.n));
  t.style.background='linear-gradient(150deg,'+g.c+'38,var(--p) 70%)';
  t.onclick=function(){if(!g.url||!okHost(g.url,GAME_HOSTS)){toast(g.n+' games are coming soon.');return}$('gt').textContent=g.n;$('gl').style.display='flex';$('fr').onload=function(){$('gl').style.display='none'};$('fr').src=g.url;$('gh').style.display='none';$('gf').classList.add('on')};
  $('gg').appendChild(t);
});
$('gfs').onclick=function(){var e=document.querySelector('.gstage');if(e.requestFullscreen)e.requestFullscreen()};
$('gback').onclick=function(){$('fr').src='about:blank';$('gf').classList.remove('on');$('gh').style.display='block'};

/* ---------- Drawer lists ---------- */
function fill(id,arr,fn,empty){
  var l=$(id);l.innerHTML='';
  if(!arr.length){l.appendChild(h('div','card',empty));return}
  arr.slice().reverse().forEach(function(x){l.appendChild(fn(x))});
}
function renderLists(){
  fill('l-chats',chats,function(c){var d=h('div','card',c.title||'Untitled');d.onclick=function(){openChat(c.id)};return d},'No chats yet');
  fill('l-search',sq,function(q){var d=h('div','card',q);d.onclick=function(){go('search');doSearch(q)};return d},'No searches yet');
  fill('l-vids',vs,function(v){var d=h('div','card',v.title);d.onclick=function(){window.open(v.url,'_blank','noopener')};return d},'No saved videos yet');
}

/* ---------- Attachments ---------- */
function isMediaFile(f){return /^(audio|video)\//.test(f.type)||/\.(mp3|wav|m4a|mp4|webm|ogg|mov|aac|3gp|opus)$/i.test(f.name)}
function renderTray(){
  var t=$('ftray');t.innerHTML='';
  atts.forEach(function(a){
    var c=h('div','fchip');
    if(a.url){var im=document.createElement('img');im.src=a.url;im.alt='';c.appendChild(im)}
    else c.appendChild(h('b',null,a.media?(/^video/.test(a.file.type)||/\.(mp4|mov|webm|3gp)$/i.test(a.name)?'🎬':'🎙️'):'📄'));
    c.appendChild(h('span',null,a.name));
    var x=h('button',null,'✕');x.setAttribute('aria-label','Remove '+a.name);
    x.onclick=function(){atts.splice(atts.indexOf(a),1);renderTray()};
    c.appendChild(x);t.appendChild(c);
  });
  t.classList.toggle('on',atts.length>0);
}
function setAtt(f){
  if(!f)return;
  var a={name:f.name||'attachment',url:null,text:null,file:f,media:isMediaFile(f)};atts.push(a);
  var r=new FileReader();
  if(f.type.indexOf('image/')===0){r.onload=function(){a.url=r.result;renderTray()};r.readAsDataURL(f)}
  else if(f.type.indexOf('text/')===0||/\.txt$/i.test(f.name)){r.onload=function(){a.text=r.result};r.readAsText(f)}
  renderTray();closeAll();
}
function clrAtt(){atts=[];renderTray()}
$('t-cam').onclick=function(){$('p-cam').click()};$('t-img').onclick=function(){$('p-img').click()};$('t-file').onclick=function(){$('p-file').click()};
['p-img','p-cam','p-file'].forEach(function(id){$(id).onchange=function(e){Array.prototype.slice.call(e.target.files).forEach(function(f){setAtt(f)});e.target.value=''}});

/* ---------- QR code (made on the device) ---------- */
function loadScript(u){return new Promise(function(r,j){var e=document.createElement('script');e.src=u;e.onload=r;e.onerror=j;document.head.appendChild(e)})}
function makeQR(text){
  if(!text){toast('Paste a link or text first.');return}
  function draw(){
    try{
      var q=window.qrcode(0,'M');q.addData(text);q.make();var src=q.createDataURL(8,2);
      var v=$('v-qa'),o=qres();o.innerHTML='';
      var w=h('div','center');w.style.minHeight='0';
      var im=document.createElement('img');im.src=src;im.alt='QR code';im.style.cssText='width:240px;max-width:100%;background:#fff;border-radius:12px;padding:8px;margin-bottom:12px';
      var a=h('a','mini','Download');a.href=src;a.download='qr.png';
      w.appendChild(im);w.appendChild(a);o.appendChild(w);v.scrollTop=v.scrollHeight;
    }catch(e){toast('That text is too long for a QR code.')}
  }
  if(window.qrcode)return draw();
  loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js').then(draw).catch(function(){toast('Could not load the QR tool. Check your connection.')});
}

/* ---------- Send ---------- */
function send(){
  var text=$('in').value.trim();if(!text&&!atts.length)return;
  if(tab==='ai'&&busy){toast('One moment, the AI is still answering.');return}
  var fs=atts.slice();$('in').value='';$('in').style.height='auto';clrAtt();
  if(tab==='search'){if(text)doSearch(text);return}
  if(tab==='qa'&&tool){
    if(tool==='qr'){makeQR(text);return}
    runTool(tool,text,fs);return;
  }
  if(/^(AIza|AQ\.)[\w.-]{20,}$/.test(text)){try{localStorage.setItem('ik_gem',text)}catch(e){}ENG.p=null;toast('Key saved on this device only. Ask me anything.');return}
  var names=fs.map(function(a){return '📎 '+a.name}).join('\n');
  bubble('user',text&&names?text+'\n'+names:(text||names));askAI();
}
$('send').onclick=send;
$('in').addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,110)+'px'});
$('in').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});

/* ---------- Gateway + first-visit AI download approval ---------- */
(function(){
  var L=$('logo3d');
  'INKONG AI'.split('').forEach(function(ch,i){var e=h('span',null,ch===' '?'\u00a0':ch);e.style.animationDelay=(i*.12)+'s';L.appendChild(e)});
  function open(){$('gate').style.display='none'}
  function mark(){try{localStorage.setItem('ik_ok','1')}catch(e){}}
  $('enter').onclick=function(){
    if(localStorage.getItem('ik_ok')){open();tierP.then(function(t){if(t>0)ensure(true)});return}
    tierP.then(function(t){
      if(t===0){mark();return open()}
      $('enter').style.display='none';$('gdis').style.display='none';
      $('gdt').textContent='This app needs a one-time download of '+MODELS[t].size+' to run its private AI on your device. It is saved here, so next time it opens instantly. Wi-Fi is best.';
      $('gdl').style.display='block';
    });
  };
  $('gno').onclick=function(){open()};
  $('gok').onclick=function(){
    $('gbtns').style.display='none';$('gbar').style.display='block';$('gdt').textContent=LOAD;
    ensure(true).then(function(g){if(g)mark();else toast('The AI download did not finish. You can try again from the AI tab.');open()});
  };
})();

$('modal').onclick=function(e){if(e.target===this)closePop()};
document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeAll();closePop()}});
})();
