'use strict';
const image = document.getElementById('companion');
let data = JSON.parse(TinyFrensDesktop.getTurtle()), walking = false;
TinyFrensDesktop.onTurtle(value => { data = value; });
TinyFrensDesktop.onCompanionMotion(value => {
  walking = value.walking;
  image.style.transform = `scaleX(${value.direction})`;
});
setInterval(() => {
  image.hidden = !data.active || Date.now() >= data.validUntil * 1000 || !data.companion;
  if (image.hidden) return;
  const art = data.companion;
  const src = walking && art.frames?.length ? art.frames[Math.floor(Date.now() / art.frameMs) % art.frames.length] : art.idle;
  if (image.getAttribute('src') !== src) image.src = src;
  image.alt = data.name;
}, 40);

image.addEventListener('dblclick', () => TinyFrensDesktop.openApp('care'));
