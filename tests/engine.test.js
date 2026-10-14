const E=require('../docs/engine.js');let pass=0,fail=0;
const n=v=>({t:'num',v:String(v)}),o=v=>({t:'op',v}),P={t:'%'},L={t:'('},R={t:')'},ref=id=>({t:'ref',id});
function eq(name,a,b){if(Math.abs(a-b)<1e-9){pass++;}else{fail++;console.log('FAIL',name,a,'!=',b);}}
function ev(t){return E.evaluate(t,()=>{throw Error('noref')})}
eq('1+2*3',ev([n(1),o('+'),n(2),o('*'),n(3)]),7);
eq('(1+2)*3',ev([L,n(1),o('+'),n(2),R,o('*'),n(3)]),9);
eq('10/4',ev([n(10),o('/'),n(4)]),2.5);
eq('-3+5',ev([o('-'),n(3),o('+'),n(5)]),2);
eq('2*-3',ev([n(2),o('*'),o('-'),n(3)]),-6);
eq('200+10%',ev([n(200),o('+'),n(10),P]),220);
eq('200-10%',ev([n(200),o('-'),n(10),P]),180);
eq('50*10%',ev([n(50),o('*'),n(10),P]),5);
eq('50/10%',ev([n(50),o('/'),n(10),P]),500);
eq('10%',ev([n(10),P]),0.1);
eq('10%*50',ev([n(10),P,o('*'),n(50)]),5);
eq('100+(10%)',ev([n(100),o('+'),L,n(10),P,R]),100.1);
eq('2^10',ev([n(2),o('^'),n(10)]),1024);
eq('2^3^2',ev([n(2),o('^'),n(3),o('^'),n(2)]),512);
eq('-2^2',ev([o('-'),n(2),o('^'),n(2)]),-4);
eq('2^-1',ev([n(2),o('^'),o('-'),n(1)]),0.5);
eq('3*2^2',ev([n(3),o('*'),n(2),o('^'),n(2)]),12);
eq('2^10%',ev([n(2),o('^'),n(10),P]),10.24);
eq('auto-close (1+2',ev([L,n(1),o('+'),n(2)]),3);
for(const [nm,t] of [['1+',[n(1),o('+')]],['÷0',[n(1),o('/'),n(0)]],['))',[n(1),R]]]){try{ev(t);fail++;console.log('FAIL no error',nm)}catch(e){pass++}}
if(ev([])!==null){fail++;console.log('FAIL empty')}else pass++;
// dependency graph
const calcs=[{id:1,tokens:[n(100)]},{id:2,tokens:[ref(1),o('+'),n(10),P]},{id:3,tokens:[ref(2),o('*'),n(2)]}];
let r=E.evaluateAll(calcs);eq('ref chain a',r.get(2).value,110);eq('ref chain b',r.get(3).value,220);
calcs[0].tokens=[n(200)];r=E.evaluateAll(calcs);eq('recompute b',r.get(2).value,220);eq('recompute c',r.get(3).value,440);
if(E.dependsOn(calcs,3,1)&&!E.dependsOn(calcs,1,3))pass++;else{fail++;console.log('FAIL dependsOn')}
const cyc=[{id:1,tokens:[ref(2)]},{id:2,tokens:[ref(1)]}];r=E.evaluateAll(cyc);if(r.get(1).error&&r.get(2).error)pass++;else{fail++;console.log('FAIL cycle')}
r=E.evaluateAll([{id:5,tokens:[ref(9),o('+'),n(1)]}]);if(r.get(5).error)pass++;else{fail++;console.log('FAIL missing ref')}
r=E.evaluateAll([{id:1,tokens:[n(1),o('+')]},{id:2,tokens:[ref(1)]}]);if(r.get(2).error)pass++;else{fail++;console.log('FAIL err propagate')}
if(E.format(1234567.5)==='1,234,567.5'&&E.format(0.1+0.2)==='0.3')pass++;else{fail++;console.log('FAIL format',E.format(0.1+0.2))}

// ---- editing helpers ----
function typ(c,cur,keys){for(const k of keys)E.applyKey(c,cur,k);return cur}
function val(c){return ev(c.tokens)}
let c={id:1,tokens:[]};typ(c,{tok:null},['1','2','+','3','%']);eq('type 12+3%',val(c),12.36);
c={id:1,tokens:[]};typ(c,{tok:null},['2','^','1','0']);eq('type 2^10',val(c),1024);
c={id:1,tokens:[]};typ(c,{tok:null},['5','neg','*','3']);eq('neg key',val(c),-15);
c={id:1,tokens:[]};typ(c,{tok:null},['1','2','3','back','+','1','*','*','-','2']);eq('back+op replace+unary',val(c),12-2+0||10);
// selected-number editing: replaces just that number, then appends
c={id:1,tokens:[]};typ(c,{tok:null},['1','0','0','/','4']);let cur={tok:2,fresh:true};typ(c,cur,['5']);eq('tok replace',val(c),20);
typ(c,cur,['0']);eq('tok append',val(c),2);typ(c,cur,['back']);eq('tok back',val(c),20);
typ(c,cur,['neg']);eq('tok neg',val(c),-20);typ(c,cur,['C']);if(c.tokens[2].v==='0'&&cur.fresh)pass++;else{fail++;console.log('FAIL tok C')}
typ(c,cur,['+','1']);if(cur.tok===null&&c.tokens.length===5)pass++;else{fail++;console.log('FAIL op leaves tok mode')}
// link (drag-to-link) + cascade + cycle refusal
const cs=[{id:1,tokens:[n(2),o('+'),n(3)]},{id:2,tokens:[n(100),o('/'),n(4)]}];
if(E.link(cs,1,2,2))pass++;else{fail++;console.log('FAIL link')}
r=E.evaluateAll(cs);eq('linked',r.get(2).value,20);cs[0].tokens[0].v='7';r=E.evaluateAll(cs);eq('cascade',r.get(2).value,10);
if(!E.link(cs,2,1,0)&&!E.link(cs,1,1,0))pass++;else{fail++;console.log('FAIL cycle/self link allowed')}
E.unlinkAll(cs,1,r);if(cs[1].tokens[2].t==='num'&&cs[1].tokens[2].v==='10')pass++;else{fail++;console.log('FAIL unlinkAll',cs[1].tokens[2])}
// division by zero is an error (UI shows '?')
r=E.evaluateAll([{id:1,tokens:[n(1),o('/'),n(0)]}]);if(r.get(1).error)pass++;else{fail++;console.log('FAIL div0')}
// plotting: token 0 becomes x
const pc={id:3,tokens:[n(2),o('^'),n(2),o('+'),ref(1)]};const pv=new Map([[1,{value:1}]]);
const f=E.plotFn(pc,0,pv);eq('plot f(3)',f(3),10);eq('plot f(-2)',f(-2),5);
const g=E.plotFn({id:4,tokens:[n(1),o('/'),n(5)]},2,pv);if(isNaN(g(0)))pass++;else{fail++;console.log('FAIL plot div0 NaN')}
eq('plot tiny x',E.plotFn({id:5,tokens:[n(1),o('*'),n(1)]},2,pv)(1e-7),1e-7);
console.log(`${pass} passed, ${fail} failed`);process.exit(fail?1:0);
