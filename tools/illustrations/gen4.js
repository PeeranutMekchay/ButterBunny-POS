// Whole round "pound cakes" for the made-to-order menu (same visual system as gen.js).
const {chromium} = require('playwright');
const path = require('path');
const out = path.join(__dirname, '..', '..', 'public', 'assets', 'illustrations');
const wrap = (c0, c1, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></radialGradient>
<pattern id="dots" width="44" height="44" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="3" fill="#fff" opacity=".45"/><circle cx="30" cy="30" r="2" fill="#fff" opacity=".35"/></pattern></defs>
<rect width="640" height="480" fill="url(#g)"/><rect width="640" height="480" fill="url(#dots)"/><ellipse cx="320" cy="400" rx="200" ry="26" fill="#000" opacity=".08"/>${body}</svg>`;
const sp = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-14C2-4 4-2 14 0 4 2 2 4 0 14-2 4-4 2-14 0-4-2-2-4 0-14Z" fill="#fff" opacity=".9"/>`;
const face = (x, y) => `<g transform="translate(${x} ${y})"><circle cx="-18" cy="0" r="5.5" fill="#4A3426"/><circle cx="18" cy="0" r="5.5" fill="#4A3426"/><path d="M-8 9q8 8 16 0" fill="none" stroke="#4A3426" stroke-width="4" stroke-linecap="round"/><ellipse cx="-32" cy="12" rx="9" ry="5" fill="#F29A9A" opacity=".6"/><ellipse cx="32" cy="12" rx="9" ry="5" fill="#F29A9A" opacity=".6"/></g>`;
const stand = `<ellipse cx="320" cy="372" rx="190" ry="34" fill="#fff"/><ellipse cx="320" cy="366" rx="160" ry="24" fill="#F4F1EC"/>`;
// a round two-layer cake: side colour, cream band, top colour, drips and toppings
const cake = ({side, band, top, drip, topping}) => `${stand}
  <path d="M170 210v120q0 40 150 40t150-40V210Z" fill="${side}"/>
  <path d="M170 270q0 30 150 30t150-30v14q0 30-150 30t-150-30Z" fill="${band}"/>
  <ellipse cx="320" cy="210" rx="150" ry="44" fill="${top}"/>
  ${drip ? `<path d="M170 212q0 30 20 34 6 30 18 2 14 30 26 6 12 34 26 8 14 30 28 8 16 34 28 6 14 30 28 4 14 32 28 4 14 26 24 0 12 30 22 4 10 26 22-16V210Z" fill="${drip}"/><ellipse cx="320" cy="208" rx="150" ry="42" fill="${drip}"/>` : ""}
  ${topping}${face(320, 320)}`;
const items = {
  'm-poundchoc': wrap('#FBE0E3', '#F4C3CB', cake({side: '#6B3B26', band: '#4A2618', top: '#5A2F1E', drip: '#3A1C10',
    topping: [[240, 196], [290, 182], [350, 182], [400, 196], [320, 214]].map(([x, y]) => `<circle cx="${x}" cy="${y - 10}" r="16" fill="#D6334A"/><circle cx="${x - 5}" cy="${y - 15}" r="5" fill="#fff" opacity=".6"/><path d="M${x} ${y - 26}q8-16 18-18" stroke="#5FA34A" stroke-width="3" fill="none"/>`).join('')}) + sp(500, 120) + sp(150, 150, .8)),
  'm-poundstraw': wrap('#FDE4EC', '#F8C6D6', cake({side: '#FFF8F0', band: '#F48CA2', top: '#FFFFFF', drip: null,
    topping: Array.from({length: 7}, (_, i) => { const a = i / 7 * Math.PI * 2, x = 320 + 105 * Math.cos(a), y = 208 + 28 * Math.sin(a);
      return `<ellipse cx="${x}" cy="${y - 6}" rx="16" ry="10" fill="#FFF"/><path transform="translate(${x} ${y - 20}) scale(.8)" d="M0 34C-26 20-30-6-22-16-12-26 12-26 22-16 30-6 26 20 0 34Z" fill="#E8475C"/><path transform="translate(${x} ${y - 20}) scale(.8)" d="M-16-18l8 4 8-10 8 10 8-4-6 10H-10Z" fill="#5FA34A"/>`; }).join('')}) + sp(500, 120) + sp(150, 150, .8)),
  'm-poundthaitea': wrap('#FFE8CF', '#FFD0A1', cake({side: '#F3A15C', band: '#FFF3E2', top: '#F7B676', drip: '#E8873E',
    topping: `<path d="M240 196q20-16 40 0t40 0 40 0 40 0" fill="none" stroke="#FFF3E2" stroke-width="12" stroke-linecap="round"/>` + [[270, 214], [370, 214]].map(([x, y]) => `<circle cx="${x}" cy="${y - 8}" r="10" fill="#FFF3E2"/>`).join('')}) + sp(500, 120) + sp(150, 150, .8)),
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport: {width: 640, height: 480}});
  for (const [id, svg] of Object.entries(items)) {
    await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await p.screenshot({path: path.join(out, id + '.jpg'), type: 'jpeg', quality: 86, clip: {x: 0, y: 0, width: 640, height: 480}});
  }
  await b.close();
})();
