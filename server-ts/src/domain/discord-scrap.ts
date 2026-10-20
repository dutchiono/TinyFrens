import { SCRAP_GROUP_BONUS_CREDITS, SCRAP_MAX_CREW_SIZE, ScrapState } from './telegram-scrap.js';

export function renderDiscordScrap(state: ScrapState): {
  content: string;
  components: Array<Record<string, unknown>>;
} {
  const { run, members } = state;
  const crew = members.map(member => `• ${member.display_name}`).join('\n') || '• No one yet — press **Join crew**.';
  if (run.status === 'resolved') {
    const bonus = Math.max(0, members.length - 1) * SCRAP_GROUP_BONUS_CREDITS;
    return {
      content: [
        '## 🛰 SCRAP RUN COMPLETE',
        `The crew recovered **${run.loot_name || 'Unknown Scrap'}**`,
        `**${run.rarity || 'Unknown'}** find · **${run.reward_each || 0} credits each**`,
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
  const timestamp = Math.max(0, Math.floor(run.join_until));
  return {
    content: [
      '## 🛰 SCRAP RUN',
      `**${run.starter_name}** found a scrap signal.`,
      `⏱ Join until <t:${timestamp}:R> · Crew **${members.length}/${SCRAP_MAX_CREW_SIZE}**`,
      '',
      '**Crew**',
      crew,
      '',
      '_Join anytime during the five-minute window. After it closes, any crew member can search. Everyone gets the same find._',
    ].join('\n'),
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, label: `Join crew (${members.length}/${SCRAP_MAX_CREW_SIZE})`, custom_id: `game:${run.id}:join`, emoji: { name: '🤝' } },
        { type: 2, style: 2, label: 'Search scrap', custom_id: `game:${run.id}:resolve`, emoji: { name: '🔎' } },
      ],
    }],
  };
}
