import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Scrub high-confidence secrets from tool output and from the LLM context
 * copy. Pi still opens the file locally; the model and the persisted tool
 * result see placeholders instead.
 *
 * This is not a sandbox. Novel secret formats slip through. Do not treat it
 * as the only control before sending a dirty tree to a hosted model.
 */

type Hit = { n: number };

const PLACEHOLDER = "<redacted>";

const BLOCKS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----/g,
];

const TOKENS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/g,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
];

const ASSIGN =
  /\b(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|password|passwd|client[_-]?secret)\b(\s*[:=]\s*)(["']?)[^\s"'\\]+(\3)/gi;

const URL_PASS = /(\w+:\/\/[^:/?#\s]+:)[^@/\s]+(@)/g;

function bump(text: string, re: RegExp, repl: string | ((...args: string[]) => string), hit: Hit): string {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const copy = new RegExp(re.source, flags);
  return text.replace(copy, (...args) => {
    hit.n += 1;
    return typeof repl === "string" ? repl : repl(...(args as string[]));
  });
}

export function redactText(input: string): { text: string; hits: number } {
  const hit: Hit = { n: 0 };
  let text = input;
  for (const re of BLOCKS) {
    text = bump(
      text,
      re,
      `-----BEGIN PRIVATE KEY-----\n${PLACEHOLDER}\n-----END PRIVATE KEY-----`,
      hit,
    );
  }
  for (const re of TOKENS) text = bump(text, re, PLACEHOLDER, hit);
  text = bump(text, ASSIGN, (_m, key, op, q) => `${key}${op}${q}${PLACEHOLDER}${q}`, hit);
  text = bump(text, URL_PASS, (_m, prefix, suffix) => `${prefix}${PLACEHOLDER}${suffix}`, hit);
  return { text, hits: hit.n };
}

function redactAny(value: unknown, hit: Hit): unknown {
  if (typeof value === "string") {
    const out = redactText(value);
    hit.n += out.hits;
    return out.text;
  }
  if (Array.isArray(value)) return value.map((v) => redactAny(v, hit));
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const dst: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) dst[k] = redactAny(v, hit);
    return dst;
  }
  return value;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    const hit: Hit = { n: 0 };
    const content = redactAny(event.content, hit);
    const details = event.details === undefined ? undefined : redactAny(event.details, hit);
    if (hit.n === 0) return;
    return {
      content,
      ...(details === undefined ? {} : { details }),
    };
  });

  pi.on("context", async (event, ctx) => {
    const hit: Hit = { n: 0 };
    const messages = redactAny(event.messages, hit) as typeof event.messages;
    if (hit.n === 0) return;
    ctx.ui.setStatus("redact-secrets", `redacted ${hit.n}`);
    return { messages };
  });
}
