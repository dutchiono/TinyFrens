const expected = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(expected || '')) {
  throw new Error('Usage: node scripts/verify-server-deploy.mjs <full-git-sha>');
}

for (let attempt = 1; attempt <= 10; attempt += 1) {
  try {
    const response = await fetch('https://tinyfrens.miono.live/health/revision', {
      signal: AbortSignal.timeout(10_000),
    });
    const body = response.ok ? await response.json() : {};
    if (body.ok === true && body.revision === expected) process.exit(0);
  } catch {
    // Retry while the service and proxy settle.
  }
  if (attempt < 10) await new Promise(resolve => setTimeout(resolve, 3_000));
}

throw new Error(`Production did not report revision ${expected}`);
