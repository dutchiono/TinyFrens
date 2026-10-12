(() => {
  const $ = id => document.getElementById(id);
  const base = window.TINYFRENS_SERVER.replace(/\/$/, '');
  const key = 'tinyfrens-device:' + base;
  const networks = {1:'Ethereum',8453:'Base',4663:'Robinhood Chain'};
  const status = $('suggestStatus');
  let collections = [];
  const resetReview = () => { $('burnReview').hidden = true; };
  async function identity() {
    let device; try { device = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    if (!device?.token) {
      device = await window.TinyFrensTurtleAPI(base, '/api/register', {pet:{name:'My fren',shape:'turtle',color:'#a474f1'}});
      localStorage.setItem(key, JSON.stringify(device));
    }
    return device;
  }
  async function load() {
    try {
      const response = await fetch(base + '/api/collections/suggestions', {signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error('Could not load collections. Please retry.');
      const data = await response.json();
      if (!Array.isArray(data.collections)) throw new Error('Could not load collections. Please retry.');
      collections = data.collections;
      resetReview();
      const select = $('burnCollection'); select.replaceChildren();
      const placeholder = document.createElement('option'); placeholder.value = '';
      placeholder.textContent = collections.length ? 'Choose a collection' : 'Suggest a collection above first';
      select.append(placeholder);
      for (const collection of collections) {
        const option = document.createElement('option'); option.value = String(collection.id);
        option.textContent = `${collection.name || collection.address} · ${networks[collection.chainId] || 'Chain ' + collection.chainId}`;
        select.append(option);
      }
      select.disabled = !collections.length; $('reviewBurn').disabled = !collections.length;
      const list = $('collectionsList'); list.replaceChildren();
      if (!data.collections.length) {
        const empty = document.createElement('p'); empty.className = 'empty-collections';
        empty.textContent = 'No collections have been suggested yet. Add the first one above.'; list.append(empty);
      }
      for (const collection of data.collections) {
        const card = document.createElement('article'); card.className = 'collection-suggestion';
        const name = document.createElement('h3'); name.textContent = collection.name || 'Unnamed collection';
        const network = document.createElement('p'); network.textContent = networks[collection.chainId] || 'Chain ' + collection.chainId;
        const address = document.createElement('code'); address.textContent = collection.address;
        const state = document.createElement('p'); state.textContent = 'Suggested · voting not open';
        card.append(name, network, address, state); list.append(card);
      }
    } catch {
      $('collectionsList').textContent = 'Could not load collections. Refresh to retry.';
      $('burnCollection').replaceChildren(new Option('Could not load collections', ''));
      $('burnCollection').disabled = true; $('reviewBurn').disabled = true; resetReview();
    }
  }
  $('burnCollection').onchange = resetReview;
  $('burnAmount').oninput = () => { $('burnAmount').setCustomValidity(''); resetReview(); };
  $('burnVote').onsubmit = event => {
    event.preventDefault();
    const collection = collections.find(item => String(item.id) === $('burnCollection').value);
    const amount = $('burnAmount').value.trim();
    if (!collection) return;
    if (!/^[0-9]+(?:\.[0-9]{1,18})?$/.test(amount) || !/[1-9]/.test(amount)) {
      $('burnAmount').setCustomValidity('Enter an amount greater than zero, with up to 18 decimal places.');
      $('burnAmount').reportValidity(); return;
    }
    $('burnSummary').textContent = `Burn ${amount} FRENS to support ${collection.name || 'this collection'}.`;
    $('burnAddress').textContent = `${networks[collection.chainId] || 'Chain ' + collection.chainId} · ${collection.address}`;
    $('burnReview').hidden = false;
  };
  $('collectionChain').onchange = () => {
    const other = $('collectionChain').value === 'other';
    $('customChainField').hidden = !other; $('collectionChainId').required = other;
  };
  $('suggestCollection').onsubmit = async event => {
    event.preventDefault(); const button = $('submitCollection'); button.disabled = true;
    status.textContent = 'Submitting collection…';
    try {
      const device = await identity();
      const chainId = Number($('collectionChain').value === 'other' ? $('collectionChainId').value : $('collectionChain').value);
      const result = await window.TinyFrensTurtleAPI(base, '/api/collections/suggestions', {
        token:device.token, chainId, address:$('collectionAddress').value.trim(), name:$('collectionName').value.trim(),
      });
      status.textContent = result.existing ? 'This collection has already been suggested.' : 'Collection suggested. It is now in the shared list below.';
      $('collectionAddress').value = ''; $('collectionName').value = ''; await load();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  load();
})();
