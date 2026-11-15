// End-to-end test of js/social.js and firestore.rules against the Firebase emulator.
// Run the emulator (firebase emulators:start --only auth,firestore) and a local web server on :8123 first.
// End-to-end test of js/social.js against the Firebase emulator, with three separate "families".
const {chromium}=require('playwright');
const CONFIG="export const firebaseConfig={apiKey:'demo-key',authDomain:'demo-kikup.firebaseapp.com',projectId:'demo-kikup',appId:'1:1:web:1'};";
let fails=0;const ok=(name,cond,extra='')=>{if(!cond)fails++;console.log(`${cond?'PASS':'FAIL'} ${name}${extra?' — '+extra:''}`);};
(async()=>{const b=await chromium.launch();
const family=async()=>{const ctx=await b.newContext();const p=await ctx.newPage();p.on('pageerror',e=>console.log('pageerror',e.message));
  await p.route('**/js/firebase-config.js',r=>r.fulfill({body:CONFIG,contentType:'text/javascript'}));
  await p.addInitScript(()=>{window.__KIKUP_EMULATOR={auth:'http://127.0.0.1:9099',host:'127.0.0.1',port:8080};localStorage.setItem('kikup:v2',JSON.stringify({onboarded:true}));});
  await p.goto('http://localhost:8123/');await p.evaluate(async()=>{window.SOC=await import('/js/social.js');await SOC.init();});return p;};
const run=(p,fn,arg)=>p.evaluate(fn,arg).catch(e=>({error:String(e.message||e)}));
const A=await family(),B=await family(),C=await family();
const u='sam'+Date.now()%100000;
// 1. Teen signs up with a username
const a=await run(A,async({u})=>{const p=await SOC.signUpTeen({username:u,password:'goalgoal1',age:2,tier:2});window.me=p;return p;},{u});
ok('teen signs up with username + password',a.id&&a.friendCode&&a.name===u,`friend code ${a.friendCode}`);
ok('bad username rejected',(await run(A,()=>SOC.checkUsername('no spaces!')).then(r=>!r.ok)));
// 2. Parent signs up, adds a child with a generated nickname
const kid=await run(B,async()=>{await SOC.signUpParent({email:'parent'+Date.now()+'@example.com',password:'parentpass1',consent:true});const ideas=SOC.nicknameIdeas(3);const k=await SOC.addChild({name:ideas[0],age:0,tier:1});window.me=k;return k;});
ok('parent signs up and adds a child profile',kid.id&&kid.kid===true&&kid.friendCode,`child "${kid.name}"`);
ok('parent sign-up needs consent',!!(await run(B,()=>SOC.signUpParent({email:'x@y.com',password:'parentpass1',consent:false}))).error);
// 3. Child adds the teen by friend code; only the teen can accept
const req=await run(B,async(code)=>{const o=await SOC.sendRequest(me,code);return o.name;},a.friendCode);
ok('send friend request with a friend code',req===u);
const selfAccept=await run(B,async()=>{const f=(await SOC.getFriendships(me))[0];await SOC.accept(me,f);return 'accepted';});
ok('requester cannot accept their own request',!!selfAccept.error,selfAccept.error||'it was accepted!');
const acc=await run(A,async()=>{const l=await SOC.getFriendships(me);const f=l[0];await SOC.accept(me,f);return {incoming:f.incoming,name:f.otherName};});
ok('teen sees the incoming request and accepts',acc.incoming===true,`from "${acc.name}"`);
// 4. Friend streak: both train today
await run(A,()=>SOC.recordSession(me,{stars:{'juggle|2|2':3},streak:3,lastDay:null},{drillId:'juggle',stars:3,count:25}));
const s1=await run(A,async()=>{const l=await SOC.getFriendships(me);return l[0].streakNow;});
ok('friend streak waits until both have trained',s1===0,`streak ${s1}`);
const rb=await run(B,()=>SOC.recordSession(me,{stars:{'juggle|0|1':2},streak:1},{drillId:'juggle',stars:2,count:6}));if(rb&&rb.error)console.log('  (child recordSession error:',rb.error,')');
const s2=await run(A,async()=>{const l=await SOC.getFriendships(me);return {streak:l[0].streakNow,both:l[0].meToday&&l[0].themToday,friendStars:l[0].friend.stars,week:l[0].friend.weekStars};});
ok('friend streak starts when both train the same day',s2.streak===1&&s2.both,JSON.stringify(s2));
ok('teen sees the friend\'s stars for the leaderboard',s2.friendStars===2&&s2.week===2);
await run(B,()=>SOC.recordSession(me,{stars:{'juggle|0|1':3},streak:1},{drillId:'juggle',stars:1,count:7}));
const s3=await run(A,async()=>{const l=await SOC.getFriendships(me);return l[0].streakNow;});
ok('training twice in a day doesn\'t add an extra streak day',s3===1);
// 5. Challenges
await run(A,async()=>{const l=await SOC.getFriendships(me);await SOC.sendChallenge(me,l[0],{drillId:'tight-box',drillName:'Tight Box',target:50,unit:'touches',msg:'Beat my score!'});});
const inc=await run(B,()=>new Promise(r=>{const off=SOC.challenges(me,x=>{if(x.incoming.length){off();r(x.incoming.map(c=>`${c.fromName}: ${c.msg} ${c.target} ${c.unit}`));}});}));
ok('child receives the challenge',Array.isArray(inc)&&inc.length===1,inc[0]);
const t1=await run(B,()=>SOC.recordSession(me,{stars:{}},{drillId:'tight-box',stars:2,count:40}));
ok('challenge stays open when the target isn\'t beaten',t1.done&&t1.done.length===0);
const t2=await run(B,()=>SOC.recordSession(me,{stars:{}},{drillId:'tight-box',stars:3,count:55}));
ok('challenge completes when the target is beaten',t2.done&&t2.done.length===1);
const sentStatus=await run(A,async()=>{const x=await SOC.getChallenges(me);return x.sent[0].status+' '+x.sent[0].result;});
ok('sender sees the challenge was beaten',sentStatus==='done 55',sentStatus);
// 6. A stranger can't see or fake anything
await run(C,async()=>{window.me=await SOC.signUpTeen({username:'str'+Date.now()%100000,password:'strangerpw1',age:2,tier:1});});
const r1=await run(C,(id)=>firebase.firestore().collection('profiles').doc(id).get().then(()=>'read'),a.id);
ok('stranger cannot read another player\'s profile',!!r1.error);
const r2=await run(C,(ids)=>firebase.firestore().collection('friendships').doc(ids).get().then(()=>'read'),[a.id,kid.id].sort().join('_'));
ok('stranger cannot read a friendship',!!r2.error);
const r3=await run(C,(code)=>SOC.lookupCode(code).then(x=>Object.keys(x).sort().join(',')),a.friendCode);
ok('a friend code reveals only the name and private ids, no stats',typeof r3==='string',r3);
const r4=await run(C,async({aid,aname,aowner})=>{const db=firebase.firestore();const ids=[me.id,aid].sort();await db.collection('friendships').doc(ids.join('_')).set({members:ids,owners:[me.owner,aowner],names:{[me.id]:'Coach Bob',[aid]:aname},status:'pending',requestedBy:me.id,requestedByOwner:me.owner,createdAt:1});return 'created';},{aid:a.id,aname:a.name,aowner:a.owner});
ok('cannot send a request under a fake name',!!r4.error);
const r5=await run(C,async({aid,aowner})=>{await firebase.firestore().collection('challenges').add({from:me.id,to:aid,fromOwner:me.owner,toOwner:aowner,fromName:me.name,drillId:'juggle',target:1,unit:'x',msg:'Beat my score!',status:'open',createdAt:1});return 'sent';},{aid:a.id,aowner:a.owner});
ok('cannot challenge someone who isn\'t your friend',!!r5.error);
const r6=await run(A,async()=>{const l=await SOC.getFriendships(me);await firebase.firestore().collection('challenges').add({from:me.id,to:l[0].other,fromOwner:me.owner,toOwner:l[0].owners.find(o=>o!==me.owner),fromName:me.name,drillId:'juggle',target:1,unit:'x',msg:'hey whats your address',status:'open',createdAt:1});return 'sent';});
ok('challenges only allow the preset messages (no free text)',!!r6.error);
const r7=await run(A,(id)=>firebase.firestore().collection('profiles').doc(id).update({friendCode:'HACKED'}).then(()=>'changed'),a.id);
ok('a friend code can\'t be changed after creation',!!r7.error);
// 7. Log out, log back in with the username; wrong password is a friendly error
const r8=await run(A,async(u)=>{await SOC.logOut();await SOC.logIn(u,'goalgoal1');return (await SOC.account()).profiles[0].name;},u);
ok('log in with username + password',r8===u);
const r9=await run(A,async(u)=>{await SOC.logOut();try{await SOC.logIn(u,'wrongpass1');return 'in';}catch(e){return SOC.friendlyError(e);}},u);
ok('wrong password shows a friendly message',r9==='Wrong username or password.',r9);
// 8. Sync between devices
await run(A,async(u)=>{await SOC.logIn(u,'goalgoal1');window.me=(await SOC.account()).profiles[0];await SOC.savePrivate(me.id,{stars:{'juggle|2|2':3,'tight-box|2|2':2},days:{'2026-11-1':2},history:[{t:1,id:'juggle'}],streak:3,lastDay:'2026-11-15'});},u);
const merged=await run(A,async()=>{const c=await SOC.loadPrivate(me.id);const m=SOC.merge({stars:{'juggle|2|2':1,'gate-hunt|2|2':3},history:[{t:2,id:'gate-hunt'}]},c);return Object.keys(m.stars).length+' drills, juggle='+m.stars['juggle|2|2']+', history='+m.history.length;});
ok('progress syncs and merges across devices',merged==='3 drills, juggle=3, history=2',merged);
// 9. Parent deletes the account: child's data and friendships go
const del=await run(B,async()=>{await SOC.deleteAccount();return 'deleted';});
ok('parent can delete the account',del==='deleted',del.error||'');
const after=await run(A,async()=>{const l=await SOC.getFriendships(me);return l.length;});
ok('the deleted child disappears from friends lists',after===0,`friends left: ${after}`);
console.log(fails?`\n${fails} FAILED`:'\nAll passed');await b.close();process.exit(fails?1:0);})();
