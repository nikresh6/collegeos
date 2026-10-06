
(function(){
"use strict";
const D = window.ROCK_DATA;
const QB = window.ROCK_QUESTIONS;
if(!D || !QB) return;

const KEY = "rockQuestV1";
const defaults = {
  xp:0,
  streak:1,
  lastStudy:null,
  completed:[],
  lessonProgress:{},
  quizPassed:{},
  missed:[],
  flashMastery:{},
  bestBoss:null,
  bestQuiz:null
};
let state = load();
let view = "quest";
let activeLesson = null;
let activeStep = 0;
let answered = false;
let deck = [];
let deckIndex = 0;
let flashFlipped = false;
let activeQuiz = null;
let activeOrder = null;
let bossTimer = null;

function load(){
  try{
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return Object.assign({}, defaults, raw);
  }catch(e){
    return Object.assign({}, defaults);
  }
}
function save(){
  localStorage.setItem(KEY, JSON.stringify(state));
  updateStreak();
  updateTopStats();
}
function updateStreak(){
  const today = new Date().toISOString().slice(0,10);
  if(!state.lastStudy){
    state.lastStudy = today;
    return;
  }
  if(state.lastStudy === today) return;
  const a = new Date(state.lastStudy + "T12:00:00");
  const b = new Date(today + "T12:00:00");
  const diff = Math.round((b-a)/86400000);
  state.streak = diff === 1 ? Math.max(1,state.streak+1) : 1;
  state.lastStudy = today;
  localStorage.setItem(KEY, JSON.stringify(state));
}
function touchStudy(){
  const today = new Date().toISOString().slice(0,10);
  if(state.lastStudy !== today){
    if(state.lastStudy){
      const a = new Date(state.lastStudy + "T12:00:00");
      const b = new Date(today + "T12:00:00");
      state.streak = Math.round((b-a)/86400000) === 1 ? state.streak+1 : 1;
    }else state.streak = 1;
    state.lastStudy = today;
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  updateTopStats();
}
function updateTopStats(){
  const xp = document.getElementById("xpStat");
  const streak = document.getElementById("streakStat");
  const mastery = document.getElementById("masteryStat");
  if(xp) xp.textContent = state.xp;
  if(streak) streak.textContent = state.streak;
  if(mastery) mastery.textContent = overallMastery() + "%";
}
function overallMastery(){
  const lessonPart = state.completed.length / D.worlds.length;
  const flashVals = Object.values(state.flashMastery || {});
  const flashPart = flashVals.length ? flashVals.filter(v=>v>=2).length / D.flashcards.length : 0;
  const quizPart = state.bestQuiz ? Math.min(1,state.bestQuiz/90) : 0;
  return Math.round((lessonPart*.62 + flashPart*.18 + quizPart*.20)*100);
}
function examDays(){
  const ms = new Date(D.meta.examDate) - new Date();
  return Math.max(0,Math.ceil(ms/86400000));
}
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]});
}
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    const t=a[i];a[i]=a[j];a[j]=t;
  }
  return a;
}
function toast(msg){
  const el = document.getElementById("toast");
  if(!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),1500);
}
function sourceClass(s){
  return /EXTERNAL|PUBLIC|ROCK HALL|SUN RECORDS/i.test(s) ? "source-external" : "source-course";
}
function setView(v){
  clearInterval(bossTimer);
  bossTimer = null;
  view = v;
  activeLesson = null;
  document.body.classList.toggle("notes-view",v==="notes");
  document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  render();
  window.scrollTo({top:0,behavior:"smooth"});
}
function render(){
  const app = document.getElementById("app");
  if(!app) return;
  if(activeLesson){ renderLesson(); return; }
  if(view==="quest") renderQuest(app);
  else if(view==="cards") renderCards(app);
  else if(view==="quiz") renderQuizHome(app);
  else if(view==="timeline") renderTimeline(app);
  else if(view==="readings") renderReadings(app);
  else if(view==="notes") renderNotes(app);
  else if(view==="boss") renderBossHome(app);
  updateTopStats();
}
function unlocked(i){
  if(i===0) return true;
  return state.completed.includes(D.worlds[i-1].id) || state.completed.includes(D.worlds[i].id);
}
function worldProgress(w){
  if(state.completed.includes(w.id)) return 100;
  const base = state.lessonProgress[w.id] || 0;
  const total = worldSteps(w).length;
  return Math.max(0,Math.min(99,Math.round((base/total)*100)));
}
function worldSteps(w){
  const baseIds = w.quizIds || [];
  const base = baseIds.map(id=>QB.questions.find(q=>q.id===id)).filter(Boolean);
  const extras = QB.questions.filter(q=>q.world===w.id && !baseIds.includes(q.id));
  const quizzes = base.concat(extras).map(q=>({type:"quiz",q:q}));
  const checkpoint = quizzes.length ? [{type:"divider",title:"Recall checkpoint",body:"Now prove you can retrieve it without looking back. These questions include exact slide details, not just broad concepts."}] : [];
  return w.steps.concat(checkpoint,quizzes);
}
function nextWorld(){
  return D.worlds.find(w=>!state.completed.includes(w.id)) || D.worlds[D.worlds.length-1];
}
function renderQuest(app){
  const mastery = overallMastery();
  const next = nextWorld();
  const days = examDays();
  app.innerHTML =
    "<section class='hero'>" +
      "<div class='card hero-main'>" +
        "<div class='kicker'>ZERO TO MIDTERM READY</div>" +
        "<h1>Build the story of rock, then make it stick.</h1>" +
        "<p>You start from zero. Every world teaches the material in plain language, then forces active recall before you can move on. Missed questions automatically enter your Encore Deck so weak spots keep coming back.</p>" +
        "<div class='cta'><button class='btn btn-primary' id='continueQuest'>" + (state.completed.length ? "Continue quest" : "Start from zero") + " →</button><button class='btn btn-secondary' id='quickQuiz'>10-question warm-up</button><button class='btn btn-ghost' id='notesJump'>Exam notebook</button><button class='btn btn-ghost' id='timelineJump'>Timeline</button></div>" +
      "</div>" +
      "<div class='card hero-side'>" +
        "<div class='mastery-ring' id='ring' style='background:conic-gradient(var(--orange) "+(mastery*3.6)+"deg,rgba(255,255,255,.07) 0deg)'><div><b>"+mastery+"%</b><span>overall mastery</span></div></div>" +
        "<div class='mini-grid'>" +
          "<div class='mini'><span>Exam</span><b>Oct 13</b></div>" +
          "<div class='mini'><span>Days left</span><b>"+days+"</b></div>" +
          "<div class='mini'><span>Worlds</span><b>"+state.completed.length+"/"+D.worlds.length+"</b></div>" +
          "<div class='mini'><span>Encore</span><b>"+state.missed.length+"</b></div>" +
        "</div>" +
      "</div>" +
    "</section>" +
    "<div class='section-head'><div><h2>Your questline</h2><p>One world at a time. Later worlds unlock when the previous world is cleared.</p></div><span class='pill'>"+state.xp+" XP earned</span></div>" +
    "<section class='quest-list'>" + D.worlds.map((w,i)=>worldCard(w,i)).join("") + "</section>";
  document.getElementById("continueQuest").onclick = ()=>openWorld(next.id);
  document.getElementById("quickQuiz").onclick = ()=>startQuiz(10,false,false);
  document.getElementById("notesJump").onclick = ()=>setView("notes");
  document.getElementById("timelineJump").onclick = ()=>setView("timeline");
  app.querySelectorAll("[data-world]").forEach(el=>el.onclick=()=>{ if(!el.classList.contains("locked")) openWorld(el.dataset.world); });
}
function worldCard(w,i){
  const status = state.completed.includes(w.id) ? "complete" : unlocked(i) ? "current" : "locked";
  const p = worldProgress(w);
  return "<article class='world "+status+"' data-world='"+w.id+"'>" +
    "<div class='world-icon'>"+(status==="complete"?"✓":status==="locked"?"🔒":w.icon)+"</div>" +
    "<div><div class='eyebrow'>"+esc(w.week)+"</div><h3>"+esc(w.title)+"</h3><p>"+esc(w.subtitle)+"</p>" +
    "<div class='badges'><span class='badge'>+"+w.xp+" XP</span><span class='badge "+sourceClass(w.source)+"'>"+esc(w.source)+"</span></div></div>" +
    "<div class='world-meta'><span class='pct'>"+p+"%</span><div class='progressline'><i style='width:"+p+"%'></i></div></div>" +
  "</article>";
}
function openWorld(id){
  touchStudy();
  activeLesson = D.worlds.find(w=>w.id===id);
  if(!activeLesson) return;
  activeStep = Math.min(state.lessonProgress[id]||0,worldSteps(activeLesson).length-1);
  answered = false;
  document.getElementById("studyModal").classList.add("open");
  renderLesson();
}
function closeLesson(){
  document.getElementById("studyModal").classList.remove("open");
  activeLesson = null;
  render();
}
function renderLesson(){
  if(!activeLesson) return;
  const modal = document.getElementById("studyModal");
  const steps = worldSteps(activeLesson);
  const s = steps[activeStep];
  const pct = Math.round((activeStep/steps.length)*100);
  modal.innerHTML = "<section class='lesson-screen'>" +
    "<div class='lesson-top'><button class='lesson-close' id='lessonClose'>←</button><div class='lesson-progress'><i style='width:"+pct+"%'></i></div><span class='lesson-count'>"+(activeStep+1)+"/"+steps.length+"</span></div>" +
    "<article class='card lesson-card'>" + stepHTML(s) +
      "<div class='lesson-footer'><span class='pill'>"+esc(activeLesson.title)+"</span><div class='lesson-actions'>" +
        (activeStep>0?"<button class='btn btn-secondary' id='lessonBack'>← Back</button>":"") +
        "<button class='btn btn-primary' id='lessonNext'>"+(activeStep===steps.length-1?"Clear world":"Continue →")+"</button>" +
      "</div></div>" +
    "</article></section>";
  document.getElementById("lessonClose").onclick = closeLesson;
  const back = document.getElementById("lessonBack");
  if(back) back.onclick = ()=>{activeStep--;answered=false;renderLesson();modal.scrollTop=0;};
  const next = document.getElementById("lessonNext");
  const already = s.type==="quiz" && state.quizPassed[s.q.id];
  if(s.type==="quiz" && !already) next.disabled = true;
  next.onclick = advanceLesson;
  if(s.type==="quiz") wireLessonQuiz(s.q,next,already);
}
function stepHTML(s){
  if(s.type==="learn"){
    return "<div class='eyebrow'>"+esc(s.tag)+"</div><h1>"+esc(s.title)+"</h1>"+s.body;
  }
  if(s.type==="divider"){
    return "<div class='eyebrow'>ACTIVE RECALL</div><h1>"+esc(s.title)+"</h1><p>"+esc(s.body)+"</p><div class='memory-hook'><span>RULE</span><p>Do not scroll backward first. Make your brain retrieve it. That struggle is the study.</p></div>";
  }
  if(s.type==="quiz"){
    const q=s.q;
    return "<div class='eyebrow'>CHECKPOINT · "+esc(q.topic)+"</div><h1>"+esc(q.q)+"</h1><div class='badges'><span class='badge "+sourceClass(q.source)+"'>"+esc(q.source)+"</span></div><div class='choices'>" +
      q.choices.map((c,i)=>"<button class='choice' data-answer='"+i+"'>"+esc(c)+"</button>").join("") +
      "</div><div class='feedback' id='lessonFeedback'></div>";
  }
  return "";
}
function wireLessonQuiz(q,next,already){
  const fb=document.getElementById("lessonFeedback");
  if(already){
    fb.className="feedback show good";
    fb.innerHTML="<strong>Already cleared.</strong> Try it again or keep moving.";
    next.disabled=false;
  }
  document.querySelectorAll("[data-answer]").forEach(btn=>btn.onclick=()=>{
    if(answered && !already) return;
    const pick=Number(btn.dataset.answer);
    if(pick===q.a){
      answered=true;
      btn.classList.add("correct");
      document.querySelectorAll("[data-answer]").forEach((b,i)=>{if(i!==q.a)b.classList.add("dim");});
      fb.className="feedback show good";
      fb.innerHTML="<strong>Correct.</strong> "+esc(q.why);
      next.disabled=false;
      if(!state.quizPassed[q.id]){
        state.quizPassed[q.id]=true;
        state.xp+=12;
        state.missed=state.missed.filter(id=>id!==q.id);
        save();
        toast("+12 XP");
      }
    }else{
      btn.classList.add("wrong");
      fb.className="feedback show bad";
      fb.innerHTML="<strong>Not yet.</strong> Try again. "+esc(q.why);
      if(!state.missed.includes(q.id)) state.missed.push(q.id);
      save();
      setTimeout(()=>btn.classList.remove("wrong"),650);
    }
  });
}
function advanceLesson(){
  const steps=worldSteps(activeLesson);
  if(activeStep<steps.length-1){
    activeStep++;
    answered=false;
    state.lessonProgress[activeLesson.id]=Math.max(state.lessonProgress[activeLesson.id]||0,activeStep);
    save();
    renderLesson();
    document.getElementById("studyModal").scrollTop=0;
  }else{
    if(!state.completed.includes(activeLesson.id)){
      state.completed.push(activeLesson.id);
      state.xp+=activeLesson.xp;
      state.lessonProgress[activeLesson.id]=steps.length;
      save();
      toast("World cleared: +"+activeLesson.xp+" XP");
    }
    closeLesson();
  }
}

function renderCards(app){
  const mastered = Object.values(state.flashMastery).filter(v=>v>=2).length;
  const weak = Object.values(state.flashMastery).filter(v=>v===0).length;
  if(!deck.length) deck=shuffle(D.flashcards);
  const c=deck[deckIndex%deck.length];
  app.innerHTML="<div class='view-heading'><div class='kicker'>FLASHCARD VAULT</div><h1>Fast retrieval, no rereading.</h1><p>Tap the card to reveal. Mark it Again if you could not produce the answer before flipping. Two successful recalls marks a card mastered.</p></div>" +
    "<div class='toolbar'><button class='chip active' data-filter='all'>All cards</button>"+D.worlds.map(w=>"<button class='chip' data-filter='"+w.id+"'>"+esc(w.week)+"</button>").join("")+"<button class='chip' id='shuffleDeck'>Shuffle</button></div>" +
    "<section class='flash-shell'><div><article class='card flashcard' id='flashcard'><span class='badge flash-source "+sourceClass(c.source)+"'>"+esc(c.source)+"</span><span class='flash-num'>"+(deckIndex+1)+" / "+deck.length+"</span>"+
      (flashFlipped?"<div class='flash-back'>"+esc(c.back)+"</div><div class='flash-hint'>Did you know it before flipping?</div>":"<div class='flash-face'>"+esc(c.front)+"</div><div class='flash-hint'>Tap to reveal answer</div>")+
      "</article><div class='flash-actions'>"+(flashFlipped?"<button class='btn btn-secondary' id='againCard'>Again</button><button class='btn btn-primary' id='gotCard'>Got it</button>":"<button class='btn btn-secondary' id='prevCard'>← Previous</button><button class='btn btn-primary' id='nextCard'>Next →</button>")+"</div></div>"+
    "<aside class='card flash-side'><h3>Deck status</h3><p>The goal is retrieval, not familiarity. If the back merely looks familiar, press Again.</p><div class='deck-stat'><span>Mastered</span><b>"+mastered+"</b></div><div class='deck-stat'><span>Weak today</span><b>"+weak+"</b></div><div class='deck-stat'><span>Total</span><b>"+D.flashcards.length+"</b></div></aside></section>";
  document.getElementById("flashcard").onclick=()=>{flashFlipped=!flashFlipped;renderCards(app);};
  const prev=document.getElementById("prevCard");if(prev)prev.onclick=(e)=>{e.stopPropagation();deckIndex=(deckIndex-1+deck.length)%deck.length;flashFlipped=false;renderCards(app);};
  const next=document.getElementById("nextCard");if(next)next.onclick=(e)=>{e.stopPropagation();deckIndex=(deckIndex+1)%deck.length;flashFlipped=false;renderCards(app);};
  const again=document.getElementById("againCard");if(again)again.onclick=(e)=>{e.stopPropagation();gradeCard(c,0,app);};
  const got=document.getElementById("gotCard");if(got)got.onclick=(e)=>{e.stopPropagation();gradeCard(c,1,app);};
  document.getElementById("shuffleDeck").onclick=()=>{deck=shuffle(deck);deckIndex=0;flashFlipped=false;renderCards(app);};
  app.querySelectorAll("[data-filter]").forEach(b=>b.onclick=()=>{
    app.querySelectorAll("[data-filter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");
    const f=b.dataset.filter;
    deck=shuffle(f==="all"?D.flashcards:D.flashcards.filter(x=>x.world===f));
    deckIndex=0;flashFlipped=false;renderCards(app);
  });
}
function gradeCard(c,ok,app){
  if(ok){
    state.flashMastery[c.id]=Math.min(2,(state.flashMastery[c.id]||0)+1);
    state.xp+=4;
    toast("+4 XP");
  }else{
    state.flashMastery[c.id]=0;
  }
  save();
  deckIndex=(deckIndex+1)%deck.length;
  flashFlipped=false;
  renderCards(app);
}

function renderQuizHome(app){
  const missed = state.missed.length;
  app.innerHTML="<div class='view-heading'><div class='kicker'>QUIZ ARENA</div><h1>Turn recognition into recall.</h1><p>Each run pulls from the same ideas in new combinations. Wrong answers enter the Encore Deck automatically.</p></div>" +
    "<section class='mode-grid'>" +
      modeCard("⚡","Quick Fire","10 mixed questions","About 5 minutes","10")+
      modeCard("🎚️","Deep Set","20 mixed questions","Stronger coverage","20")+
      modeCard("🏟️","Full Set","40 mixed questions","Broad midterm review","40")+
      modeCard("🔁","Encore Deck",missed+" missed questions","Your weak spots only","encore")+
      modeCard("🎧","Sound ID","Artist and style fingerprints","Recognition without audio clips","sound")+
      modeCard("🧠","Connections","Cross-unit synthesis","Why the history fits together","mix")+
    "</section>";
  app.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{
    const m=b.dataset.mode;
    if(m==="encore"){ if(!state.missed.length){toast("Encore Deck is empty");return;} startQuiz(state.missed.length,true,false); }
    else if(m==="sound") startQuiz(10,false,false,q=>q.topic==="Sound ID" || ["Artists","Guitar","Regional styles"].includes(q.topic));
    else if(m==="mix") startQuiz(10,false,false,q=>q.world==="mix" || q.topic==="Connections");
    else startQuiz(Number(m),false,false);
  });
}
function modeCard(icon,title,text,note,mode){
  return "<article class='mode-card' data-mode='"+mode+"'><div class='icon'>"+icon+"</div><h3>"+title+"</h3><p>"+text+"</p><b>"+note+" →</b></article>";
}
function startQuiz(n,encore,boss,filterFn){
  touchStudy();
  let pool = QB.questions.slice();
  if(encore) pool = pool.filter(q=>state.missed.includes(q.id));
  if(filterFn) pool = pool.filter(filterFn);
  if(!pool.length){toast("No questions in this set yet");return;}
  const qs = shuffle(pool).slice(0,Math.min(n,pool.length));
  activeQuiz={questions:qs,index:0,correct:0,answers:[],boss:!!boss,locked:false,start:Date.now()};
  view=boss?"boss":"quiz";
  renderQuizQuestion();
}
function renderQuizQuestion(){
  const app=document.getElementById("app");
  const a=activeQuiz;
  if(!a || a.index>=a.questions.length){return finishQuiz();}
  const q=a.questions[a.index];
  const pct=Math.round((a.index/a.questions.length)*100);
  app.innerHTML="<section class='quiz-wrap'><div class='quiz-top'><button class='lesson-close' id='quitQuiz'>←</button><div class='quiz-progress'><i style='width:"+pct+"%'></i></div><span class='lesson-count'>"+(a.index+1)+"/"+a.questions.length+"</span></div>"+
    "<article class='card quiz-card'><div class='eyebrow'>"+(a.boss?"FINAL BOSS":"ACTIVE RECALL")+" · "+esc(q.topic)+"</div><h2>"+esc(q.q)+"</h2><div class='badges'><span class='badge "+sourceClass(q.source)+"'>"+esc(q.source)+"</span></div>"+
    "<div class='choices'>"+q.choices.map((c,i)=>"<button class='choice' data-pick='"+i+"'>"+esc(c)+"</button>").join("")+"</div><div id='quizFeedback' class='feedback'></div>"+
    "<div class='quiz-footer'><span class='pill'>"+(a.boss?"Answers hidden until finish":"Immediate feedback")+"</span><button class='btn btn-primary' id='quizNext' disabled>"+(a.index===a.questions.length-1?"Finish":"Next →")+"</button></div></article></section>";
  document.getElementById("quitQuiz").onclick=()=>{activeQuiz=null;setView(a.boss?"boss":"quiz");};
  const next=document.getElementById("quizNext");
  document.querySelectorAll("[data-pick]").forEach(btn=>btn.onclick=()=>{
    if(a.locked)return;
    a.locked=true;
    const pick=Number(btn.dataset.pick);
    const correct=pick===q.a;
    if(correct)a.correct++;
    a.answers.push({id:q.id,pick:pick,correct:correct});
    if(correct){
      state.missed=state.missed.filter(id=>id!==q.id);
    }else if(!state.missed.includes(q.id)) state.missed.push(q.id);
    if(!a.boss){
      btn.classList.add(correct?"correct":"wrong");
      const fb=document.getElementById("quizFeedback");
      fb.className="feedback show "+(correct?"good":"bad");
      fb.innerHTML=(correct?"<strong>Correct.</strong> ":"<strong>Missed.</strong> ")+esc(q.why);
      document.querySelectorAll("[data-pick]").forEach((b,i)=>{if(i===q.a)b.classList.add("correct");else if(i!==pick)b.classList.add("dim");});
    }
    save();
    next.disabled=false;
    next.onclick=()=>{a.index++;a.locked=false;renderQuizQuestion();window.scrollTo(0,0);};
  });
}
function finishQuiz(){
  clearInterval(bossTimer);bossTimer=null;
  const app=document.getElementById("app");
  const a=activeQuiz;
  const pct=Math.round(a.correct/a.questions.length*100);
  const missed=a.answers.filter(x=>!x.correct);
  if(a.boss) state.bestBoss=Math.max(state.bestBoss||0,pct);
  else state.bestQuiz=Math.max(state.bestQuiz||0,pct);
  state.xp+=Math.round(a.correct*(a.boss?5:3));
  save();
  app.innerHTML="<section class='card results'><div class='kicker'>"+(a.boss?"FINAL BOSS RESULT":"QUIZ RESULT")+"</div><div class='score-big'>"+pct+"%</div><h2>"+a.correct+" of "+a.questions.length+" correct</h2>"+
    "<div class='breakdown'><div class='break'><span>Correct</span><b>"+a.correct+"</b></div><div class='break'><span>Missed</span><b>"+missed.length+"</b></div><div class='break'><span>Encore deck</span><b>"+state.missed.length+"</b></div></div>"+
    (missed.length?"<div class='callout'><strong>Your misses are saved.</strong> Go to Quiz Arena → Encore Deck and make them disappear.</div>":"<div class='callout'><strong>Clean sweep.</strong> Nothing added to the Encore Deck.</div>")+
    "<div class='cta'><button class='btn btn-primary' id='runAgain'>Run another set</button><button class='btn btn-secondary' id='studyMisses'>Study misses</button></div></section>";
  document.getElementById("runAgain").onclick=()=>{activeQuiz=null;setView(a.boss?"boss":"quiz");};
  document.getElementById("studyMisses").onclick=()=>{activeQuiz=null;setView("quiz");setTimeout(()=>{if(state.missed.length)startQuiz(state.missed.length,true,false);},30);};
}

function renderTimeline(app){
  app.innerHTML="<div class='view-heading'><div class='kicker'>TIMELINE LAB</div><h1>Turn dates into a story.</h1><p>You do not need to worship dates. Use them to see causation: technology, migration, markets, crossover, backlash, revival, globalization.</p></div>"+
    "<section class='timeline'>"+D.timeline.map(e=>"<article class='event'><div class='year'>"+esc(e.year)+"</div><h3>"+esc(e.title)+"</h3><p>"+esc(e.text)+"</p></article>").join("")+"</section>"+
    "<div class='section-head'><div><h2>Ordering challenge</h2><p>Build chronology from memory.</p></div></div><div id='orderGame'></div>";
  startOrder(0);
}
function startOrder(idx){
  const host=document.getElementById("orderGame");if(!host)return;
  const set=QB.orderSets[idx%QB.orderSets.length];
  activeOrder={set:set,remaining:shuffle(set.events),picked:[],idx:idx};
  renderOrder();
}
function renderOrder(){
  const host=document.getElementById("orderGame");
  const o=activeOrder;
  host.innerHTML="<article class='card order-game'><div class='eyebrow'>ORDER GAME "+(o.idx+1)+"/"+QB.orderSets.length+"</div><h3>"+esc(o.set.title)+"</h3><p>Click from earliest to latest.</p><div class='order-list'>"+o.remaining.map((e,i)=>"<button class='order-option' data-order='"+i+"'>"+esc(e[1])+"</button>").join("")+"</div><div class='order-sequence'>"+(o.picked.length?o.picked.map(e=>esc(e[1])).join(" → "):"Your sequence appears here")+"</div><div class='cta'><button class='btn btn-primary' id='checkOrder' "+(o.remaining.length?"disabled":"")+">Check order</button><button class='btn btn-secondary' id='resetOrder'>Reset</button></div><div id='orderFeedback' class='feedback'></div></article>";
  host.querySelectorAll("[data-order]").forEach(b=>b.onclick=()=>{
    const i=Number(b.dataset.order);o.picked.push(o.remaining[i]);o.remaining.splice(i,1);renderOrder();
  });
  document.getElementById("resetOrder").onclick=()=>startOrder(o.idx);
  document.getElementById("checkOrder").onclick=()=>{
    const correct=o.set.events.every((e,i)=>o.picked[i]===e);
    const f=document.getElementById("orderFeedback");f.className="feedback show "+(correct?"good":"bad");
    f.innerHTML=correct?"<strong>Correct.</strong> Chronology locked in.":"<strong>Not quite.</strong> Correct order: "+o.set.events.map(e=>esc(e[1])).join(" → ");
    if(correct){state.xp+=15;save();toast("+15 XP");setTimeout(()=>startOrder((o.idx+1)%QB.orderSets.length),1200);}
  };
}

function renderReadings(app){
  app.innerHTML="<div class='view-heading'><div class='kicker'>READING RESCUE</div><h1>You did not read it. Start here.</h1><p>These are compact exam-oriented rescues, not fake replacements for material we do not have. Each card tells you whether it comes from course material, public reading context, or syllabus-only preview.</p></div>"+
    "<section class='reading-grid'>"+D.readings.map(r=>"<article class='card reading'><div class='eyebrow'>WEEK "+esc(r.week)+"</div><h3>"+esc(r.title)+"</h3><span class='badge status "+sourceClass(r.source)+"'>"+esc(r.source)+"</span><p>"+esc(r.summary)+"</p><ul>"+r.bullets.map(b=>"<li>"+esc(b)+"</li>").join("")+"</ul></article>").join("")+"</section>";
}


function renderNotes(app){
  const R=window.ROCK_REVIEW;
  if(!R){app.innerHTML="<div class='empty'>Review notebook is not loaded.</div>";return;}
  const renderCards=function(items){
    const host=document.getElementById("reviewGrid");
    if(!host)return;
    host.innerHTML=items.map(function(r){
      return "<details class='card review-card' open><summary><div><span class='review-num'>"+esc(r.label)+"</span><strong>"+esc(r.title)+"</strong><span class='badge "+sourceClass(r.source)+"'>"+esc(r.source)+"</span></div><span class='review-chevron'>⌄</span></summary><div class='review-body'><div class='review-prompt'>"+esc(r.prompt)+"</div>"+r.answer+"<div class='review-must'><span>DO NOT LEAVE OUT</span><ul>"+r.must.map(function(x){return "<li>"+esc(x)+"</li>";}).join("")+"</ul></div></div></details>";
    }).join("");
  };
  app.innerHTML="<div class='view-heading'><div class='kicker'>OPEN-NOTE EXAM NOTEBOOK</div><h1>Every review-sheet prompt, answered.</h1><p>This is built to be useful both while studying and as a clean set of notes to print before the exam. It prioritizes your professor's slides, review sheet, readings, and your own Assignment 1 findings. Supplemental background is labeled separately.</p></div>"+
  "<section class='card notebook-tools'><div><strong>"+R.prompts.length+" review prompts covered</strong><p>The review sheet says it is not an outline of the exam, so this notebook is paired with the full quest and question bank rather than replacing them.</p></div><div class='notebook-actions'><input id='reviewSearch' class='review-search' placeholder='Search Chicago, Johnson, radio, Chuck Berry...'><button class='btn btn-primary' id='printNotes'>Print / Save PDF</button><button class='btn btn-secondary' id='collapseNotes'>Collapse all</button></div></section>"+
  "<section class='review-grid' id='reviewGrid'></section>"+
  "<div class='card notebook-footer'><strong>Exam rule reminder</strong><p>Your review sheet says the exam is open note, but internet and additional sources may not be used during exam time. Print or save the notes you are allowed to use before the exam, and follow your instructor's exact rule.</p></div>";
  renderCards(R.prompts);
  document.getElementById("reviewSearch").addEventListener("input",function(e){
    const term=e.target.value.toLowerCase().trim();
    const items=!term?R.prompts:R.prompts.filter(function(r){
      return (r.title+" "+r.prompt+" "+r.answer+" "+r.must.join(" ")).toLowerCase().includes(term);
    });
    renderCards(items);
  });
  document.getElementById("printNotes").onclick=function(){window.print();};
  document.getElementById("collapseNotes").onclick=function(){
    document.querySelectorAll(".review-card").forEach(function(x){x.open=false;});
  };
}


function startBalancedBoss(){
  touchStudy();
  let qs=[];
  D.worlds.forEach(function(w){
    const pool=shuffle(QB.questions.filter(function(q){return q.world===w.id;}));
    qs=qs.concat(pool.slice(0,Math.min(3,pool.length)));
  });
  qs=qs.concat(shuffle(QB.questions.filter(function(q){return q.world==="mix";})).slice(0,6));
  qs=shuffle(qs);
  activeQuiz={questions:qs,index:0,correct:0,answers:[],boss:true,locked:false,start:Date.now()};
  view="boss";
  renderQuizQuestion();
}

function renderBossHome(app){
  const ready=state.completed.length>=Math.ceil(D.worlds.length*.7);
  app.innerHTML="<section class='card boss-hero'><div><div class='kicker'>FINAL BOSS</div><h2>42 balanced questions. No hints. No instant feedback.</h2><p>This sim forces coverage across every quest world, then adds synthesis questions. One lucky random draw cannot hide a weak unit.</p><div class='cta'><button class='btn btn-primary' id='startBoss'>Start exam sim</button><button class='btn btn-secondary' id='encoreBoss'>Clear Encore first</button></div></div>"+
    "<div class='boss-meter'><span>READINESS</span><b>"+overallMastery()+"%</b><p>"+(ready?"You have enough quest coverage for a serious attempt.":"Preview is allowed, but clear more quest worlds first for a fair score.")+"</p>"+(state.bestBoss!=null?"<span>BEST SCORE</span><b>"+state.bestBoss+"%</b>":"")+"</div></section>"+
    "<div class='section-head'><div><h2>Boss rules</h2><p>Answer from memory. Your score appears only after the run is complete.</p></div></div>"+
    "<section class='mode-grid'>"+modeCard("🧩","Concepts","Genre, technology, race, culture","Mixed") + modeCard("🎤","Artists","Style fingerprints and influence","Mixed") + modeCard("🔗","Connections","Cause and effect across weeks","Mixed")+"</section>"+
    "<button class='reset' id='resetProgress'>Reset all Rock Quest progress</button>";
  document.getElementById("startBoss").onclick=startBalancedBoss;
  document.getElementById("encoreBoss").onclick=()=>{if(state.missed.length)startQuiz(state.missed.length,true,false);else toast("Encore Deck is empty");};
  document.getElementById("resetProgress").onclick=()=>{if(confirm("Reset all History of Rock Quest progress?")){state=Object.assign({},defaults,{completed:[],lessonProgress:{},quizPassed:{},missed:[],flashMastery:{}});localStorage.setItem(KEY,JSON.stringify(state));render();updateTopStats();}};
}

document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
document.addEventListener("keydown",e=>{if(e.key==="Escape" && activeLesson) closeLesson();});
updateStreak();
updateTopStats();
render();
})();
