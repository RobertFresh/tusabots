// orchestrator/buildContext.js
// Assembles the full AI context package for the Anthropic API.
// Inputs: system prompt, curated memory, conversation history, current message.

const { SYSTEM_PROMPT } = require('../prompts/systemPrompt');
const { retrieveMemory } = require('../memory/retrieveMemory');

/**
 * Build the complete context object for an Anthropic messages API call.
 *
 * @param {object} params
 * @param {string} params.userId - Authenticated user ID
 * @param {string} params.currentMessage - The user's new message
 * @param {Array<{role: string, content: string}>} [params.conversationHistory=[]] - Frontend history
 * @param {number} [params.memoryLimit=20] - How many stored messages to fetch
 * @returns {Promise<{system: string, messages: Array}>} - Context ready for Anthropic
 */
async function buildContext({ userId, currentMessage, conversationHistory = [], memoryLimit = 20 }) {
  // Fetch curated memory from Supabase
  const storedMemory = await retrieveMemory(userId, memoryLimit);

  // Merge stored memory + frontend history, then append current message
  // Frontend history is de-duplicated against stored memory to avoid repetition.
  const storedIds = new Set(storedMemory.map(m => `${m.role}:${m.content.slice(0, 40)}`));
  const dedupedHistory = conversationHistory.filter(
    m => !storedIds.has(`${m.role}:${m.content.slice(0, 40)}`)
  );

  const messages = [...storedMemory, ...dedupedHistory, { role: 'user', content: currentMessage }];

  console.log('[buildContext]', {
    userId,
    storedMessages: storedMemory.length,
    frontendHistory: dedupedHistory.length,
    totalMessages: messages.length,
  });

  return {
    system: SYSTEM_PROMPT,
    messages,
  };
}

module.exports = { buildContext };