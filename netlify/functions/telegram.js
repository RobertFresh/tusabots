exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'ok' };
  }

  const { message } = JSON.parse(event.body);
  if (!message || !message.text) return { statusCode: 200, body: 'ok' };

  const chatId = message.chat.id;
  const userText = message.text;

  // Call Claude
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: "You are TusaBot, James's personal AI assistant on Telegram. Be helpful, concise, and friendly. Help with life admin, planning, and general questions.",
      messages: [{ role: 'user', content: userText }]
    })
  });

  let reply = "Sorry, I'm having trouble thinking right now. Try again shortly.";
  if (aiRes.ok) {
    const data = await aiRes.json();
    reply = data.content[0].text;
  }

  // Send reply via Telegram
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: reply })
  });

  return { statusCode: 200, body: 'ok' };
};
