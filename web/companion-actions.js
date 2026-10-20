'use strict';
(() => {
  let timer;
  function animate(name) {
    const targets = [document.getElementById('pet'), ...document.querySelectorAll('.collection-companion')].filter(Boolean);
    for (const target of targets) target.dataset.action = name || '';
    clearTimeout(timer);
    if (name) timer = setTimeout(() => { for (const target of targets) target.dataset.action = ''; }, name === 'sleep' ? 15000 : 6000);
  }
  window.animatePet = animate;

  const actions = {wavePet:'wave', dancePet:'dance', toyPet:'toy'};
  for (const [id, action] of Object.entries(actions)) document.getElementById(id)?.addEventListener('click', () => {
    if (desktop) desktop.action(action);
    else if (native) action === 'toy' ? PetAndroid.toy() : PetAndroid.action(action);
    animate(action === 'toy' ? 'dance' : action);
    window.tinyFrensEffects?.respond(action);
  });
})();
