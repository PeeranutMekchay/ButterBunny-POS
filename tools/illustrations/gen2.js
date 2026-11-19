// Second batch of 640x480 menu illustrations (same visual system as gen.js).
const {chromium} = require('playwright');
const path = require('path');
const out = path.join(__dirname, '..', '..', 'public', 'assets', 'illustrations');

const BG = {bread:['#FCEBC8','#F6D99E'], cake:['#FBE0E3','#F4C3CB'], coffee:['#F3E3D6','#E6C9B3'], drink:['#DDEDF5','#BBDDEC'], juice:['#FFE8CF','#FFD0A1'], matcha:['#E3F0DA','#C8E2B8'], pink:['#FDE4EC','#F8C6D6'], other:['#E6F0E2','#CFE3C6']};
const wrap = (bg, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>
<pattern id="dots" width="44" height="44" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="3" fill="#fff" opacity=".45"/><circle cx="30" cy="30" r="2" fill="#fff" opacity=".35"/></pattern>
<pattern id="stripes" width="20" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><rect width="20" height="10" fill="#fff" opacity=".6"/></pattern></defs>
<rect width="640" height="480" fill="url(#g)"/><rect width="640" height="480" fill="url(#dots)"/>
<ellipse cx="320" cy="392" rx="190" ry="26" fill="#000" opacity=".08"/>${body}</svg>`;
const plate = (y = 360, rx = 200) => `<ellipse cx="320" cy="${y}" rx="${rx}" ry="${rx*0.22}" fill="#fff"/><ellipse cx="320" cy="${y-4}" rx="${rx*0.78}" ry="${rx*0.15}" fill="#F4F1EC"/>`;
const sparkle = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-14C2-4 4-2 14 0 4 2 2 4 0 14-2 4-4 2-14 0-4-2-2-4 0-14Z" fill="#fff" opacity=".9"/>`;
const steam = (x, y) => [0, 34, 68].map(d => `<path d="M${x+d} ${y}c-14-18 14-30 0-50s14-30 0-48" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".75"/>`).join('');
const face = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><circle cx="-16" cy="0" r="5" fill="#4A3426"/><circle cx="16" cy="0" r="5" fill="#4A3426"/><path d="M-7 8q7 7 14 0" fill="none" stroke="#4A3426" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="-28" cy="10" rx="8" ry="5" fill="#F29A9A" opacity=".55"/><ellipse cx="28" cy="10" rx="8" ry="5" fill="#F29A9A" opacity=".55"/></g>`;
const ice = (x, y, r = 0) => `<rect x="${x}" y="${y}" width="38" height="38" rx="9" transform="rotate(${r} ${x+19} ${y+19})" fill="#fff" opacity=".55" stroke="#fff" stroke-width="3"/>`;
const straw = (x, c) => `<rect x="${x}" y="40" width="20" height="170" rx="10" transform="rotate(12 ${x} 120)" fill="${c}"/><rect x="${x}" y="40" width="20" height="170" rx="10" transform="rotate(12 ${x} 120)" fill="url(#stripes)"/>`;
const glass = (layers, extra = '') => `<path d="M230 120h180l-20 250q-2 22-24 22H274q-22 0-24-22Z" fill="#fff" opacity=".55"/>
<clipPath id="gl"><path d="M234 150h172l-18 218q-2 20-22 20H274q-20 0-22-20Z"/></clipPath>
<g clip-path="url(#gl)">${layers}</g>${extra}
<path d="M230 120h180l-20 250q-2 22-24 22H274q-22 0-24-22Z" fill="none" stroke="#fff" stroke-width="6"/>
<path d="M262 150l12 210" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".55"/>`;
const citrus = (x, y, r, rind, flesh) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${rind}"/><circle r="${r*0.82}" fill="${flesh}"/>${[0,30,60,90,120,150].map(a=>`<path d="M${-r*.82*Math.cos(a*Math.PI/180)} ${-r*.82*Math.sin(a*Math.PI/180)}L${r*.82*Math.cos(a*Math.PI/180)} ${r*.82*Math.sin(a*Math.PI/180)}" stroke="${rind}" stroke-width="3"/>`).join('')}</g>`;
const strawberry = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 34C-26 20-30-6-22-16-12-26 12-26 22-16 30-6 26 20 0 34Z" fill="#E8475C"/>${[[-10,-6],[8,-8],[-2,6],[12,8],[-14,10],[2,20]].map(([a,b])=>`<ellipse cx="${a}" cy="${b}" rx="2" ry="3" fill="#FFE38A"/>`).join('')}<path d="M-16-18l8 4 8-10 8 10 8-4-6 10H-10Z" fill="#5FA34A"/></g>`;
const wedge = (top, side, front, extra = '') => `<path d="M-150 30L60-60 170 10-40 100Z" fill="${front}"/><path d="M-150 30v-80L60-140v80Z" fill="${side}"/><path d="M60-140l110 70v80L60-60Z" fill="${side}" opacity=".85"/><path d="M-150-50L60-140 170-70-40 22Z" fill="${top}"/>${extra}`;

const items = {
  'm-mexicanbun': wrap(BG.bread, `${plate()}<g transform="translate(320 300)">
    <path d="M-150 40q0-150 150-150t150 150Z" fill="#E7B46A"/>
    <path d="M-150 10q0-120 150-122t150 122q-30 18-60 4-30 18-60 0-30 18-60 0-30 18-60 0-20 10-30-4Z" fill="#8A5530"/>
    ${[[-90,-40],[-30,-80],[40,-70],[90,-20],[-10,-20],[60,-30]].map(([x,y],i)=>`<path d="M${x} ${y}l${14+i*2} ${-8+i}l${10} ${14}" fill="none" stroke="#C88A52" stroke-width="5" stroke-linecap="round"/>`).join('')}
    ${face(0,20,1)}</g>${sparkle(480,140)}${sparkle(160,160,.8)}`),
  'm-pandantoast': wrap(BG.matcha, `${plate()}<g transform="translate(320 300)">
    <path d="M-120 60V-70q0-60 60-60 30-30 60-30t60 30q60 0 60 60V60Z" fill="#E9B46A"/>
    <path d="M-104 56V-62q0-50 50-50 26-26 54-26t54 26q50 0 50 50V56Z" fill="#FFF3D9"/>
    <path d="M-104-40q0-60 54-60 26-26 50-26t50 26q54 0 54 60v24q-20 16-30 0-12 34-34 6-16 22-40 0-20 30-40 0-22 18-34 0-14 16-30 0Z" fill="#7DBA5C"/>
    <path d="M-60-80q20-10 40 0" stroke="#A9D98A" stroke-width="8" stroke-linecap="round" fill="none"/>
    ${face(0,20,1)}</g>${sparkle(480,130)}`),
  'm-bagel': wrap(BG.bread, `${plate()}<g transform="translate(320 300)">
    <ellipse cx="0" cy="28" rx="150" ry="62" fill="#C27D3E"/><ellipse cx="0" cy="14" rx="150" ry="58" fill="#FFF8EE"/>
    <ellipse cx="0" cy="-6" rx="150" ry="62" fill="#D99448"/><ellipse cx="0" cy="-12" rx="128" ry="48" fill="#E6A85E"/>
    <ellipse cx="0" cy="-6" rx="44" ry="18" fill="#F4F1EC"/>
    ${Array.from({length:26},(_,i)=>{const a=i/26*Math.PI*2, r=86+(i%3)*14;return `<ellipse cx="${r*Math.cos(a)}" cy="${-10+r*0.38*Math.sin(a)}" rx="4" ry="2.4" fill="${i%2?'#FFF6DF':'#3A2A20'}" transform="rotate(${i*31} ${r*Math.cos(a)} ${-10+r*0.38*Math.sin(a)})"/>`}).join('')}
    </g>${sparkle(480,140)}${sparkle(160,160,.8)}`),
  'm-strawshort': wrap(BG.cake, `${plate()}<g transform="translate(320 300)">
    ${wedge('#FFFDF7', '#FFF6E8', '#FFFFFF', `<path d="M-150 -10L60-100" stroke="#F6D7A0" stroke-width="22"/><path d="M-150 -10L60-100" stroke="#F4A1AE" stroke-width="6" stroke-dasharray="16 10"/><path d="M-150 -38L60-128" stroke="#F6D7A0" stroke-width="14"/>`)}
    ${strawberry(30,-112,1.3)}<ellipse cx="-30" cy="-80" rx="24" ry="12" fill="#fff" stroke="#F3E3D2" stroke-width="3"/>
    ${face(-60,50,.85)}</g>${sparkle(480,130)}`),
  'm-chiffon': wrap(BG.matcha, `${plate()}<g transform="translate(320 300)">
    ${wedge('#C8E6A9', '#A7D27E', '#B6DC8E', `<path d="M-150-50L60-140" stroke="#8DBE64" stroke-width="6"/>`)}
    ${Array.from({length:14},(_,i)=>`<circle cx="${-120+((i*53)%260)}" cy="${-30+((i*29)%110)}" r="3" fill="#8DBE64" opacity=".6"/>`).join('')}
    <ellipse cx="20" cy="-96" rx="30" ry="12" fill="#fff"/>${face(-60,48,.85)}</g>${sparkle(480,130)}${sparkle(170,160,.8)}`),
  'm-macaron': wrap(BG.pink, `${plate()}
    ${[['#F6A5B8','#FFF2F5',300,-40],['#A9D98A','#FFFBEA',250,10],['#FFD66B','#FFFFFF',380,12]].map(([c,f,x,dy])=>`<g transform="translate(${x} ${300+dy})">
      <ellipse cx="0" cy="22" rx="62" ry="24" fill="${c}"/><rect x="-58" y="0" width="116" height="16" rx="8" fill="${f}"/><path d="M-60 2q0-6 6-6h108q6 0 6 6" fill="${c}" opacity=".7"/><ellipse cx="0" cy="-12" rx="62" ry="26" fill="${c}"/><ellipse cx="-16" cy="-20" rx="18" ry="6" fill="#fff" opacity=".5"/></g>`).join('')}
    <g transform="translate(300 252)">${face(0,0,.8)}</g>${sparkle(480,140)}${sparkle(160,160,.8)}`),
  'm-cookie': wrap(BG.bread, `${plate()}
    ${[[250,300,1],[390,290,.95]].map(([x,y,s],k)=>`<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="10" rx="98" ry="40" fill="#B9773C"/><ellipse cx="0" cy="0" rx="98" ry="40" fill="#D9A15C"/>
      ${k ? '<path d="M60-34a24 24 0 0 0 38 22 34 34 0 0 1-14 14 24 24 0 0 0-24-36Z" fill="#F4F1EC"/>' : ''}
      ${[[-50,-6],[-10,-18],[30,-4],[0,14],[-60,16],[50,14],[20,-24]].map(([a,b])=>`<ellipse cx="${a}" cy="${b}" rx="9" ry="6" fill="#4A2618"/>`).join('')}</g>`).join('')}
    <g transform="translate(250 300)">${face(0,-6,.8)}</g>${sparkle(500,140)}`),
  'm-chococake': wrap(BG.cake, `${plate()}<g transform="translate(320 300)">
    ${wedge('#4A2618', '#5E3220', '#6B3B26', `<path d="M-150 -10L60-100" stroke="#8C5338" stroke-width="10"/><path d="M-150-50q10 30 20 4 12 36 24-6 12 26 22-8" fill="none" stroke="#3A1C10" stroke-width="12" stroke-linecap="round"/>`)}
    <circle cx="20" cy="-110" r="18" fill="#D6334A"/><path d="M20-128q10-24 24-28" stroke="#5FA34A" stroke-width="4" fill="none"/><circle cx="14" cy="-116" r="5" fill="#fff" opacity=".6"/>
    <ellipse cx="-20" cy="-86" rx="40" ry="10" fill="#6E4130" opacity=".6"/>
    ${face(-60,50,.85)}</g>${sparkle(480,130)}`),
  'm-espresso': wrap(BG.coffee, `${steam(286, 210)}${plate(372, 130)}
    <path d="M240 260h150l-12 80q-4 22-26 22h-74q-22 0-26-22Z" fill="#FFFDF9" stroke="#E9DCCF" stroke-width="4"/>
    <path d="M390 276c34-2 40 40 6 50" fill="none" stroke="#FFFDF9" stroke-width="16" stroke-linecap="round"/>
    <ellipse cx="315" cy="262" rx="75" ry="17" fill="#FFFDF9" stroke="#E9DCCF" stroke-width="4"/><ellipse cx="315" cy="264" rx="64" ry="12" fill="#B87A45"/><ellipse cx="305" cy="262" rx="26" ry="4" fill="#E2B07A" opacity=".8"/>
    <rect x="410" y="344" width="60" height="10" rx="5" fill="#C9A27F" transform="rotate(-12 440 349)"/>`),
  'm-caramel': wrap(BG.coffee, glass(`<rect x="200" y="150" width="240" height="250" fill="#F7EBDC"/><rect x="200" y="150" width="240" height="70" fill="#9A6038"/><path d="M200 220q60 20 120 0t120 0V250H200Z" fill="#C99263"/>${ice(270,280,15)}${ice(330,300,-10)}`,
    `<path d="M236 140q-6-40 34-44 10-30 50-26 40-6 52 26 40 4 34 44Z" fill="#FFF8EE"/><path d="M250 112q20 16 40 0t40 0 40 0 30 6" fill="none" stroke="#D08A2E" stroke-width="8" stroke-linecap="round"/><path d="M276 92q20 12 44 0t44 0" fill="none" stroke="#D08A2E" stroke-width="6" stroke-linecap="round"/>${sparkle(470,120)}`)),
  'm-pinkmilk': wrap(BG.pink, glass(`<rect x="200" y="150" width="240" height="250" fill="#F7A1BC"/><path d="M200 170q60 20 120 0t120 0V150H200Z" fill="#FBD0DE"/>${ice(262,200,15)}${ice(334,236,-10)}${ice(290,300,25)}`, straw(370, '#FFFFFF') + sparkle(480,130) + sparkle(170,200,.8))),
  'm-yuzusoda': wrap(BG.juice, glass(`<rect x="200" y="150" width="240" height="250" fill="#FFE27A" opacity=".85"/>${Array.from({length:16},(_,i)=>`<circle cx="${250+((i*47)%150)}" cy="${170+((i*37)%200)}" r="${3+i%4}" fill="#fff" opacity=".7"/>`).join('')}${ice(262,200,15)}${ice(334,250,-10)}`,
    citrus(420, 140, 54, '#F7B92C', '#FFE07A') + straw(300, '#7BC8A4'))),
  'm-strawsmoothie': wrap(BG.pink, glass(`<rect x="200" y="150" width="240" height="250" fill="#F06C86"/><rect x="200" y="280" width="240" height="120" fill="#FBC6D2"/><path d="M200 280q40-20 80 0t80 0 80 0" fill="#F48CA2"/>`,
    `<path d="M236 140q-6-40 34-44 10-30 50-26 40-6 52 26 40 4 34 44Z" fill="#FFF8EE"/>${strawberry(330,72,1.2)}${sparkle(480,130)}`)),
  'm-lemontea': wrap(BG.juice, glass(`<rect x="200" y="150" width="240" height="250" fill="#D9672E"/><rect x="200" y="150" width="240" height="250" fill="#E8873E" opacity=".6"/>${ice(262,200,15)}${ice(334,250,-10)}${ice(282,300,22)}`,
    citrus(420, 150, 52, '#E8C53A', '#FFF29A') + straw(300, '#F2D25A') + sparkle(170,200,.8))),
  'm-hamcheese': wrap(BG.other, `${plate()}<g transform="translate(320 296)">
    <path d="M-170 30C-150-10-80-30 0-32 80-30 150-10 170 30 120 14 60 10 0 12-60 10-120 14-170 30Z" fill="#D9913A"/>
    <path d="M-168 20q40-24 80-6 30-22 60 0 30-24 60 0 30-22 60 0 30-18 60 6" fill="none" stroke="#7DBA5C" stroke-width="16" stroke-linecap="round"/>
    <path d="M-150 6q75-18 150-10t150 10l-14 14q-136-16-272 0Z" fill="#F4A3A8"/>
    <path d="M-120-6h240l-30 18H-90Z" fill="#FFD447"/>
    <path d="M-176 0C-156-70-90-100 0-104 90-100 156-70 176 0 136-24 90-30 56-20 30-46-30-46-56-20-90-30-136-24-176 0Z" fill="#E4A250"/>
    ${[-130,-70,0,70,130].map((x,i)=>`<path d="M${x} ${i%4===0?-16:-50}q${x>0?-24:24} -30 ${x>0?-8:8} -46" fill="none" stroke="#B8702A" stroke-width="6" stroke-linecap="round" opacity=".7"/>`).join('')}
    ${face(0,-56,.9)}</g>${sparkle(480,130)}${sparkle(160,160,.8)}`),
  'm-donut': wrap(BG.pink, `${plate()}<g transform="translate(320 296)">
    <ellipse cx="0" cy="20" rx="150" ry="66" fill="#D99448"/>
    <path d="M-146 4q0-60 146-64t146 64q-12 28-30 10-14 26-36 8-20 24-40 4-22 22-40 2-22 20-40 2-24 20-40 0-22 18-36-2-20 18-30-4Z" fill="#F7A1BC"/>
    <ellipse cx="0" cy="0" rx="48" ry="20" fill="#F4F1EC"/><ellipse cx="0" cy="4" rx="48" ry="16" fill="#C07D3A"/>
    ${Array.from({length:22},(_,i)=>{const a=i/22*Math.PI*2, r=80+(i%3)*16;return `<rect x="${r*Math.cos(a)}" y="${-6+r*0.34*Math.sin(a)}" width="14" height="4" rx="2" fill="${['#FFFFFF','#7BC8A4','#FFD66B','#8EC5F0'][i%4]}" transform="rotate(${i*47} ${r*Math.cos(a)} ${-6+r*0.34*Math.sin(a)})"/>`}).join('')}
    ${face(-90,0,.7)}</g>${sparkle(480,130)}${sparkle(160,160,.8)}`),
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 640, height: 480}, deviceScaleFactor: 1});
  for (const [id, s] of Object.entries(items)) {
    await p.setContent(`<html><body style="margin:0">${s}</body></html>`);
    await p.screenshot({path: path.join(out, id + '.jpg'), type: 'jpeg', quality: 86, clip: {x:0, y:0, width:640, height:480}});
  }
  await b.close();
})();
