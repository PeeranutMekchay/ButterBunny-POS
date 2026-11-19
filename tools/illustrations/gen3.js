// Souvenir illustrations for the rewards shelf.
const {chromium} = require('playwright');
const path = require('path');
const fs = require('fs');
const wrap = (c0, c1, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480">
<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></radialGradient>
<pattern id="dots" width="44" height="44" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="3" fill="#fff" opacity=".45"/><circle cx="30" cy="30" r="2" fill="#fff" opacity=".35"/></pattern></defs>
<rect width="640" height="480" fill="url(#g)"/><rect width="640" height="480" fill="url(#dots)"/><ellipse cx="320" cy="400" rx="180" ry="22" fill="#000" opacity=".08"/>${body}</svg>`;
// the shop logo (public/assets/logo.svg) placed with its middle at x, y
const LOGO = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'assets', 'logo.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>|<\/svg>[\s\S]*$/g, '');
const bunny = (x, y, s) => `<g transform="translate(${x - 40 * s} ${y - 50 * s}) scale(${s * 1.25})">${LOGO}</g>`;
const sp = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-14C2-4 4-2 14 0 4 2 2 4 0 14-2 4-4 2-14 0-4-2-2-4 0-14Z" fill="#fff" opacity=".9"/>`;
const items = {
  'g-tote': wrap('#FFF1F5', '#F7CCDA', `
    <path d="M262 170q0-90 58-90t58 90" fill="none" stroke="#D9C3A2" stroke-width="16" stroke-linecap="round"/>
    <path d="M200 160h240l18 230q2 16-14 16H196q-16 0-14-16Z" fill="#F7EEDF"/>
    <path d="M200 160h240l2 26H198Z" fill="#E9DCC6"/>
    ${bunny(320, 290, 1.5)}
    <text x="320" y="378" text-anchor="middle" font-family="Itim, sans-serif" font-size="26" fill="#A8355C">Butter Bunny</text>
    ${sp(470, 140)}${sp(170, 180, .8)}`),
  'g-sticker': wrap('#FDE4EC', '#F8C6D6', `
    <rect x="190" y="110" width="260" height="290" rx="22" fill="#fff" transform="rotate(-5 320 255)"/>
    <g transform="rotate(-5 320 255)">
      ${bunny(260, 200, .95)}
      <g transform="translate(380 190)"><circle r="40" fill="#FFD66B" stroke="#fff" stroke-width="6"/><path d="M-20-6q20-30 40 0-20 30-40 0Z" fill="#D9913A"/></g>
      <g transform="translate(262 320)"><path d="M0 26C-30 8-36-14-18-26-6-34 0-22 0-18 0-22 6-34 18-26 36-14 30 8 0 26Z" fill="#F48CA2" stroke="#fff" stroke-width="6"/></g>
      <g transform="translate(382 312)"><rect x="-38" y="-26" width="76" height="52" rx="14" fill="#A9D98A" stroke="#fff" stroke-width="6"/><text y="8" text-anchor="middle" font-family="Itim, sans-serif" font-size="22" fill="#fff">yum!</text></g>
    </g>${sp(480, 130)}${sp(160, 170, .8)}`),
  'g-tumbler': wrap('#FDEAF1', '#F2BDD0', `
    <rect x="300" y="60" width="16" height="70" rx="8" fill="#F28CA0" transform="rotate(10 308 95)"/>
    <rect x="236" y="110" width="168" height="34" rx="14" fill="#F7EEDF"/>
    <path d="M240 140h160l-14 240q-2 22-24 22h-84q-22 0-24-22Z" fill="#FFF8EE"/>
    <path d="M246 220h148l-4 70H250Z" fill="#F7D774" opacity=".55"/>
    ${bunny(320, 262, 1.05)}
    <path d="M266 160l8 210" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".8"/>
    ${sp(470, 140)}${sp(170, 190, .8)}`),
};
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport: {width: 640, height: 480}});
  await p.setContent(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Itim&display=swap">`);
  for (const [id, svg] of Object.entries(items)) {
    await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await p.screenshot({path: path.join(__dirname, '..', '..', 'public', 'assets', 'illustrations', id + '.jpg'), type: 'jpeg', quality: 86, clip: {x:0, y:0, width:640, height:480}});
  }
  await b.close();
})();
