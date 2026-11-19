// Generates 640x480 JPEG menu illustrations for Butter Bunny bakery.
const {chromium} = require('playwright');
const path = require('path');
const out = path.join(__dirname, '..', '..', 'public', 'assets', 'illustrations');

const BG = {bread:['#FCEBC8','#F6D99E'], cake:['#FBE0E3','#F4C3CB'], coffee:['#F3E3D6','#E6C9B3'], drink:['#DDEDF5','#BBDDEC'], juice:['#FFE8CF','#FFD0A1'], matcha:['#E3F0DA','#C8E2B8']};
const wrap = (bg, body, shadow = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>
<pattern id="dots" width="44" height="44" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="3" fill="#fff" opacity=".45"/><circle cx="30" cy="30" r="2" fill="#fff" opacity=".35"/></pattern></defs>
<rect width="640" height="480" fill="url(#g)"/><rect width="640" height="480" fill="url(#dots)"/>
${shadow ? '<ellipse cx="320" cy="392" rx="190" ry="26" fill="#000" opacity=".08"/>' : ''}
${body}</svg>`;
const plate = (y = 360, rx = 200) => `<ellipse cx="320" cy="${y}" rx="${rx}" ry="${rx*0.22}" fill="#fff"/><ellipse cx="320" cy="${y-4}" rx="${rx*0.78}" ry="${rx*0.15}" fill="#F4F1EC"/>`;
const sparkle = (x, y, s = 1, c = '#fff') => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-14C2-4 4-2 14 0 4 2 2 4 0 14-2 4-4 2-14 0-4-2-2-4 0-14Z" fill="${c}" opacity=".9"/>`;
const steam = (x, y) => [0, 34, 68].map(d => `<path d="M${x+d} ${y}c-14-18 14-30 0-50s14-30 0-48" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".75"/>`).join('');
const face = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><circle cx="-16" cy="0" r="5" fill="#4A3426"/><circle cx="16" cy="0" r="5" fill="#4A3426"/><path d="M-7 8q7 7 14 0" fill="none" stroke="#4A3426" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="-28" cy="10" rx="8" ry="5" fill="#F29A9A" opacity=".55"/><ellipse cx="28" cy="10" rx="8" ry="5" fill="#F29A9A" opacity=".55"/></g>`;
const ice = (x, y, r = 0) => `<rect x="${x}" y="${y}" width="38" height="38" rx="9" transform="rotate(${r} ${x+19} ${y+19})" fill="#fff" opacity=".55" stroke="#fff" stroke-width="3"/>`;
const straw = (x, c = '#F28CA0') => `<rect x="${x}" y="40" width="20" height="170" rx="10" transform="rotate(12 ${x} 120)" fill="${c}"/><rect x="${x}" y="40" width="20" height="170" rx="10" transform="rotate(12 ${x} 120)" fill="url(#stripes)"/>`;
const stripes = `<defs><pattern id="stripes" width="20" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><rect width="20" height="10" fill="#fff" opacity=".6"/></pattern></defs>`;

// cup (hot drinks)
const cup = (fill, top) => `${plate(372, 170)}
<path d="M200 220h220l-18 130q-4 26-30 26H248q-26 0-30-26Z" fill="#FFFDF9" stroke="#E9DCCF" stroke-width="4"/>
<path d="M420 246c46-4 56 58 8 70" fill="none" stroke="#FFFDF9" stroke-width="20" stroke-linecap="round"/>
<path d="M420 246c46-4 56 58 8 70" fill="none" stroke="#E9DCCF" stroke-width="4" stroke-linecap="round" opacity=".6"/>
<ellipse cx="310" cy="222" rx="110" ry="24" fill="#FFFDF9" stroke="#E9DCCF" stroke-width="4"/>
<ellipse cx="310" cy="224" rx="96" ry="18" fill="${fill}"/>${top || ''}
<path d="M226 300h168" stroke="${fill}" stroke-width="10" opacity=".35" stroke-linecap="round"/>`;
// tall glass (cold drinks)
const glass = (layers, extra = '') => `${stripes}
<path d="M230 120h180l-20 250q-2 22-24 22H274q-22 0-24-22Z" fill="#fff" opacity=".55"/>
<clipPath id="gl"><path d="M234 150h172l-18 218q-2 20-22 20H274q-20 0-22-20Z"/></clipPath>
<g clip-path="url(#gl)">${layers}</g>${extra}
<path d="M230 120h180l-20 250q-2 22-24 22H274q-22 0-24-22Z" fill="none" stroke="#fff" stroke-width="6"/>
<path d="M262 150l12 210" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".55"/>`;

const items = {
  'm-croissant': wrap(BG.bread, `${plate()}
    <g transform="translate(320 300)">
      <path d="M-190 40C-170-30-90-70 0-74 90-70 170-30 190 40 150 10 100 4 60 16 30-10-30-10-60 16-100 4-150 10-190 40Z" fill="#D9913A"/>
      ${[-150,-95,-35,35,95,150].map((x,i)=>`<path d="M${x} ${i%5===0?20:-10}q${x>0?-30:30} -40 ${x>0?-10:10} -60" fill="none" stroke="#B8702A" stroke-width="7" stroke-linecap="round" opacity=".7"/>`).join('')}
      <path d="M-120-30C-60-62 60-62 120-30" fill="none" stroke="#F2C27A" stroke-width="12" stroke-linecap="round" opacity=".8"/>
      ${face(0,-12,1)}
    </g>${sparkle(470,150,1.2)}${sparkle(170,170,.8)}`),
  'm-painchoc': wrap(BG.bread, `${plate()}
    <g transform="translate(320 290)">
      <rect x="-160" y="-70" width="320" height="130" rx="50" fill="#D48A3A"/>
      <rect x="-150" y="-62" width="300" height="40" rx="20" fill="#E9A955" opacity=".9"/>
      ${[-100,-40,20,80].map(x=>`<path d="M${x}-66q20 60 0 124" fill="none" stroke="#B46E2C" stroke-width="6" opacity=".55"/>`).join('')}
      <ellipse cx="-160" cy="-5" rx="22" ry="34" fill="#5A3322"/><ellipse cx="160" cy="-5" rx="22" ry="34" fill="#5A3322"/>
      ${face(0,0,1)}
    </g>${sparkle(480,140)}${sparkle(160,160,.7)}`),
  'm-wholewheat': wrap(BG.bread, `<rect x="110" y="330" width="420" height="40" rx="12" fill="#C99A6B"/><rect x="110" y="330" width="420" height="10" rx="5" fill="#DDB287"/>
    <g transform="translate(320 250)">
      <path d="M-180 80V-20q0-80 180-80t180 80V80Z" fill="#A86B3C"/>
      <path d="M-170 -20q0-70 170-70t170 70" fill="none" stroke="#C88A52" stroke-width="16" stroke-linecap="round"/>
      ${[-100,-30,40,110].map(x=>`<path d="M${x-25}-40l40-40" stroke="#E7C08F" stroke-width="12" stroke-linecap="round"/>`).join('')}
      ${Array.from({length:22},(_,i)=>`<ellipse cx="${-160+((i*67)%320)}" cy="${-10+((i*37)%80)}" rx="4" ry="2.4" fill="#7A4A26" opacity=".6"/>`).join('')}
      ${face(0,30,1)}
    </g>${sparkle(500,120)}`),
  'm-cinnamon': wrap(BG.bread, `${plate()}
    <g transform="translate(320 285)">
      <ellipse cx="0" cy="25" rx="150" ry="70" fill="#B8743A"/>
      <ellipse cx="0" cy="0" rx="150" ry="72" fill="#D89A55"/>
      <path d="M0 0m-20 0a20 14 0 1 1 40 0a44 30 0 1 1-88 0a72 48 0 1 1 144 0a100 64 0 1 1-200 0" fill="none" stroke="#9A5A28" stroke-width="12" stroke-linecap="round"/>
      <path d="M-120-20q30 30 60 0t60 0 60 0 50 10" fill="none" stroke="#FFF7EC" stroke-width="12" stroke-linecap="round" opacity=".95"/>
      <path d="M-90 30q30 22 60 0t60 0 60 0" fill="none" stroke="#FFF7EC" stroke-width="10" stroke-linecap="round" opacity=".9"/>
    </g>${sparkle(480,140)}${sparkle(170,150,.8)}`),
  'm-brownie': wrap(BG.cake, `${plate()}
    <g transform="translate(320 300)">
      <path d="M-130-40l110-50 150 40-110 56Z" fill="#6B3B26"/>
      <path d="M-130-40v80l130 56v-80Z" fill="#4A2618"/><path d="M0 56V-24l130-26v76Z" fill="#5A2F1E"/>
      <path d="M-100-44l80-34 110 30" fill="none" stroke="#8C5338" stroke-width="10" stroke-linecap="round"/>
      ${[[-60,-40],[20,-55],[60,-30],[-20,-20]].map(([x,y])=>`<rect x="${x}" y="${y}" width="16" height="12" rx="3" fill="#2E170E" transform="rotate(20 ${x} ${y})"/>`).join('')}
      ${face(-62,20,.9)}
    </g><circle cx="190" cy="370" r="6" fill="#4A2618"/><circle cx="452" cy="378" r="5" fill="#4A2618"/>${sparkle(470,140)}`),
  'm-basque': wrap(BG.cake, `${plate()}
    <g transform="translate(320 300)">
      <path d="M-150 40L40-80 160 0 -30 100Z" fill="#F7E0A8"/>
      <path d="M-150 40v-40L40-120v40Z" fill="#7A3E1E"/>
      <path d="M40-120l120 80v40L40-80Z" fill="#5E2E16"/>
      <path d="M-150 0L40-120 160-40-30 60Z" fill="#8A4721"/>
      <path d="M-120 0l150-94" stroke="#B8682F" stroke-width="12" stroke-linecap="round" opacity=".6"/>
      <path d="M-150 40v-40l120 60v40Z" fill="#F1D191"/>
      ${face(-60,50,.85)}
    </g>${sparkle(480,130)}${sparkle(160,180,.7)}`),
  'm-yuzu': wrap(BG.cake, `${plate()}
    <g transform="translate(320 300)">
      <path d="M-150 30L60-60 170 10-40 100Z" fill="#FFF1B8"/>
      <path d="M-150 30v-80L60-140v80Z" fill="#FFE27A"/>
      <path d="M-150 -10L60-100" stroke="#FFF8DD" stroke-width="12"/>
      <path d="M-150 -40L60-130" stroke="#F6C94A" stroke-width="8"/>
      <path d="M60-140l110 70v80L60-60Z" fill="#F4CF55"/>
      <path d="M-150-50L60-140 170-70-40 22Z" fill="#FFFBEA"/>
      <g transform="translate(20 -70)"><circle r="40" fill="#F7B92C"/><circle r="32" fill="#FFE07A"/>${[0,45,90,135].map(a=>`<path d="M0 0L${32*Math.cos(a*Math.PI/180)} ${32*Math.sin(a*Math.PI/180)}M0 0L${-32*Math.cos(a*Math.PI/180)} ${-32*Math.sin(a*Math.PI/180)}" stroke="#F7B92C" stroke-width="3"/>`).join('')}</g>
      <path d="M-30-90q-20-30 10-40 10 25-10 40Z" fill="#7DB65A"/>
      ${face(-60,48,.85)}
    </g>${sparkle(480,130)}`),
  'm-eggtart': wrap(BG.bread, `${plate()}
    ${[[-120,10,.85],[120,10,.85],[0,-6,1]].map(([dx,dy,s])=>`<g transform="translate(${320+dx} ${300+dy}) scale(${s})">
      <ellipse cx="0" cy="22" rx="112" ry="44" fill="#C98543"/>
      <ellipse cx="0" cy="0" rx="112" ry="48" fill="#E3A75E"/>
      ${Array.from({length:18},(_,i)=>{const a=i/18*Math.PI*2;return `<circle cx="${110*Math.cos(a)}" cy="${46*Math.sin(a)}" r="11" fill="#E9B66E"/>`}).join('')}
      <ellipse cx="0" cy="0" rx="86" ry="34" fill="#FFD447"/>
      <ellipse cx="-20" cy="-6" rx="20" ry="8" fill="#C97A2A" opacity=".55"/><ellipse cx="28" cy="8" rx="14" ry="6" fill="#C97A2A" opacity=".5"/>
      <ellipse cx="-40" cy="-14" rx="26" ry="8" fill="#fff" opacity=".45"/>
    </g>`).join('')}
    <g transform="translate(320 330)">${face(0,0,.8)}</g>${sparkle(500,140)}${sparkle(150,150,.8)}`),
  'm-americano': wrap(BG.coffee, steam(270, 180) + cup('#3B2418', '<ellipse cx="280" cy="220" rx="30" ry="5" fill="#fff" opacity=".25"/>')),
  'm-latte': wrap(BG.coffee, steam(270, 180) + cup('#C99263', '<path d="M310 238c-30-16-34-34-18-40 10-4 18 4 18 10 0-6 8-14 18-10 16 6 12 24-18 40Z" fill="#FFF8EE"/>')),
  'm-cappuccino': wrap(BG.coffee, steam(270, 180) + cup('#F6EADB', `<ellipse cx="310" cy="216" rx="80" ry="14" fill="#FFF8EE"/>${Array.from({length:30},(_,i)=>`<circle cx="${250+((i*41)%120)}" cy="${212+((i*13)%18)}" r="3" fill="#8A5A3A" opacity=".7"/>`).join('')}`)),
  'm-mocha': wrap(BG.coffee, glass(`<rect x="200" y="150" width="240" height="250" fill="#5B3424"/><rect x="200" y="250" width="240" height="40" fill="#8A5636"/><rect x="200" y="290" width="240" height="110" fill="#3E2216"/>`,
    `<path d="M236 140q-6-40 34-44 10-30 50-26 40-6 52 26 40 4 34 44Z" fill="#FFF8EE"/><path d="M262 104q30 10 60-6 30 16 60 0" fill="none" stroke="#5B3424" stroke-width="8" stroke-linecap="round"/>${sparkle(470,120)}`)),
  'm-thaitea': wrap(BG.juice, glass(`<rect x="200" y="150" width="240" height="250" fill="#F08A3C"/><path d="M200 190q60 40 120 0t120 0V150H200Z" fill="#F9D8B7"/>${ice(262,200,15)}${ice(330,240,-10)}${ice(290,300,25)}`, straw(370) + sparkle(480,130) + sparkle(170,200,.8))),
  'm-matcha': wrap(BG.matcha, glass(`<rect x="200" y="150" width="240" height="250" fill="#7FAE58"/><rect x="200" y="290" width="240" height="110" fill="#F4F0E2"/><path d="M200 290q60-24 120 0t120 0" fill="#A6C97F"/>${ice(262,190,12)}${ice(340,220,-15)}`, straw(370, '#9BCB7B') + sparkle(480,130))),
  'm-cocoa': wrap(BG.coffee, steam(270, 160) + cup('#7A4A30', `${[[270,214],[312,206],[350,218],[292,228]].map(([x,y],i)=>`<rect x="${x}" y="${y}" width="28" height="24" rx="7" fill="${i%2?'#FFD3DD':'#fff'}" transform="rotate(${i*17-20} ${x+14} ${y+12})"/>`).join('')}`)),
  'm-orange': wrap(BG.juice, glass(`<rect x="200" y="150" width="240" height="250" fill="#FFA62B"/><rect x="200" y="150" width="240" height="30" fill="#FFC35C"/>${Array.from({length:14},(_,i)=>`<ellipse cx="${250+((i*53)%150)}" cy="${200+((i*31)%170)}" rx="6" ry="3" fill="#FFD27F" opacity=".8"/>`).join('')}`,
    `<g transform="translate(420 140)"><circle r="56" fill="#F98E1D"/><circle r="46" fill="#FFC14D"/>${[0,30,60,90,120,150].map(a=>`<path d="M0 0L${46*Math.cos(a*Math.PI/180)} ${46*Math.sin(a*Math.PI/180)}M0 0L${-46*Math.cos(a*Math.PI/180)} ${-46*Math.sin(a*Math.PI/180)}" stroke="#F98E1D" stroke-width="3"/>`).join('')}<circle r="8" fill="#FFE3A6"/></g>${straw(300,'#7BC8A4')}`)),
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
