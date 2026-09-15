import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/**
 * Checks a response against `contracts/http-api.yaml` itself, not against a
 * hand-copied idea of it.
 *
 * Re-stating the contract inside the test would let the two drift, and a
 * contract test that agrees with a stale copy of the contract proves nothing.
 */

const SPEC_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'specs',
  '001-client-appointment-booking',
  'contracts',
  'http-api.yaml',
);

type Schema = Record<string, unknown>;

const document = parse(readFileSync(SPEC_PATH, 'utf8')) as Schema;

function resolve(node: unknown): Schema {
  const schema = node as Schema;
  const ref = schema['$ref'];
  if (typeof ref !== 'string') return schema;

  const resolved = ref
    .replace(/^#\//, '')
    .split('/')
    .reduce<unknown>((current, segment) => (current as Schema)?.[segment], document);

  // A $ref alongside sibling keys (description, and so on): the target wins.
  return { ...schema, ...resolve(resolved) };
}

/** The response schema declared for one operation and status code. */
export function responseSchema(pathName: string, method: string, status: string): Schema {
  const paths = document['paths'] as Schema;
  const operation = (paths[pathName] as Schema)?.[method] as Schema;
  if (operation === undefined) throw new Error(`No ${method} ${pathName} in the contract`);

  const response = resolve((operation['responses'] as Schema)[status]);
  const content = response['content'] as Schema | undefined;
  if (content === undefined) return {};

  return resolve((content['application/json'] as Schema)['schema']);
}

export function operationHeaders(pathName: string, method: string, status: string): Schema {
  const paths = document['paths'] as Schema;
  const operation = (paths[pathName] as Schema)?.[method] as Schema;
  const response = resolve((operation['responses'] as Schema)[status]);
  return (response['headers'] as Schema) ?? {};
}

const FORMAT_PATTERNS: Record<string, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  'date-time': /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
};

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

/** Every way the payload fails the schema, so one run reports them all. */
export function violations(schemaNode: unknown, value: unknown, at = '$'): readonly string[] {
  const schema = resolve(schemaNode);
  const problems: string[] = [];

  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    for (const part of allOf) problems.push(...violations(part, value, at));
  }

  const declaredType = schema['type'];
  if (declaredType !== undefined) {
    const types = Array.isArray(declaredType) ? declaredType : [declaredType];
    if (!types.some((type) => typeMatches(String(type), value))) {
      problems.push(`${at}: expected ${types.join(' | ')}, got ${describe(value)}`);
      return problems;
    }
  }

  const constant = schema['const'];
  if (constant !== undefined && value !== constant) {
    problems.push(`${at}: expected the constant ${JSON.stringify(constant)}`);
  }

  const enumeration = schema['enum'];
  if (Array.isArray(enumeration) && !enumeration.includes(value)) {
    problems.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(enumeration)}`);
  }

  if (typeof value === 'string') {
    const format = schema['format'];
    const formatPattern = typeof format === 'string' ? FORMAT_PATTERNS[format] : undefined;
    if (formatPattern !== undefined && !formatPattern.test(value)) {
      problems.push(`${at}: ${JSON.stringify(value)} is not a valid ${String(format)}`);
    }

    const pattern = schema['pattern'];
    if (typeof pattern === 'string' && !new RegExp(pattern).test(value)) {
      problems.push(`${at}: ${JSON.stringify(value)} does not match ${pattern}`);
    }
  }

  if (Array.isArray(value)) {
    const minItems = schema['minItems'];
    const maxItems = schema['maxItems'];
    if (typeof minItems === 'number' && value.length < minItems) {
      problems.push(`${at}: expected at least ${minItems} items, got ${value.length}`);
    }
    if (typeof maxItems === 'number' && value.length > maxItems) {
      problems.push(`${at}: expected at most ${maxItems} items, got ${value.length}`);
    }
    const items = schema['items'];
    if (items !== undefined) {
      value.forEach((item, index) => problems.push(...violations(items, item, `${at}[${index}]`)));
    }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;

    const required = schema['required'];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (!(String(key) in record)) problems.push(`${at}.${String(key)} is required and missing`);
      }
    }

    const properties = schema['properties'] as Schema | undefined;
    if (properties !== undefined) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in record) {
          problems.push(...violations(propertySchema, record[key], `${at}.${key}`));
        }
      }

      if (schema['additionalProperties'] === false) {
        for (const key of Object.keys(record)) {
          if (!(key in properties)) problems.push(`${at}.${key} is not allowed`);
        }
      }
    }
  }

  return problems;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Asserts the payload satisfies the contract, listing everything that fails. */
export function expectMatchesContract(schemaNode: unknown, value: unknown): void {
  const problems = violations(schemaNode, value);
  if (problems.length > 0) {
    throw new Error(`Response does not match contracts/http-api.yaml:\n  ${problems.join('\n  ')}`);
  }
}
