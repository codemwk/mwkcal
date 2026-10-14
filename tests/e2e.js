const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});const errs=[];
for(const [w,h,name,dark] of [[412,915,'folded',false],[884,1104,'unfolded',true]]){
 const ctx=await b.newContext({viewport:{width:w,height:h},hasTouch:true,isMobile:true,deviceScaleFactor:2,colorScheme:dark?'dark':'light'});
 const p=await ctx.newPage();p.on('console',m=>m.type()==='error'&&errs.push(m.text()));p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://localhost:8765/');await p.screenshot({path:`screens/${name}-empty.png`});
 const k=async s=>{for(const c of (s==='back'?[s]:s))await p.click(`#pad button[data-k="${c}"]`)};
 await p.mouse.click(40,60);await k('200+10%');await k('=');
 await p.mouse.click(40,160);await k('50*10%=');
 await p.mouse.click(40,260);await k('2^10=');
 await p.mouse.click(40,360);await p.click('[data-res="1"]');await k('*2');
 const t1=await p.textContent('[data-res="4"]');
 await k('=');await p.click('.calc[data-id="1"] .expr');await k('back');await k('back');await k('back');await k('100');
 const t2=await p.textContent('[data-res="4"]');const t1r=await p.textContent('[data-res="1"]');
 console.log(name,'ref result',t1,'after edit',t1r,t2);
 await p.screenshot({path:`screens/${name}-calcs.png`});
 const sw=await p.evaluate(async()=>!!(await navigator.serviceWorker.ready));
 const ls=await p.evaluate(()=>JSON.parse(localStorage['tydlig-state-v1']).calcs.length);
 await p.reload();const n=await p.locator('.calc').count();console.log(name,'sw',sw,'saved',ls,'after reload',n);
 await ctx.close();}
console.log('console errors:',errs.length?errs:'none');await b.close();})();
