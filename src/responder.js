// Simulates the person on the other end of a call. Uses Claude for role-play when available.
import { hasLLM, MODEL, createMessage, textOf } from './llm.js';
import { pick } from './seed.js';

const STAGED = {
  device: [
    ['Haan, kaafi ghanton se band hai. Customers se cash maangna pad raha hai.', -0.35],
    ['Theek hai, bahut accha. Dhanyavaad!', 0.7]
  ],
  settlement: [
    ['Haan, paise abhi tak nahi aaye. Supplier ko payment karna hai.', -0.45],
    ['Shukriya, mil gaya.', 0.7]
  ],
  loan: [
    ['Interest kitna hai? Documents ka jhanjhat toh nahi hoga?', 0.3],
    ['Theek hai, terms bhej do. Festive stock lena hai.', 0.75]
  ],
  kyc: [['Haan, link bhej do, aaj hi kar dunga.', 0.5]]
};

export async function calleeReply({ callee, situation, message, topic, stage, sentiment }) {
  if (hasLLM) {
    try {
      const r = await createMessage({
        model: MODEL, max_tokens: 400, output_config: { effort: 'low' },
        system: `You role-play ${callee} on a phone call with Dost, Paytm's AI assistant. Situation: ${situation}
Reply as ${callee} in 1-2 short, natural sentences (romanised Hinglish for Indian-language speakers, English otherwise).
On a final separate line write: SENTIMENT: <number from -1 to 1>. If you want a human agent, also write: WANTS_HUMAN`,
        messages: [{ role: 'user', content: `Dost says: "${message}"` }]
      });
      if (r.stop_reason !== 'refusal') {
        const txt = textOf(r);
        const s = /SENTIMENT:\s*(-?[\d.]+)/.exec(txt);
        return {
          text: txt.replace(/SENTIMENT:.*|WANTS_HUMAN/g, '').trim(),
          sentiment: s ? Math.max(-1, Math.min(1, +s[1])) : 0,
          wants_human: /WANTS_HUMAN/.test(txt)
        };
      }
    } catch { /* fall through to simulated persona */ }
  }
  if (topic === 'complaint') {
    return sentiment < -0.6
      ? { text: "I don't want a bot. Connect me to a real person right now.", sentiment: -0.8, wants_human: true }
      : { text: 'Okay. How long will the refund take?', sentiment: 0.1, wants_human: false };
  }
  const lines = STAGED[topic] || [[pick(['Haan ji, boliye.', 'Okay, samajh gaya.']), 0.2]];
  const [text, s] = lines[Math.min(stage, lines.length - 1)];
  return { text, sentiment: s, wants_human: false };
}
