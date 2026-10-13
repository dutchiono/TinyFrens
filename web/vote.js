(() => {
  const $ = id => document.getElementById(id);
  const base = (window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  const key = 'tinyfrens-device:' + base;
  const networks = {1:'Ethereum',8453:'Base',4663:'Robinhood Chain'};
  const status = $('suggestStatus');
  const balanceDisplay = $('voteBalanceDisplay');
  const accountStatus = $('voteBalanceAccount');
  const depositPanel = $('depositInfoPanel');
  const toggleDepositBtn = $('toggleDeposit');
  const depositAddressCode = $('voteDepositAddress');
  const copyDepositBtn = $('copyDepositAddress');
  const depositCopyStatus = $('depositCopyStatus');
  const depositTokenLink = $('voteDepositToken');
  const reviewBox = $('burnReview');
  const summaryText = $('burnSummary');
  const addressText = $('burnAddress');
  const balanceAfterText = $('burnBalanceAfter');
  const confirmBtn = $('confirmVote');
  const voteStatus = $('voteSubmitStatus');

  let collections = [];
  let userCredits = 0;
  let creditsPerFrens = 100;
  let activeCollection = null;
  let activeAmount = '';
  let activeCreditsToBurn = 0;

  async function identity() {
    let device;
    try { device = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
    if (!device?.token) {
      device = await window.TinyFrensTurtleAPI(base, '/api/register', {pet:{name:'My fren',shape:'turtle',color:'#a474f1'}});
      localStorage.setItem(key, JSON.stringify(device));
    }
    return device;
  }

  function resetReview() {
    if (reviewBox) reviewBox.hidden = true;
    if (voteStatus) voteStatus.textContent = '';
    activeCollection = null;
    activeAmount = '';
    activeCreditsToBurn = 0;
  }

  async function refreshBalance() {
    try {
      const device = await identity();
      if (!device?.token) return;
      const res = await window.TinyFrensTurtleAPI(base, '/api/vote/status', {token: device.token});
      userCredits = Number.isFinite(res.balance) ? res.balance : 0;
      creditsPerFrens = (Number.isFinite(res.creditsPerFrens) && res.creditsPerFrens > 0) ? res.creditsPerFrens : 100;

      const frensAvailable = userCredits / creditsPerFrens;
      balanceDisplay.textContent = `${frensAvailable.toLocaleString('en-US', {maximumFractionDigits: 2})} FRENS available`;
      accountStatus.textContent = 'Deposited balance ready for votes & care';

      if (res.deposit?.enabled && res.deposit?.address) {
        depositAddressCode.textContent = res.deposit.address;
        depositAddressCode.style.cursor = 'pointer';
        if (res.deposit.token) {
          depositTokenLink.href = 'https://basescan.org/token/' + res.deposit.token;
        }
      } else {
        depositAddressCode.textContent = 'FRENS deposits are not open yet. Check back soon!';
        depositAddressCode.style.cursor = 'default';
        if (copyDepositBtn) copyDepositBtn.disabled = true;
      }
    } catch {
      balanceDisplay.textContent = '— FRENS available';
      accountStatus.textContent = 'Could not load your deposited balance. Reconnect to retry.';
    }
  }

  async function copyDepositAddress() {
    const text = depositAddressCode.textContent.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(text)) return;
    try {
      await navigator.clipboard.writeText(text);
      depositCopyStatus.textContent = 'Deposit address copied!';
      setTimeout(() => { if (depositCopyStatus.textContent === 'Deposit address copied!') depositCopyStatus.textContent = ''; }, 3000);
    } catch {
      depositCopyStatus.textContent = 'Select and copy the address above.';
    }
  }

  if (depositAddressCode) depositAddressCode.onclick = copyDepositAddress;
  if (copyDepositBtn) copyDepositBtn.onclick = copyDepositAddress;
  if (toggleDepositBtn) {
    toggleDepositBtn.onclick = () => {
      depositPanel.hidden = !depositPanel.hidden;
      toggleDepositBtn.textContent = depositPanel.hidden ? 'Deposit FRENS to vote' : 'Hide deposit instructions';
    };
  }

  async function load() {
    try {
      const response = await fetch(base + '/api/collections/suggestions', {signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error('Could not load collections. Please retry.');
      const data = await response.json();
      if (!Array.isArray(data.collections)) throw new Error('Could not load collections. Please retry.');
      collections = data.collections;
      resetReview();

      const select = $('burnCollection');
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = collections.length ? 'Choose a collection' : 'Suggest a collection above first';
      select.append(placeholder);

      for (const collection of collections) {
        const option = document.createElement('option');
        option.value = String(collection.id);
        const votesLabel = collection.votes ? ` · ${collection.frens || 0} FRENS (${collection.votes} vote${collection.votes === 1 ? '' : 's'})` : '';
        option.textContent = `${collection.name || collection.address} · ${networks[collection.chainId] || 'Chain ' + collection.chainId}${votesLabel}`;
        select.append(option);
      }
      select.disabled = !collections.length;
      $('reviewBurn').disabled = !collections.length;

      const list = $('collectionsList');
      list.replaceChildren();
      if (!data.collections.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-collections';
        empty.textContent = 'No collections have been suggested yet. Add the first one above.';
        list.append(empty);
      }

      for (const [index, collection] of data.collections.entries()) {
        const card = document.createElement('article');
        card.className = 'collection-suggestion';

        const info = document.createElement('div');
        info.className = 'collection-info';
        const name = document.createElement('h3');
        name.textContent = `#${index + 1} ${collection.name || 'Unnamed collection'}`;
        const network = document.createElement('p');
        network.textContent = networks[collection.chainId] || 'Chain ' + collection.chainId;
        const address = document.createElement('code');
        address.textContent = collection.address;
        info.append(name, network, address);

        const badge = document.createElement('div');
        badge.className = 'collection-votes-badge';
        const voteCount = document.createElement('div');
        voteCount.className = 'collection-votes-count';
        voteCount.textContent = `🔥 ${collection.frens ? collection.frens.toLocaleString('en-US') : 0}`;
        const voteLabel = document.createElement('div');
        voteLabel.className = 'collection-votes-label';
        voteLabel.textContent = `${collection.votes || 0} vote${collection.votes === 1 ? '' : 's'}`;
        const quickVote = document.createElement('button');
        quickVote.type = 'button';
        quickVote.className = 'quick-vote-btn';
        quickVote.textContent = 'Vote for this';
        quickVote.onclick = () => {
          select.value = String(collection.id);
          resetReview();
          $('burnAmount').focus();
          select.scrollIntoView({behavior:'smooth', block:'center'});
        };
        badge.append(voteCount, voteLabel, quickVote);

        card.append(info, badge);
        list.append(card);
      }
    } catch {
      $('collectionsList').textContent = 'Could not load collections. Refresh to retry.';
      $('burnCollection').replaceChildren(new Option('Could not load collections', ''));
      $('burnCollection').disabled = true;
      $('reviewBurn').disabled = true;
      resetReview();
    }
  }

  $('burnCollection').onchange = resetReview;
  $('burnAmount').oninput = () => {
    $('burnAmount').setCustomValidity('');
    resetReview();
  };

  $('burnVote').onsubmit = event => {
    event.preventDefault();
    const collection = collections.find(item => String(item.id) === $('burnCollection').value);
    const amount = $('burnAmount').value.trim();
    if (!collection) return;
    if (!/^[0-9]+(?:\.[0-9]{1,18})?$/.test(amount) || !/[1-9]/.test(amount)) {
      $('burnAmount').setCustomValidity('Enter an amount greater than zero, with up to 18 decimal places.');
      $('burnAmount').reportValidity();
      return;
    }

    const numAmount = parseFloat(amount);
    const requiredCredits = Math.floor(numAmount * creditsPerFrens);
    if (requiredCredits > userCredits) {
      const maxFrens = (userCredits / creditsPerFrens).toLocaleString('en-US', {maximumFractionDigits: 2});
      $('burnAmount').setCustomValidity(`Insufficient deposited balance (${maxFrens} FRENS available). Deposit more FRENS on Base to vote with this amount.`);
      $('burnAmount').reportValidity();
      return;
    }

    activeCollection = collection;
    activeAmount = amount;
    activeCreditsToBurn = requiredCredits;

    summaryText.textContent = `Burn ${amount} FRENS to support ${collection.name || 'this collection'}.`;
    addressText.textContent = `${networks[collection.chainId] || 'Chain ' + collection.chainId} · ${collection.address}`;
    const remainingFrens = (userCredits - requiredCredits) / creditsPerFrens;
    balanceAfterText.textContent = `Balance after vote: ${remainingFrens.toLocaleString('en-US', {maximumFractionDigits: 2})} FRENS`;
    confirmBtn.disabled = false;
    voteStatus.textContent = '';
    reviewBox.hidden = false;
  };

  confirmBtn.onclick = async () => {
    if (!activeCollection || !activeAmount) return;
    confirmBtn.disabled = true;
    voteStatus.textContent = 'Submitting vote…';
    try {
      const device = await identity();
      const res = await window.TinyFrensTurtleAPI(base, '/api/collections/vote', {
        token: device.token,
        collectionId: Number(activeCollection.id),
        amount: activeAmount,
      });
      voteStatus.textContent = `Vote confirmed! Burned ${res.frensBurned} FRENS for ${res.collectionName || 'collection'}.`;
      userCredits = res.balance;
      const formatted = (res.balance / creditsPerFrens).toLocaleString('en-US', {maximumFractionDigits: 2});
      balanceDisplay.textContent = `${formatted} FRENS available`;
      window.dispatchEvent(new CustomEvent('tinyfrens-balance-updated', {detail:{balance:res.balance}}));
      $('burnAmount').value = '';
      await load();
      setTimeout(resetReview, 3500);
    } catch (error) {
      voteStatus.textContent = error.message || 'Could not record vote. Please retry.';
      confirmBtn.disabled = false;
    }
  };

  $('collectionChain').onchange = () => {
    const other = $('collectionChain').value === 'other';
    $('customChainField').hidden = !other;
    $('collectionChainId').required = other;
  };

  $('suggestCollection').onsubmit = async event => {
    event.preventDefault();
    const button = $('submitCollection');
    button.disabled = true;
    status.textContent = 'Submitting collection…';
    try {
      const device = await identity();
      const chainId = Number($('collectionChain').value === 'other' ? $('collectionChainId').value : $('collectionChain').value);
      const result = await window.TinyFrensTurtleAPI(base, '/api/collections/suggestions', {
        token: device.token,
        chainId,
        address: $('collectionAddress').value.trim(),
        name: $('collectionName').value.trim(),
      });
      status.textContent = result.existing ? 'This collection has already been suggested.' : 'Collection suggested. It is now in the shared list below.';
      $('collectionAddress').value = '';
      $('collectionName').value = '';
      await load();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };

  window.addEventListener('tinyfrens-balance-updated', refreshBalance);
  window.addEventListener('tinyfrens-account-synced', refreshBalance);

  refreshBalance();
  load();
})();
