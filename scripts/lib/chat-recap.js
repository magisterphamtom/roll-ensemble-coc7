import { MODULE_ID } from "../settings.js";

export async function postChatRecap(payload) {
  const sorted = [...payload.participants]
    .sort((a, b) => b.rank - a.rank || a.roll - b.roll)
    .map(p => ({
      ...p,
      isWinner: payload.winners.winnerKeys.includes(p.key),
      hasThreshold: p.meetsThreshold !== null && p.meetsThreshold !== undefined
    }));
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/chat-recap.hbs`, {
    label: payload.label,
    teams: payload.teams,
    difficulty: payload.difficulty,
    participants: sorted,
    winners: payload.winners
  });
  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker()
  });
}
