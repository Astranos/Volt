import test from 'node:test';
import assert from 'node:assert/strict';
import { createJevClient } from './jev-client.ts';

const questions = { check: { type: 'choice', instructions: 'Check', criteria: { yes: 'Yes', no: 'No' } } };
const valid = () => ({ answers: { check: { type: 'choice', choice: 'yes', confidence: .95, probabilities: { yes: .95, no: .05 } } } });
const signal = () => new AbortController().signal;
test('posts verified wire format and parses decisions', async () => {
  let requests = 0;
  const client = createJevClient({ apiKey: 'secret', onRequest: () => requests++, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init.headers.Authorization, 'Bearer secret');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { model: 'jev-latest', state: { listing: 'test' }, questions });
    return Response.json(valid());
  } });
  assert.deepEqual(await client.choose({ listing: 'test' }, questions, signal()), { check: { choice: 'yes', confidence: .95 } });
  assert.equal(requests, 1);
});
test('rejects missing/extra answers, foreign choices and malformed probabilities', async () => {
  for (const mutate of [
    v => delete v.answers.check,
    v => v.answers.extra = v.answers.check,
    v => v.answers.check.choice = 'other',
    v => v.answers.check.confidence = 2,
    v => v.answers.check.probabilities.no = -1,
    v => delete v.answers.check.probabilities.no,
    v => v.answers.check.probabilities.extra = .2,
    v => v.answers.check.probabilities.no = .95,
    v => { v.answers.check.probabilities.yes = .05; v.answers.check.probabilities.no = .95; },
    v => v.answers.check.type = 'text',
  ]) {
    const value = valid(); mutate(value);
    const client = createJevClient({ apiKey: 'secret', fetchImpl: async () => Response.json(value) });
    await assert.rejects(client.choose({}, questions, signal()), /valid decision/);
  }
});
test('bounds context, question counts and option counts before sending', async () => {
  const client = createJevClient({ apiKey: 'secret', fetchImpl: async () => assert.fail('must not request') });
  await assert.rejects(client.choose({ text: 'x'.repeat(90_000) }, questions, signal()), /context limit/);
  await assert.rejects(client.choose({}, {}, signal()), /valid decision/);
  await assert.rejects(client.choose({}, Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), questions.check])), signal()), /valid decision/);
  await assert.rejects(client.choose({}, { check: { ...questions.check, criteria: Object.fromEntries(Array.from({ length: 256 }, (_, i) => [String(i), 'choice'])) } }, signal()), /valid decision/);
});
test('sanitizes network errors without leaking key or body', async () => {
  const client = createJevClient({ apiKey: 'secret', fetchImpl: async () => { throw new Error('secret private body'); } });
  await assert.rejects(client.choose({}, questions, signal()), error => !error.message.includes('secret') && !error.message.includes('private'));
});
test('does not make a request when already cancelled', async () => {
  const controller = new AbortController(); controller.abort();
  const client = createJevClient({ apiKey: 'secret', fetchImpl: async () => assert.fail('must not request') });
  await assert.rejects(client.choose({}, questions, controller.signal), { name: 'AbortError' });
});
test('retries only bounded transient failures', async () => {
  let calls = 0;
  const client = createJevClient({ apiKey: 'secret', fetchImpl: async () => { calls++; return new Response('', { status: calls === 1 ? 429 : 529 }); } });
  await assert.rejects(client.choose({}, questions, signal()), /rate limited/);
  assert.equal(calls, 3);
});
test('reports authentication errors without response contents', async () => {
  const client = createJevClient({ apiKey: 'secret', fetchImpl: async () => new Response('secret', { status: 401 }) });
  await assert.rejects(client.choose({}, questions, signal()), error => /rejected the API key/.test(error.message) && !error.message.includes('secret'));
});
test('cancels in-flight requests', async () => {
  const controller = new AbortController();
  const client = createJevClient({ apiKey: 'secret', fetchImpl: async (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('secret')));
    controller.abort();
  }) });
  await assert.rejects(client.choose({}, questions, controller.signal), { name: 'AbortError' });
});
