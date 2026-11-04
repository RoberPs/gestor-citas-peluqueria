import 'dotenv/config';
import { startFakeEmailProvider, type FakeEmailMode } from '../tests/support/fake-email-provider';

/**
 * The fake email provider for the manual check of 004 (quickstart.md).
 *
 *   npm run email:fake               accepts every email
 *   npm run email:fake -- --fail     answers 503: a transient failure
 *   npm run email:fake -- --reject   answers 422: a permanent rejection
 *
 * It prints the subject and the link lines of each email it accepts, never the
 * recipient: this terminal is a log like any other (FR-022). The emails can be
 * read, rendered, at http://127.0.0.1:4010/, and as JSON at /__messages.
 */

const PORT = 4010;

const argv = process.argv.slice(2);
const mode: FakeEmailMode = argv.includes('--reject') ? 'reject' : argv.includes('--fail') ? 'fail' : 'ok';

const provider = await startFakeEmailProvider({
  port: PORT,
  mode,
  apiKey: process.env['EMAIL_API_KEY'] || undefined,
});

provider.onAccepted((message) => {
  const links = (message.body.text ?? '').split('\n').filter((line) => line.includes('http'));
  console.log(`\n${message.body.subject ?? '(sin asunto)'}`);
  for (const line of links) console.log(`  ${line.trim()}`);
});

console.log(`fake email provider listening on ${provider.url} (mode: ${mode})`);
console.log(`inbox: ${provider.url}/  (JSON: ${provider.url}/__messages)`);
