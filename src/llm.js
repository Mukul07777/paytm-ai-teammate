import Anthropic from '@anthropic-ai/sdk';

export const hasLLM = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) && process.env.DOST_MODE !== 'playbook';
export const client = hasLLM ? new Anthropic() : null;
export const MODEL = process.env.DOST_MODEL || 'claude-opus-5-5';

let fallbackSupported = true;

// Messages call with server-side refusal fallback; drops the beta if the account rejects it.
export async function createMessage(params) {
  if (fallbackSupported) {
    try {
      return await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError) || !/fallback/i.test(e.message)) throw e;
      fallbackSupported = false;
    }
  }
  return client.messages.create(params);
}

export const textOf = msg => msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
