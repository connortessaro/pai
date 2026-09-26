// Writes docs/reference.md from the code, then runs TypeDoc, which builds the
// docs site (code reference, guides and this reference) in docs/site. Run it
// with `npm run docs`.
//
// What comes from where:
//   - CLI: the branches of run() in src/pai.mts, read from its syntax tree
//     (commands, subcommands, the flags each branch reads, which need a key),
//     and the HELP text.
//   - MCP tools: listTools on a live server, so the input schemas are the ones
//     zod produces. The Phantom AI calls each tool reaches come from the tree.
//   - HTTP: every request() and fetch() call in src/pai.mts, with method, path,
//     headers sent and read, the body's fields (from the type checker) and the
//     response type.
//   - Environment variables: every env.X, process.env.X and env[k] read, against
//     ENV_VARS.
//
// It exits 1, and writes nothing, if the code and the docs disagree: a command
// in run() that HELP leaves out or the reverse, a subcommand or flag the code
// reads that HELP doesn't name or the reverse, an environment variable read
// but not listed or listed but never read, a tool or input field without a
// description, a tool without annotations, a Phantom AI call it can't read, or
// a guide, README or skill that names a command, flag or variable that doesn't
// exist. TypeDoc then fails on any undocumented export or broken {@link}
// (typedoc.json).
//
// `--check` writes nothing and also exits 1 if docs/reference.md is out of date.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ENV_VARS, HELP, createMcpServer } from '../src/pai.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = path.join(root, 'src', 'pai.mts');
const target = path.join(root, 'docs', 'reference.md');
const check = process.argv.includes('--check');
const problems = [];

// Variables pai reads that are not its own settings, so they stay out of
// ENV_VARS and HELP. Checked both ways against the code.
const OTHER_ENV = {
  HOME: 'Home folder. `setup` looks here for agents to set up and for `~/.claude/settings.json` (default: the system home folder)',
  ANTHROPIC_API_KEY: '`setup --agent claude --provider` warns when it is set, because Claude Code would send it instead of the Phantom AI key',
  ANTHROPIC_AUTH_TOKEN: '`setup --agent claude --provider` warns when it is set, for the same reason',
};

// Variables pai sets for other programs. Checked both ways against the code.
const WRITTEN_ENV = {
  AGENT_BROWSER_SESSION: 'Set for agent-browser by `browser`: `pai-<space>` unless already set',
  AGENT_BROWSER_PROFILE: 'Set for agent-browser by `browser`: `<state>/browser/<space>` unless already set',
  ANTHROPIC_BASE_URL: 'Written to the `env` block of `~/.claude/settings.json` by `setup --agent claude --provider`; removed by `--provider off`',
  ENABLE_TOOL_SEARCH: 'Written as `true` to the same `env` block, for the same command',
  ANTHROPIC_MODEL: 'Written to the same `env` block when `--model` is given',
};

// Libraries src/pai.mts loads with import() when they are needed: the ones
// that talk to a server, and the ones that don't. Checked both ways.
const NETWORK_MODULES = {
  imapflow: 'IMAP, to your mail server (`mail setup` saves which)',
  nodemailer: 'SMTP, to your mail server',
};
const LOCAL_MODULES = ['mailparser', 'nodemailer/lib/mail-composer'];

// Flags a command still reads only to refuse them with a message. Checked
// against the code: an entry for a flag the command no longer reads fails.
const REFUSED_FLAGS = {
  child: { budget: 'Retired. `child` refuses it and points to `--limit`.' },
};

// ── the syntax tree ──────────────────────────────────────────────────────────

const tsconfig = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, root);
const program = ts.createProgram(parsedConfig.fileNames, { ...parsedConfig.options, noEmit: true });
const checker = program.getTypeChecker();
const sf = program.getSourceFile(srcPath);
if (!sf) throw new Error(`gen-docs: TypeScript did not load ${srcPath}`);

function walk(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => walk(child, fn));
}
const lit = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined);
const unwrap = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n))) n = n.expression;
  return n;
};
const symbolOf = (n) => checker.getSymbolAtLocation(n);
const isExported = (n) => Boolean(ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export);
const inType = (n, stop) => {
  for (let p = n.parent; p && p !== stop; p = p.parent) if (ts.isTypeNode(p)) return true;
  return false;
};

// Every named function: declarations, arrow functions held in a const, and
// methods of an exported object (keychain.get). Keyed by symbol, so a local
// variable with the same name as a function is not mistaken for it.
const fns = new Map(); // symbol -> { name, node, exported, link }
walk(sf, (n) => {
  if (ts.isFunctionDeclaration(n) && n.name) {
    const exported = isExported(n);
    fns.set(symbolOf(n.name), { name: n.name.text, node: n, exported, link: exported ? n.name.text : null });
  } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
    const init = unwrap(n.initializer);
    const stmt = n.parent?.parent;
    const exported = ts.isVariableStatement(stmt) && isExported(stmt);
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      fns.set(symbolOf(n.name), { name: n.name.text, node: n, exported, link: exported ? n.name.text : null });
    } else if (ts.isObjectLiteralExpression(init)) {
      for (const m of init.properties) {
        if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) {
          fns.set(symbolOf(m.name), { name: `${n.name.text}.${m.name.text}`, node: m, exported, link: exported ? n.name.text : null });
        }
      }
    }
  }
});
const fnByName = (name) => [...fns.values()].find((f) => f.name === name);

// The functions a piece of code refers to, called or passed as a value.
function refs(node) {
  const out = new Set();
  walk(node, (n) => {
    if (!ts.isIdentifier(n) || inType(n, node)) return;
    const f = fns.get(symbolOf(n));
    if (f && f.node !== node) out.add(f);
  });
  return out;
}
const refCache = new Map();
function reach(node) {
  const seen = new Set();
  const queue = [...refs(node)];
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!refCache.has(f)) refCache.set(f, refs(f.node));
    queue.push(...refCache.get(f));
  }
  return seen;
}
function enclosingFn(node) {
  for (let p = node.parent; p; p = p.parent) {
    for (const f of fns.values()) if (f.node === p) return f;
  }
  return null;
}
// The nearest exported functions that call `f`, for naming a call made from
// private code: its callers, and theirs while they are private too.
function exportedCallers(f, seen = new Set()) {
  if (f.exported) return [f];
  if (seen.has(f)) return [];
  seen.add(f);
  const out = [];
  for (const g of fns.values()) {
    if (g === f) continue;
    if (!refCache.has(g)) refCache.set(g, refs(g.node));
    if (refCache.get(g).has(f)) for (const h of exportedCallers(g, seen)) if (!out.includes(h)) out.push(h);
  }
  return out;
}
const fnLink = (f) => (f.link ? `{@link ${f.link}}` : `\`${f.name}\``);

// ── HTTP calls ───────────────────────────────────────────────────────────────

const requestFn = fnByName('request');
const apiBaseFn = fnByName('apiBase');
if (!requestFn || !apiBaseFn) throw new Error('gen-docs: src/pai.mts no longer has request() and apiBase()');

// `/purchase/${encodeURIComponent(paymentId)}/status` -> /purchase/{paymentId}/status
function exprName(e) {
  e = unwrap(e);
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isCallExpression(e) && e.arguments.length === 1) return exprName(e.arguments[0]);
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return e.getText(sf);
}
function renderTemplate(t, skipFirst = false) {
  if (lit(t) !== undefined) return lit(t);
  if (!ts.isTemplateExpression(t)) return null;
  let s = skipFirst ? '' : t.head.text;
  t.templateSpans.forEach((span, i) => {
    if (!(skipFirst && i === 0)) s += `{${exprName(span.expression)}}`;
    s += span.literal.text;
  });
  return s;
}
function renderValue(e) {
  e = unwrap(e);
  if (lit(e) !== undefined) return lit(e);
  if (ts.isTemplateExpression(e)) return renderTemplate(e).replace(/\{(\w+)\}/g, '<$1>');
  return `<${exprName(e)}>`;
}
const whenText = (cond) => {
  cond = unwrap(cond);
  if (ts.isBinaryExpression(cond) && cond.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken && cond.right.getText(sf) === 'undefined') cond = cond.left;
  return `when \`${cond.getText(sf)}\` is given`;
};
// Header names, values and conditions in an object literal, a conditional
// spread, or a conditional object.
function readHeaders(e, when = null) {
  e = unwrap(e);
  const out = [];
  if (ts.isConditionalExpression(e)) {
    if (ts.isObjectLiteralExpression(unwrap(e.whenFalse)) && unwrap(e.whenFalse).properties.length === 0) {
      return readHeaders(e.whenTrue, whenText(e.condition));
    }
    problems.push(`can't read the headers at ${where(e)}`);
    return out;
  }
  if (!ts.isObjectLiteralExpression(e)) {
    out.push({ spread: exprName(e) });
    return out;
  }
  for (const p of e.properties) {
    if (ts.isPropertyAssignment(p)) {
      const name = lit(p.name) ?? (ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sf));
      out.push({ name, value: renderValue(p.initializer), when });
    } else if (ts.isSpreadAssignment(p)) {
      out.push(...readHeaders(p.expression, when));
    } else {
      problems.push(`can't read the headers at ${where(p)}`);
    }
  }
  return out;
}
function where(n) {
  const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
  return `src/pai.mts:${line + 1}`;
}
function fieldsOf(e) {
  const type = checker.getTypeAtLocation(e);
  return checker.getPropertiesOfType(type).map((p) => {
    const optional = Boolean(p.flags & ts.SymbolFlags.Optional);
    const t = checker.typeToString(checker.getTypeOfSymbolAtLocation(p, e), undefined, ts.TypeFormatFlags.NoTruncation);
    return `${p.name}${optional ? '?' : ''}: ${t.replace(/ \| undefined$/, '')}`;
  });
}
const option = (obj, name) => {
  obj = obj && unwrap(obj);
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  const p = obj.properties.find((q) => ts.isPropertyAssignment(q) && q.name.getText(sf) === name);
  return p?.initializer;
};

// The headers request() sends on every call, read from its fetch().
let baseHeaders = null;
walk(requestFn.node, (n) => {
  if (ts.isCallExpression(n) && n.expression.getText(sf) === 'fetch') baseHeaders = readHeaders(option(n.arguments[1], 'headers'));
});
if (!baseHeaders) throw new Error('gen-docs: could not find the fetch() inside request()');

// Response variables, so `res.headers.get(...)` is tied to the fetch that made `res`.
const headersRead = new Map(); // variable symbol -> header names
walk(sf, (n) => {
  if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== 'get') return;
  const obj = n.expression.expression;
  if (!ts.isPropertyAccessExpression(obj) || obj.name.text !== 'headers' || !ts.isIdentifier(obj.expression)) return;
  const sym = symbolOf(obj.expression);
  const name = lit(n.arguments[0]);
  if (name) headersRead.set(sym, [...(headersRead.get(sym) ?? []), name]);
});
// Fields read from `(await res.json()) as T`, for the fetch that made `res`.
const jsonCasts = new Map(); // variable symbol -> type node
walk(sf, (n) => {
  if (!ts.isAsExpression(n)) return;
  let inner = unwrap(n.expression);
  if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === 'catch') inner = unwrap(inner.expression.expression);
  if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === 'json' && ts.isIdentifier(inner.expression.expression)) {
    jsonCasts.set(symbolOf(inner.expression.expression), n.type);
  }
});
function responseVar(call) {
  let p = call.parent;
  while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
  return p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) ? symbolOf(p.name) : null;
}
function readHeadersOf(call) {
  let p = call.parent;
  while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
  return p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) ? headersRead.get(symbolOf(p.name)) ?? [] : [];
}

const phantomCalls = []; // { method, path, fn, body, response, headers, read }
const externalCalls = []; // { url, method, fn }
const rpcMethods = new Map(); // method -> Set(fn)
const dynamicImports = new Map(); // module -> Set(fn)

walk(sf, (n) => {
  if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const mod = lit(n.arguments[0]);
    const f = enclosingFn(n);
    if (mod && f) dynamicImports.set(mod, new Set([...(dynamicImports.get(mod) ?? []), f]));
    return;
  }
  if (!ts.isCallExpression(n)) return;
  const f = enclosingFn(n);

  // rpc.getBalance(...).send()
  if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'send') {
    const inner = unwrap(n.expression.expression);
    if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
      const t = checker.typeToString(checker.getTypeAtLocation(inner.expression.expression));
      if (/^Rpc\b/.test(t)) {
        const m = inner.expression.name.text;
        rpcMethods.set(m, new Set([...(rpcMethods.get(m) ?? []), f]));
      }
    }
    return;
  }

  if (ts.isIdentifier(n.expression) && fns.get(symbolOf(n.expression)) === requestFn) {
    const [methodArg, pathArg, , bodyArg, , headersArg] = n.arguments;
    const method = lit(methodArg);
    const p = renderTemplate(pathArg);
    if (!method || p === null) {
      problems.push(`can't read the method or path of the request() call at ${where(n)}`);
      return;
    }
    const hasBody = bodyArg && bodyArg.getText(sf) !== 'undefined';
    phantomCalls.push({
      method,
      path: p,
      fn: f,
      body: hasBody ? fieldsOf(bodyArg) : [],
      bodyRaw: hasBody && fieldsOf(bodyArg).length === 0 ? checker.typeToString(checker.getTypeAtLocation(bodyArg)) : null,
      response: n.typeArguments?.[0]?.getText(sf) ?? null,
      headers: [
        ...baseHeaders.flatMap((h) => (h.spread ? [] : h.when && !hasBody ? [] : [{ ...h, when: h.when && hasBody ? null : h.when }])),
        ...(headersArg ? readHeaders(headersArg) : []),
      ],
      read: [],
    });
    return;
  }

  if (ts.isIdentifier(n.expression) && n.expression.text === 'fetch' && !symbolOf(n.expression)?.declarations?.some((d) => d.getSourceFile() === sf)) {
    if (f === requestFn) return;
    const urlArg = unwrap(n.arguments[0]);
    const opts = n.arguments[1];
    const method = lit(option(opts, 'method')) ?? 'GET';
    const first = ts.isTemplateExpression(urlArg) ? unwrap(urlArg.templateSpans[0].expression) : null;
    if (first && ts.isCallExpression(first) && fns.get(symbolOf(first.expression)) === apiBaseFn) {
      const body = option(opts, 'body');
      const bodyExpr = body && ts.isCallExpression(unwrap(body)) && unwrap(body).expression.getText(sf) === 'JSON.stringify' ? unwrap(body).arguments[0] : null;
      const headersNode = option(opts, 'headers');
      phantomCalls.push({
        method,
        path: renderTemplate(urlArg, true),
        fn: f,
        body: bodyExpr ? fieldsOf(bodyExpr) : [],
        bodyRaw: null,
        response: null,
        headers: headersNode ? readHeaders(headersNode) : [],
        read: readHeadersOf(n),
        responseFields: jsonCasts.has(responseVar(n)) ? fieldsOf(jsonCasts.get(responseVar(n))) : [],
      });
    } else if (lit(urlArg)?.startsWith('https://')) {
      externalCalls.push({ url: lit(urlArg), method, fn: f });
    } else {
      problems.push(`can't read the URL of the fetch() at ${where(n)}`);
    }
  }
});
const siteKey = (c) => `${c.method} ${c.path}`;
for (const m of dynamicImports.keys()) {
  if (!NETWORK_MODULES[m] && !LOCAL_MODULES.includes(m)) problems.push(`src/pai.mts loads ${m}; add it to NETWORK_MODULES or LOCAL_MODULES in gen-docs`);
}
for (const m of [...Object.keys(NETWORK_MODULES), ...LOCAL_MODULES]) {
  if (!dynamicImports.has(m)) problems.push(`gen-docs lists the module ${m}, which src/pai.mts no longer loads`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const runFn = fnByName('run');
if (!runFn) throw new Error('gen-docs: src/pai.mts no longer has run()');

const isEq = (n) => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
const isArgv0 = (e) => e.getText(sf) === 'argv[0]';

const commands = new Map(); // name -> { node, subs:Set, flags:Set, refused:Set }
const globalFlags = new Set();
walk(runFn.node, (n) => {
  if (!ts.isIfStatement(n) || !isEq(n.expression)) return;
  const { left, right } = n.expression;
  const name = lit(right);
  if (name === undefined) return;
  if (left.getText(sf) === 'command' || (isArgv0(left) && !name.startsWith('-'))) {
    commands.set(name, { node: n.thenStatement, subs: new Set(), flags: new Set() });
  }
});
const blockOf = (node) => {
  for (const [name, c] of commands) {
    for (let p = node; p; p = p.parent) if (p === c.node) return name;
  }
  return null;
};

// Variables holding parseFlags() results, and helpers that index them with
// their first parameter (str('to')).
const flagVars = new Set();
walk(runFn.node, (n) => {
  if (ts.isVariableDeclaration(n) && n.initializer && ts.isCallExpression(unwrap(n.initializer)) && unwrap(n.initializer).expression.getText(sf) === 'parseFlags') {
    flagVars.add(symbolOf(n.name));
  }
});
const flagHelpers = new Set();
walk(runFn.node, (n) => {
  if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isArrowFunction(n.initializer)) return;
  const param = n.initializer.parameters[0];
  if (!param) return;
  const pSym = symbolOf(param.name);
  walk(n.initializer.body, (m) => {
    if (ts.isElementAccessExpression(m) && flagVars.has(symbolOf(m.expression)) && ts.isIdentifier(m.argumentExpression) && symbolOf(m.argumentExpression) === pSym) {
      flagHelpers.add(symbolOf(n.name));
    }
  });
});

const keylessDecl = (() => {
  let d = null;
  walk(runFn.node, (n) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'keyless') d = n;
  });
  return d;
})();
const inKeyless = (n) => {
  for (let p = n; p; p = p.parent) if (p === keylessDecl) return true;
  return false;
};
walk(runFn.node, (n) => {
  if (inKeyless(n)) return; // read below, as the commands that need no key
  const cmd = blockOf(n);
  const addFlag = (raw) => {
    const name = raw.replace(/^--?/, '').replace(/=$/, '');
    if (!name) return;
    if (cmd) commands.get(cmd).flags.add(name);
    else globalFlags.add(raw.startsWith('--') || raw.startsWith('-') ? raw.replace(/=$/, '') : `--${name}`);
  };
  if (ts.isElementAccessExpression(n) && flagVars.has(symbolOf(n.expression))) {
    const arg = n.argumentExpression;
    if (lit(arg) !== undefined) addFlag(`--${lit(arg)}`);
    else if (ts.isIdentifier(arg)) {
      // flags[limitFlag], where limitFlag = cond ? 'limit' : 'amount'
      const decl = symbolOf(arg)?.valueDeclaration;
      const init = decl && ts.isVariableDeclaration(decl) ? unwrap(decl.initializer) : null;
      if (init && ts.isConditionalExpression(init) && lit(init.whenTrue) && lit(init.whenFalse)) {
        addFlag(`--${lit(init.whenTrue)}`);
        addFlag(`--${lit(init.whenFalse)}`);
      } else if (!(ts.isArrowFunction(arg.parent?.parent?.parent) || flagHelpers.size)) {
        problems.push(`can't tell which flag ${n.getText(sf)} reads at ${where(n)}`);
      }
    }
  } else if (ts.isCallExpression(n)) {
    const callee = n.expression.getText(sf);
    if (callee === 'flagNum' && lit(n.arguments[1])) addFlag(`--${lit(n.arguments[1])}`);
    else if (ts.isIdentifier(n.expression) && flagHelpers.has(symbolOf(n.expression)) && lit(n.arguments[0])) addFlag(`--${lit(n.arguments[0])}`);
    else if (ts.isPropertyAccessExpression(n.expression) && ['includes', 'startsWith'].includes(n.expression.name.text) && lit(n.arguments[0])?.startsWith('-')) {
      addFlag(lit(n.arguments[0]));
    }
  } else if (isEq(n)) {
    const s = lit(n.right);
    if (s?.startsWith('-') && s !== '--') {
      if (isArgv0(n.left)) globalFlags.add(s);
      else addFlag(s);
    } else if (s !== undefined && cmd && ['subcommand', 'action'].includes(n.left.getText(sf))) {
      commands.get(cmd).subs.add(s);
    }
  }
});
for (const [cmd, flags] of Object.entries(REFUSED_FLAGS)) {
  for (const flag of Object.keys(flags)) {
    if (!commands.get(cmd)?.flags.has(flag)) problems.push(`REFUSED_FLAGS lists ${cmd} --${flag}, which run() no longer reads`);
  }
}

// Commands that need no key: the `keyless` expression in run().
const keyless = new Map(); // command -> null (always) or flags that make it keyless
walk(runFn.node, (n) => {
  if (!ts.isVariableDeclaration(n) || n.name.getText(sf) !== 'keyless') return;
  walk(n.initializer, (m) => {
    if (ts.isArrayLiteralExpression(m)) for (const e of m.elements) if (lit(e)) keyless.set(lit(e), null);
    if (isEq(m) && isArgv0(m.left) && lit(m.right)) {
      const cmd = lit(m.right);
      const flags = new Set();
      walk(m.parent, (k) => {
        if (lit(k)?.startsWith('--')) flags.add(lit(k).replace(/=$/, ''));
      });
      keyless.set(cmd, [...flags]);
    }
  });
});
if (keyless.size === 0) problems.push('could not find the keyless list in run()');

// HELP: one entry per line that starts at column 2; indented lines continue it.
const helpLines = HELP.split('\n');
const cmdStart = helpLines.indexOf('Commands:');
const flagStart = helpLines.indexOf('Flags:');
if (cmdStart === -1 || flagStart === -1) throw new Error('gen-docs: HELP has no Commands: or Flags: section');
const helpEntries = new Map(); // command -> text
let last = null;
for (const line of helpLines.slice(cmdStart + 1, flagStart)) {
  const m = /^ {2}(\S+)/.exec(line);
  if (m) {
    last = m[1];
    helpEntries.set(last, (helpEntries.get(last) ?? '') + line + '\n');
  } else if (line.trim() && last) {
    helpEntries.set(last, helpEntries.get(last) + line + '\n');
  }
}
const helpFlagsText = helpLines.slice(flagStart + 1, helpLines.findIndex((l, i) => i > flagStart && l.trim() === '')).join('\n');
const flagsIn = (text) => new Set([...text.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)].map((m) => m[1]));

for (const [cmd, c] of commands) {
  const text = helpEntries.get(cmd);
  if (!text) {
    problems.push(`run() handles \`${cmd}\`, which HELP leaves out`);
    continue;
  }
  for (const sub of c.subs) if (!new RegExp(`\\b${sub}\\b`).test(text)) problems.push(`run() handles \`${cmd} ${sub}\`, which HELP leaves out`);
  const named = flagsIn(text);
  for (const flag of c.flags) {
    if (!named.has(flag) && !REFUSED_FLAGS[cmd]?.[flag]) problems.push(`\`${cmd}\` reads --${flag}, which its HELP entry leaves out`);
  }
  for (const flag of named) if (!c.flags.has(flag)) problems.push(`HELP gives \`${cmd}\` a --${flag} flag, which run() never reads for it`);
}
for (const cmd of helpEntries.keys()) if (!commands.has(cmd)) problems.push(`HELP lists \`${cmd}\`, which run() does not handle`);
for (const flag of globalFlags) if (!new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(helpFlagsText)) problems.push(`run() reads ${flag} for every command, which the Flags section of HELP leaves out`);
for (const m of helpFlagsText.matchAll(/(?<![\w-])(--?[a-z][a-z-]*)/g)) if (!globalFlags.has(m[1])) problems.push(`HELP lists the flag ${m[1]}, which run() never reads`);
for (const cmd of keyless.keys()) if (!commands.has(cmd)) problems.push(`the keyless list names \`${cmd}\`, which run() does not handle`);

const callsFrom = (node) => {
  const reached = reach(node);
  const seen = new Set();
  return phantomCalls.filter((c) => reached.has(c.fn) && !seen.has(siteKey(c)) && seen.add(siteKey(c)));
};

// ── MCP tools ────────────────────────────────────────────────────────────────

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await createMcpServer({}).connect(serverSide);
const client = new Client({ name: 'gen-docs', version: '0' });
await client.connect(clientSide);
const { tools } = await client.listTools();
await client.close();

// Each registerTool call's handler, to find the Phantom AI calls it makes and
// whether it needs the key.
const toolHandlers = new Map();
walk(sf, (n) => {
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'registerTool') {
    const name = lit(n.arguments[0]);
    if (name) toolHandlers.set(name, n.arguments[2]);
    else problems.push(`can't read the tool name at ${where(n)}`);
  }
});
const resolveApiKeyFn = fnByName('resolveApiKey');
for (const t of tools) if (!toolHandlers.has(t.name)) problems.push(`tool ${t.name} is served but gen-docs found no registerTool call for it`);
for (const name of toolHandlers.keys()) if (!tools.some((t) => t.name === name)) problems.push(`registerTool('${name}') is in the code but the server does not list it`);

function typeOf(s) {
  if (s.anyOf) return s.anyOf.map(typeOf).join(' | ');
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (Array.isArray(s.type)) return s.type.join(' | ');
  if (s.type === 'array') return `${typeOf(s.items ?? {})}[]`;
  if (s.type === 'object' && s.additionalProperties && typeof s.additionalProperties === 'object' && !s.properties) {
    return `Record<string, ${typeOf(s.additionalProperties)}>`;
  }
  return s.type ?? 'any';
}
function limits(s) {
  const out = [];
  if (s.anyOf) for (const x of s.anyOf) out.push(...limits(x));
  if (s.type === 'integer') out.push('whole number');
  if (s.exclusiveMinimum !== undefined) out.push(`over ${s.exclusiveMinimum}`);
  if (s.minimum !== undefined) out.push(`at least ${s.minimum}`);
  if (s.maximum !== undefined) out.push(`at most ${s.maximum}`);
  if (s.minLength !== undefined) out.push(`at least ${s.minLength} character${s.minLength === 1 ? '' : 's'}`);
  if (s.maxLength !== undefined) out.push(`at most ${s.maxLength} characters`);
  if (s.pattern !== undefined) out.push(`matches \`${s.pattern}\``);
  return out;
}
// An object's own fields, then the fields of any object inside it
// (policy.rules[].if), so nested schemas are documented too.
function fieldRows(schema, prefix, required, owner) {
  const rows = [];
  for (const [name, s] of Object.entries(schema.properties ?? {})) {
    const full = prefix ? `${prefix}.${name}` : name;
    if (!prefix && !s.description?.trim()) problems.push(`tool ${owner}: field ${name} has no .describe()`);
    rows.push({ name: full, type: typeOf(s), required: required.has(name), description: s.description ?? '', limits: limits(s) });
    const obj = (s.anyOf ?? [s]).find((x) => x.type === 'object' && x.properties);
    if (obj) rows.push(...fieldRows(obj, full, new Set(obj.required ?? []), owner));
    const arr = (s.anyOf ?? [s]).find((x) => x.type === 'array' && x.items?.type === 'object' && x.items.properties);
    if (arr) rows.push(...fieldRows(arr.items, `${full}[]`, new Set(arr.items.required ?? []), owner));
  }
  return rows;
}

// ── environment variables ────────────────────────────────────────────────────

const envRead = new Map(); // name -> Set(where)
const isEnvObject = (e) => {
  const t = e.getText(sf);
  return t === 'env' || t === 'process.env';
};
walk(sf, (n) => {
  const add = (name) => envRead.set(name, new Set([...(envRead.get(name) ?? []), where(n)]));
  if (ts.isPropertyAccessExpression(n) && isEnvObject(n.expression) && !(ts.isBinaryExpression(n.parent) && n.parent.left === n && n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken)) {
    add(n.name.text);
  } else if (ts.isElementAccessExpression(n) && isEnvObject(n.expression)) {
    const key = n.argumentExpression;
    if (lit(key) !== undefined) return add(lit(key));
    // ['A', 'B'].filter((k) => env[k])
    const decl = ts.isIdentifier(key) ? symbolOf(key)?.valueDeclaration : null;
    const arrow = decl && ts.isParameter(decl) ? decl.parent : null;
    const call = arrow?.parent;
    const array = call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) ? unwrap(call.expression.expression) : null;
    if (array && ts.isArrayLiteralExpression(array) && array.elements.every((e) => lit(e) !== undefined)) {
      for (const e of array.elements) add(lit(e));
    } else {
      problems.push(`can't tell which environment variable ${n.getText(sf)} reads at ${where(n)}`);
    }
  }
});
const listed = new Set(ENV_VARS.map((v) => v.name));
for (const name of envRead.keys()) {
  if (!listed.has(name) && !OTHER_ENV[name]) problems.push(`src/pai.mts reads ${name}, which ENV_VARS leaves out`);
}
for (const name of listed) if (!envRead.has(name)) problems.push(`ENV_VARS lists ${name}, which src/pai.mts never reads`);
for (const name of Object.keys(OTHER_ENV)) {
  if (!envRead.has(name)) problems.push(`gen-docs OTHER_ENV lists ${name}, which src/pai.mts never reads`);
  if (listed.has(name)) problems.push(`${name} is in both ENV_VARS and gen-docs OTHER_ENV`);
}
for (const v of ENV_VARS) if (!v.about?.trim()) problems.push(`ENV_VARS: ${v.name} has no description`);

// Every variable-like name in the code (a string, an object key or a property
// name such as vars.ANTHROPIC_MODEL) must be read, or set for another program.
const envLike = /^(?:PHANTOM|PAI|AGENT_BROWSER|ANTHROPIC|ENABLE)_[A-Z0-9_]+$/;
const mentioned = new Set();
walk(sf, (n) => {
  let name;
  if (lit(n) !== undefined && envLike.test(lit(n))) name = lit(n);
  else if (ts.isIdentifier(n) && envLike.test(n.text) && (ts.isPropertyAccessExpression(n.parent) || ts.isPropertyAssignment(n.parent))) name = n.text;
  if (name) mentioned.add(name);
  // Variables named inside messages and descriptions must exist too.
  const text = lit(n) ?? (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ? n.text : undefined);
  if (text) for (const m of text.matchAll(/\b(?:PHANTOM|PAI|AGENT_BROWSER)_[A-Z0-9_]+\b/g)) {
    if (!listed.has(m[0]) && !OTHER_ENV[m[0]] && !WRITTEN_ENV[m[0]]) problems.push(`a string at ${where(n)} names ${m[0]}, which is not an environment variable pai reads`);
  }
});
for (const name of mentioned) {
  if (!envRead.has(name) && !WRITTEN_ENV[name]) problems.push(`src/pai.mts names ${name}, which it neither reads from the environment nor is in gen-docs WRITTEN_ENV`);
}
for (const name of Object.keys(WRITTEN_ENV)) if (!mentioned.has(name)) problems.push(`gen-docs WRITTEN_ENV lists ${name}, which src/pai.mts no longer sets`);

// ── guides, README and skill ─────────────────────────────────────────────────

// Prose that names a command, flag or variable must name one that exists.
const knownEnv = new Set([...listed, ...Object.keys(OTHER_ENV), ...Object.keys(WRITTEN_ENV)]);
const proseFiles = [
  'README.md',
  'CONTRIBUTING.md',
  'skills/phantom-ai/SKILL.md',
  'docs/index.md',
  ...(existsSync(path.join(root, 'docs', 'guides')) ? readdirSync(path.join(root, 'docs', 'guides')).filter((f) => f.endsWith('.md')).map((f) => `docs/guides/${f}`) : []),
];
for (const file of proseFiles) {
  const text = readFileSync(path.join(root, file), 'utf-8');
  for (const m of text.matchAll(/\b(?:PHANTOM|PAI|AGENT_BROWSER)_[A-Z0-9_]+\b/g)) {
    if (!knownEnv.has(m[0])) problems.push(`${file} names ${m[0]}, which pai does not read`);
  }
  // Code only: inline `...` spans and fenced blocks.
  const code = [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0].replace(/^`+[a-z]*|`+$/g, ''));
  for (const snippet of code) {
    for (const raw of snippet.split('\n')) {
      const line = raw.replace(/(^|\s)#.*$/, ''); // shell comments
      // pai where a command starts: the line start, after $( | && ; or
      // VAR=value, or run through npx.
      const invocation = /(?:^|\$\(|&&|\|\||[|;])\s*(?:[A-Z_][A-Z0-9_]*=\S*\s+)*(?:npx\s+(?:-y\s+)?(?:@connortessaro\/|github:connortessaro\/))?pai(?:\s+((?:[^\s|;&)`]+\s*)*))?/g;
      for (const m of line.matchAll(invocation)) {
        if (m[1] === undefined) continue;
        const words = m[1].trim().split(/\s+/).filter(Boolean);
        const cmd = words[0];
        if (!cmd || cmd.startsWith('<') || cmd.startsWith('-')) {
          for (const w of words) if (/^-/.test(w) && !globalFlags.has(w.replace(/=.*/, ''))) problems.push(`${file}: \`pai ${words.join(' ')}\` uses ${w}, which is not a flag of pai`);
          continue;
        }
        if (!/^[a-z]+$/.test(cmd)) continue;
        if (!commands.has(cmd)) {
          problems.push(`${file}: \`pai ${words.join(' ')}\` names a command pai does not have`);
          continue;
        }
        if (cmd === 'browser' && !['setup', 'status'].includes(words[1])) continue; // the rest goes to agent-browser
        for (const w of words.slice(1)) {
          if (w === '--') break;
          const flag = /^--([a-z][a-z-]*)/.exec(w)?.[1];
          if (flag && !commands.get(cmd).flags.has(flag) && !globalFlags.has(`--${flag}`)) {
            problems.push(`${file}: \`pai ${words.join(' ')}\` uses --${flag}, which \`${cmd}\` does not read`);
          }
        }
      }
    }
  }
}

// ── the file ─────────────────────────────────────────────────────────────────

// Markdown would read `<name>` as an HTML tag and hide it.
const text = (t) => t.replace(/</g, '&lt;');
// A table cell: no pipes or newlines.
const cell = (t) => text(t).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (t) => `\`${t.replace(/\|/g, '\\|')}\``;
const yes = (flag) => (flag ? 'yes' : '');
const list = (items) => (items.length ? items.join(', ') : '');
const endpoints = (calls) => list(calls.map((c) => code(siteKey(c))));

const commandRows = [...commands.keys()].sort().map((name) => {
  const c = commands.get(name);
  const k = keyless.has(name) ? (keyless.get(name) ? `only without ${keyless.get(name).map(code).join(', ')}` : 'no') : name === 'mcp' ? 'per tool' : 'yes';
  const flags = [...c.flags].filter((f) => !REFUSED_FLAGS[name]?.[f]).sort().map((f) => code(`--${f}`));
  return `| ${code(name)} | ${list([...c.subs].sort().map(code))} | ${list(flags)} | ${k} | ${endpoints(callsFrom(c.node))} |`;
});
const refusedRows = Object.entries(REFUSED_FLAGS).flatMap(([cmd, flags]) => Object.entries(flags).map(([f, why]) => `| ${code(`${cmd} --${f}`)} | ${cell(why)} |`));

function toolSection(tool) {
  if (!tool.description?.trim()) problems.push(`tool ${tool.name} has no description`);
  const a = tool.annotations ?? {};
  if (a.readOnlyHint === undefined || a.openWorldHint === undefined) problems.push(`tool ${tool.name} needs readOnlyHint and openWorldHint annotations`);
  if (a.readOnlyHint === false && a.destructiveHint === undefined) problems.push(`tool ${tool.name} writes, so it needs a destructiveHint annotation`);
  const kind = a.readOnlyHint ? 'Read-only.' : a.destructiveHint ? 'Writes. Destructive.' : 'Writes. Not destructive.';
  const handler = toolHandlers.get(tool.name);
  const reached = handler ? reach(handler) : new Set();
  const usesKey = reached.has(resolveApiKeyFn);
  const calls = handler ? callsFrom(handler) : [];
  const lines = [
    `### \`${tool.name}\``,
    '',
    text(tool.description ?? ''),
    '',
    `${kind} ${usesKey ? 'Runs as the configured key.' : 'Needs no API key.'}${calls.length ? ` Phantom AI calls: ${endpoints(calls)}.` : ' Makes no Phantom AI call.'}`,
    '',
  ];
  const rows = fieldRows(tool.inputSchema ?? {}, '', new Set(tool.inputSchema?.required ?? []), tool.name);
  if (rows.length === 0) return [...lines, 'No input.'].join('\n');
  lines.push('| Field | Type | Required | Limits | Description |', '| --- | --- | --- | --- | --- |');
  for (const r of rows) lines.push(`| ${code(r.name)} | ${code(r.type)} | ${r.required ? 'required' : 'optional'} | ${cell(r.limits.join(', '))} | ${cell(r.description)} |`);
  return lines.join('\n');
}

const headerCell = (hs) => list(hs.map((h) => `${code(`${h.name}: ${h.value}`)}${h.when ? ` (${h.when})` : ''}`));
const httpRows = [...phantomCalls]
  .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  .map((c) => {
    const from = list(exportedCallers(c.fn).map(fnLink));
    const body = c.body.length ? c.body.map(code).join('<br>') : c.bodyRaw ? code(c.bodyRaw) : '';
    const response = c.response ? `{@link ${c.response}}` : (c.responseFields ?? []).map(code).join('<br>');
    return `| ${code(c.method)} | ${code(c.path)} | ${from} | ${body} | ${headerCell(c.headers)} | ${list(c.read.map(code))} | ${response} |`;
  });

const envSection = [
  '| Variable | Meaning | Secret | Environment only | Cap |',
  '| --- | --- | --- | --- | --- |',
  ...ENV_VARS.map((v) => `| \`${v.name}\` | ${cell(v.about)} | ${yes(v.secret)} | ${yes(v.envOnly)} | ${yes(v.cap)} |`),
].join('\n');

const byFn = (set) => list([...set].flatMap((f) => exportedCallers(f)).filter((f, i, a) => a.indexOf(f) === i).map(fnLink));

const doc = [
  '---',
  'title: Interface reference',
  'group: Reference',
  '---',
  '',
  '<!-- Generated by `npm run docs` from src/pai.mts. Do not edit: change the code and run `npm run docs`. -->',
  '',
  '# pai interface reference',
  '',
  '`npm run docs` writes this file from `src/pai.mts`. Do not edit it by hand. On the',
  '[docs site](https://connortessaro.github.io/pai/) the names in braces link to the code reference.',
  '',
  '## CLI',
  '',
  'Each command, the subcommands and flags its branch of {@link run} reads, whether it needs a',
  'Phantom AI key, and the Phantom AI calls it can make (see [HTTP calls](#http-calls-to-phantom-ai)).',
  'Every command also takes the flags in the Flags section of the help text.',
  '',
  '| Command | Subcommands | Flags | Needs a key | Phantom AI calls |',
  '| --- | --- | --- | --- | --- |',
  ...commandRows,
  '',
  ...(refusedRows.length ? ['Flags a command reads only to refuse:', '', '| Flag | Why |', '| --- | --- |', ...refusedRows, ''] : []),
  'The output of `pai --help`:',
  '',
  '```text',
  HELP,
  '```',
  '',
  '## MCP tools',
  '',
  '`pai mcp` serves these tools over stdio ({@link createMcpServer}).',
  '',
  tools.map(toolSection).join('\n\n'),
  '',
  '## HTTP calls to Phantom AI',
  '',
  `Every call goes to \`PHANTOM_BASE_URL\` (default {@link DEFAULT_BASE_URL}, \`${DEFAULT_BASE_URL_VALUE()}\`), which must be https ({@link httpsOnly}).`,
  'A failed call becomes a {@link PhantomApiError}. `<apiKey>` is the key the command runs as, except',
  '`DELETE /key`, which sends the key being deleted.',
  '',
  '| Method | Path | Made by | Body fields | Headers sent | Headers read | Response |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...httpRows,
  '',
  '## Other network calls',
  '',
  '| Goes to | What | Made by |',
  '| --- | --- | --- |',
  ...externalCalls.map((c) => `| ${code(c.url)} | ${code(c.method)} | ${byFn([c.fn])} |`),
  ...[...rpcMethods.entries()].sort().map(([m, set]) => `| Solana RPC (\`PHANTOM_SOLANA_RPC\`) | ${code(m)} | ${byFn(set)} |`),
  ...[...dynamicImports.entries()].filter(([m]) => NETWORK_MODULES[m]).sort().map(([m, set]) => `| ${cell(NETWORK_MODULES[m])} | through ${code(m)} | ${byFn(set)} |`),
  '',
  '## Environment variables',
  '',
  'Secret: holds a secret, so keep it out of files, logs and the model\'s context. Environment only: no',
  'flag or tool argument can set it. Cap: limits what an agent can spend or send. The list is {@link ENV_VARS}.',
  '',
  envSection,
  '',
  'pai also reads these, which are not its own settings:',
  '',
  '| Variable | Why pai reads it |',
  '| --- | --- |',
  ...Object.entries(OTHER_ENV).map(([k, v]) => `| \`${k}\` | ${cell(v)} |`),
  '',
  'pai sets these for other programs:',
  '',
  '| Variable | Where |',
  '| --- | --- |',
  ...Object.entries(WRITTEN_ENV).map(([k, v]) => `| \`${k}\` | ${cell(v)} |`),
  '',
].join('\n');

function DEFAULT_BASE_URL_VALUE() {
  const decl = [...fns.values()].length && sf.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => d.name.getText(sf) === 'DEFAULT_BASE_URL'));
  const init = decl?.declarationList.declarations.find((d) => d.name.getText(sf) === 'DEFAULT_BASE_URL')?.initializer;
  if (!lit(init)) problems.push('could not read DEFAULT_BASE_URL');
  return lit(init) ?? '';
}

if (problems.length) {
  console.error(`gen-docs: the code and the docs disagree. Fix these:\n${[...new Set(problems)].map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}

if (check) {
  let current = '';
  try {
    current = readFileSync(target, 'utf-8');
  } catch {}
  if (current !== doc) {
    console.error('gen-docs: docs/reference.md is out of date. Run `npm run docs` and commit the result.');
    process.exit(1);
  }
  console.log('gen-docs: docs/reference.md is up to date');
} else {
  writeFileSync(target, doc);
  console.log('gen-docs: wrote docs/reference.md');
}

// ── the site (TypeDoc) ───────────────────────────────────────────────────────

// With --check, TypeDoc still reads the code and the guides and reports
// problems, but writes nothing.
const typedoc = spawnSync('npx', ['typedoc', ...(check ? ['--emit', 'none'] : [])], { cwd: root, stdio: 'inherit' });
if (typedoc.status !== 0) {
  console.error('gen-docs: TypeDoc failed. Fix what it reports.');
  process.exit(1);
}
if (!check) console.log('gen-docs: wrote the site to docs/site');
