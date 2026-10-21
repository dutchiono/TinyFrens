import { ScrapState } from './telegram-scrap.js';

const MAX_CREW_SIZE = 4;

export function renderDiscordScrap(state: ScrapState): {
  content: string;
  components: Array<Record<string, unknown>>;
} {
  const { run, members } = state;
  const crew = members.map(member => `• ${member.display_name}`).join('\n') || '• No one yet — press **Join crew**.';
  if (run.status === 'resolved') {
    const bonus = Math.max(0, members.length - 1) * 10;
    return {
      content: [
        '## 🛰 SCRAP RUN COMPLETE',
        `The crew recovered **${run.loot_name || 'Unknown Scrap'}**`,
        `**${run.rarity || 'Unknown'}** find · **${run.reward_each || 0} credits each**`,
        `${run.search_mode === 'deep' ? '🌌 Deep scan' : '🛡 Safe scan'}${run.booster_used ? ' · Signal Booster used' : ''}`,
        '',
        '**Crew**',
        crew,
        bonus ? `\n🤝 Group bonus: +${bonus} each` : '',
      ].join('\n'),
      components: [{
        type: 1,
        components: [{ type: 2, style: 1, label: 'New scrap run', custom_id: 'game:new', emoji: { name: '🔁' } }],
      }],
    };
  }
  return {
    content: [
      '## 🛰 SCRAP RUN',
      `**${run.starter_name}** found a scrap signal.`,
      `⚡ **Live now** · Crew **${members.length}/${MAX_CREW_SIZE}**`,
      '',
      '**Crew**',
      crew,
      '',
      '_Join the crew, then choose a safe guaranteed scan or risk a deep scan for better salvage. Each fren gets 3 joins per UTC day._',
    ].join('\n'),
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 1, label: `Join crew (${members.length}/${MAX_CREW_SIZE})`, custom_id: `game:${run.id}:join`, emoji: { name: '🤝' } }],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: 'Safe scan', custom_id: `game:${run.id}:safe`, emoji: { name: '🛡' } },
          { type: 2, style: 4, label: 'Deep scan', custom_id: `game:${run.id}:deep`, emoji: { name: '🌌' } },
        ],
      },
    ],
  };
}
