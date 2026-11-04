import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/**
 * Checks a response against a contract file itself, not against a hand-copied
 * idea of it.
 *
 * Re-stating the contract inside the test would let the two drift, and a
 * contract test that agrees with a stale copy of the contract proves nothing.
 *
 * One helper serves every contract (002, D-028): `contractAt` loads the file
 * under `specs/` it is given. The plain exports at the bottom are the client
 * contract's, which is what the 001 and 005 suites check.
 */

const SPECS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'specs');

type Schema = Record<string, unknown>;

export type Contract = {
  /** The response schema declared for one operation and status code. */
  responseSchema(pathName: string, method: string, status: string): Schema;
  /** The JSON request body schema of one operation (004: `emailConsent`). */
  requestSchema(pathName: string, method: string): Schema;
  /** The contract's own `info.version`. */
  version(): string;
  operationHeaders(pathName: string, method: string, status: string): Schema;
  /** Every way the payload fails the schema, so one run reports them all. */
  violations(schemaNode: unknown, value: unknown): readonly string[];
  /** Asserts the payload satisfies the contract, listing everything that fails. */
  expectMatchesContract(schemaNode: unknown, value: unknown): void;
};

/** `relativePath` is under `specs/`, e.g. `002-salon-management/contracts/owner-api.yaml`. */
export function contractAt(relativePath: string): Contract {
  const document = parse(readFileSync(path.join(SPECS_DIR, relativePath), 'utf8')) as Schema;
  const fileName = path.basename(relativePath);

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

  function operationOf(pathName: string, method: string): Schema {
    const paths = document['paths'] as Schema;
    const operation = (paths[pathName] as Schema)?.[method] as Schema | undefined;
    if (operation === undefined) throw new Error(`No ${method} ${pathName} in ${fileName}`);
    return operation;
  }

  function responseOf(pathName: string, method: string, status: string): Schema {
    return resolve((operationOf(pathName, method)['responses'] as Schema)[status]);
  }

  function violations(schemaNode: unknown, value: unknown): readonly string[] {
    return violationsOf(resolve, schemaNode, value, '$');
  }

  return {
    responseSchema(pathName, method, status) {
      const content = responseOf(pathName, method, status)['content'] as Schema | undefined;
      if (content === undefined) return {};

      return resolve((content['application/json'] as Schema)['schema']);
    },

    requestSchema(pathName, method) {
      const body = resolve(operationOf(pathName, method)['requestBody']);
      const content = body['content'] as Schema | undefined;
      if (content === undefined) throw new Error(`No request body for ${method} ${pathName} in ${fileName}`);
      return resolve((content['application/json'] as Schema)['schema']);
    },

    version() {
      return String((document['info'] as Schema)['version']);
    },

    operationHeaders(pathName, method, status) {
      return (responseOf(pathName, method, status)['headers'] as Schema) ?? {};
    },

    violations,

    expectMatchesContract(schemaNode, value) {
      const problems = violations(schemaNode, value);
      if (problems.length > 0) {
        throw new Error(`Response does not match ${fileName}:\n  ${problems.join('\n  ')}`);
      }
    },
  };
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

function violationsOf(
  resolve: (node: unknown) => Schema,
  schemaNode: unknown,
  value: unknown,
  at: string,
): readonly string[] {
  const violations = (node: unknown, child: unknown, where: string) =>
    violationsOf(resolve, node, child, where);
  const schema = resolve(schemaNode);
  const problems: string[] = [];

  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    for (const part of allOf) problems.push(...violations(part, value, at));
  }

  // Exactly one branch must fit: a body that fits two is as ambiguous as one
  // that fits none.
  const oneOf = schema['oneOf'];
  if (Array.isArray(oneOf)) {
    const fitting = oneOf.filter((branch) => violations(branch, value, at).length === 0);
    if (fitting.length !== 1) {
      problems.push(`${at}: expected exactly one of ${oneOf.length} schemas to match, ${fitting.length} did`);
    }
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
    if (schema['uniqueItems'] === true) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) problems.push(`${at}: expected unique items`);
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

export const { responseSchema, requestSchema, operationHeaders, violations, expectMatchesContract, version } = contractAt(
  '001-client-appointment-booking/contracts/http-api.yaml',
);
