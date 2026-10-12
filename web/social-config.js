// Set this once after deploying server/; it is a public URL, not a secret.
const isLocal = typeof window !== 'undefined' && /^(localhost|127\.|\[::1\])/.test(window.location.hostname);
window.TINYFRENS_SERVER = isLocal ? window.location.origin : 'https://tinyfrens.miono.live';
