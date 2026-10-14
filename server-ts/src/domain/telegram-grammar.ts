function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type FilterCommand =
  | { type: 'list' }
  | { type: 'remove'; trigger: string }
  | { type: 'set'; trigger: string; response: string };

export function parseFilterCommand(text: unknown): FilterCommand | null {
  if (typeof text !== 'string') return null;
  const cleaned = text.trim();

  // /filter, /filters, /filter list, /filters@BotName
  if (/^\/(?:filter|filters)(?:@\w+)?(?:\s+list)?\s*$/i.test(cleaned)) {
    return { type: 'list' };
  }

  // /filter remove trigger, /filter delete trigger
  const matchRm = cleaned.match(/^\/filter(?:@\w+)?\s+(?:remove|delete)\s+(\S+)\s*$/i);
  if (matchRm) {
    return {
      type: 'remove',
      trigger: matchRm[1].toLowerCase().replace(/^\//, ''),
    };
  }

  // /filter trigger response
  const matchSet = cleaned.match(/^\/filter(?:@\w+)?\s+(\S+)\s+([\s\S]+)$/i);
  if (matchSet) {
    const first = matchSet[1];
    const rest = matchSet[2].trim();
    if (first.toLowerCase() === 'remove' || first.toLowerCase() === 'delete') {
      const trigger = rest.split(/\s+/)[0].toLowerCase().replace(/^\//, '');
      return { type: 'remove', trigger };
    }
    return {
      type: 'set',
      trigger: first.toLowerCase().replace(/^\//, ''),
      response: rest,
    };
  }

  return null;
}

export type BlocklistCommand =
  | { type: 'list' }
  | { type: 'add'; pattern: string }
  | { type: 'remove'; pattern: string };

export function parseBlocklistCommand(text: unknown): BlocklistCommand | null {
  if (typeof text !== 'string') return null;
  const cleaned = text.trim();

  // /blocklist, /blocklist list
  if (/^\/blocklist(?:@\w+)?(?:\s+list)?\s*$/i.test(cleaned)) {
    return { type: 'list' };
  }

  // /blocklist add pattern
  const matchAdd = cleaned.match(/^\/blocklist(?:@\w+)?\s+add\s+([\s\S]+)$/i);
  if (matchAdd) {
    return {
      type: 'add',
      pattern: matchAdd[1].trim().toLowerCase(),
    };
  }

  // /blocklist remove pattern, /blocklist delete pattern
  const matchRm = cleaned.match(/^\/blocklist(?:@\w+)?\s+(?:remove|delete)\s+([\s\S]+)$/i);
  if (matchRm) {
    return {
      type: 'remove',
      pattern: matchRm[1].trim().toLowerCase(),
    };
  }

  return null;
}

export function parseBanCommand(text: unknown): { isBan: boolean; reason: string | null } {
  if (typeof text !== 'string') {
    return { isBan: false, reason: null };
  }
  const cleaned = text.trim();
  const match = cleaned.match(/^\/(?:ai)?ban(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (match) {
    const reason = (match[1] || '').trim();
    return { isBan: true, reason: reason || null };
  }
  return { isBan: false, reason: null };
}

export function matchesTrigger(text: string, trigger: string): boolean {
  if (!text || !trigger) return false;
  const escaped = escapeRegex(trigger);
  // Matches command form (/trigger) or whole-word boundary
  // Python: rf'(?:^/{re.escape(trigger)}(?:@\w+)?(?:\s|$)|(?<!\w){re.escape(trigger)}(?!\w))'
  const pattern = new RegExp(
    `(?:^/${escaped}(?:@\\w+)?(?:\\s|$)|(?<!\\w)${escaped}(?!\\w))`,
    'i'
  );
  return pattern.test(text);
}

export function matchesBlocklistPattern(text: string, pattern: string): boolean {
  if (!text || !pattern) return false;
  // If alphanumeric word: whole-word boundary check (?<!\w)pattern(?!\w)
  if (/^\w+$/.test(pattern)) {
    const escaped = escapeRegex(pattern);
    const regex = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, 'i');
    return regex.test(text);
  }
  // Otherwise case-insensitive substring
  return text.toLowerCase().includes(pattern.toLowerCase());
}
