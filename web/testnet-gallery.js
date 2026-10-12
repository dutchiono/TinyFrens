(() => {
  const $ = id => document.getElementById(id);
  const explorer = 'https://base-sepolia.blockscout.com';
  const dialog = $('inspect');
  $('close').onclick = () => dialog.close();
  function inspect(token, snapshot) {
    const metadata = token.metadata;
    $('title').textContent = metadata.name;
    $('art').src = metadata.image; $('art').alt = metadata.name;
    $('description').textContent = metadata.description || '';
    $('traits').replaceChildren();
    for (const attribute of metadata.attributes || []) {
      const trait = document.createElement('div'); trait.className = 'trait';
      const label = document.createElement('small'); label.textContent = attribute.trait_type;
      const value = document.createElement('span'); value.textContent = String(attribute.value);
      trait.append(label, value); $('traits').append(trait);
    }
    $('owner').textContent = 'Owner at snapshot: ' + token.owner;
    $('verified').textContent = 'Net Storage matches tokenURI · Block ' + snapshot.block.toLocaleString();
    $('links').replaceChildren();
    const links = [
      ['View token', `/token/${snapshot.collection}/instance/${token.id}`],
      ['Owner wallet', `/address/${token.owner}`],
      ['Net Storage', `/address/${snapshot.storage}`],
    ];
    if (token.mintTransaction) links.push(['Mint transaction', `/tx/${token.mintTransaction}`]);
    for (const [label, path] of links) {
      const link = document.createElement('a'); link.textContent = label; link.href = explorer + path;
      link.target = '_blank'; link.rel = 'noopener'; $('links').append(link);
    }
    $('metadata').textContent = JSON.stringify(metadata, null, 2);
    dialog.querySelector('details').open = false;
    dialog.showModal();
  }
  async function load() {
    try {
      const response = await fetch('testnet-gallery.json', {cache:'no-store'});
      if (!response.ok) throw new Error('Snapshot request failed');
      const snapshot = await response.json();
      if (snapshot.chainId !== 84532 || snapshot.collection.toLowerCase() !== '0x091fb40292925e822849ba415599939eec078b62' || !Array.isArray(snapshot.tokens)) throw new Error('Invalid robot testnet snapshot');
      $('snapshot').textContent = `${snapshot.tokens.length} minted NFTs · Snapshot ${new Date(snapshot.capturedAt).toLocaleString()} · Block ${snapshot.block.toLocaleString()}`;
      for (const token of snapshot.tokens) {
        if (!token.metadata.attributes?.some(item => item.trait_type === 'Species' && item.value === 'Robot')) throw new Error('Non-robot metadata in robot collection');
        if (!token.metadata.image.startsWith('data:image/svg+xml;base64,')) throw new Error('Invalid on-chain artwork');
        const card = document.createElement('button'); card.type = 'button'; card.className = 'card';
        const image = document.createElement('img'); image.src = token.metadata.image;
        image.alt = token.metadata.name; image.loading = 'lazy';
        const title = document.createElement('strong'); title.textContent = token.metadata.name;
        const note = document.createElement('small'); note.textContent = 'Inspect artwork & traits';
        card.append(image, title, note); card.onclick = () => inspect(token, snapshot); $('grid').append(card);
      }
    } catch { $('grid').replaceChildren(); $('snapshot').textContent = 'Could not load the testnet inspection data. Refresh to retry.'; }
  }
  load();
})();
