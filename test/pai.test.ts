import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const nodemailerMock = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock('nodemailer', () => ({ ...nodemailerMock, default: nodemailerMock }));
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PhantomApiError,
  CliError,
  parseFlags,
  flagNum,
  request,
  getBalance,
  getBudget,
  setBudget,
  createChild,
  rotateKey,
  burnKey,
  handleError,
  run,
  tableBalance,
  tableBudget,
  tableChild,
  tableRotate,
  tableBurn,
  listChildren,
  tableChildren,
  createMcpServer,
  VERSION,
  requestSolanaPayment,
  parseBuyCoin,
  getPaymentStatus,
  waitForPayment,
  tableSolanaPayment,
  toBaseUnits,
  buyAndPay,
  autoTopup,
  walletSpentToday,
  createWallet,
  listWallets,
  useWallet,
  resolveWalletName,
  progress,
  paymentStage,
  associatedTokenAddress,
  checkReceipt,
  verifyModel,
  modelsMatch,
  resolveApiKey,
  setupAgents,
  parseCondition,
  keyId,
  listNamedKeys,
  addMemory,
  searchMemory,
  listMemory,
  memorySpace,
  sandboxArgs,
  browserEnv,
  parseServer,
  mailSetup,
  mailSend,
  mailSendLimit,
  mailRecipients,
  mailAllowed,
  mailConfig,
  keychain,
  saveApiKey,
  removeApiKey,
} from '../src/pai.mts';
import { generateKeyPairSync, sign } from 'node:crypto';
import { address, getBase58Encoder } from '@solana/kit';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CHILDREN = {
  children: [
    {
      id: 'a1b2c3d4e5f6',
      active: true,
      limit_usd: 0.5,
      credit_spent_usd: 0.25,
      credit_left_usd: 0.25,
      rate_usd_per_min: 0.1,
      expires_at: '2026-09-23T00:00:00.000Z',
      created_at: '2026-09-22T00:00:00.000Z',
    },
  ],
  totals: { count: 1, credit_spent_usd: 0.25 },
};

describe('argument parsing: parseFlags', () => {
  it('parses --flag value', () => {
    expect(parseFlags(['--key', 'sk-abc'])).toEqual({ key: 'sk-abc' });
  });

  it('parses --flag=value', () => {
    expect(parseFlags(['--key=sk-abc'])).toEqual({ key: 'sk-abc' });
  });

  it('parses boolean flag', () => {
    expect(parseFlags(['--table'])).toEqual({ table: true });
  });

  it('parses multiple flags', () => {
    expect(parseFlags(['--amount', '5', '--ttl', '24', '--table'])).toEqual({
      amount: '5',
      ttl: '24',
      table: true,
    });
  });

  it('returns empty object when no flags given', () => {
    expect(parseFlags([])).toEqual({});
  });

  it('handles positional args before flags', () => {
    expect(parseFlags(['--budget', '10'])).toEqual({ budget: '10' });
  });
});

describe('numeric flag validation: flagNum', () => {
  it('parses valid numeric values', () => {
    expect(flagNum({ amount: '5' }, 'amount')).toBe(5);
    expect(flagNum({ rate: '0.25' }, 'rate')).toBe(0.25);
  });

  it('returns undefined when flag is omitted', () => {
    expect(flagNum({}, 'amount')).toBeUndefined();
  });

  it('rejects a valueless numeric flag (flag set to true)', () => {
    expect(() => flagNum({ amount: true }, 'amount')).toThrowError(
      /--amount requires a number/,
    );
  });

  it('rejects an empty string numeric flag', () => {
    expect(() => flagNum({ amount: '   ' }, 'amount')).toThrowError(
      /--amount requires a number/,
    );
  });

  it('rejects non-numeric string values', () => {
    expect(() => flagNum({ amount: 'notanumber' }, 'amount')).toThrowError(
      /--amount must be a number/,
    );
  });
});

describe('request() and error normalisation', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('normalises 401 with string error message', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_key' }),
    } as unknown as Response);

    await expect(request('GET', '/key/balance', 'bad-key', undefined, 'https://test.local')).rejects.toMatchObject({
      name: 'PhantomApiError',
      status: 401,
      code: 'invalid_key',
      message: 'invalid_key',
    });
  });

  it('normalises 401 with structured error object', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'unauthorized', message: 'Bearer token is invalid.' },
      }),
    } as unknown as Response);

    await expect(request('GET', '/key/balance', 'bad-key', undefined, 'https://test.local')).rejects.toMatchObject({
      name: 'PhantomApiError',
      status: 401,
      code: 'unauthorized',
      message: 'Bearer token is invalid.',
    });
  });

  it('normalises 402 insufficient balance error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({
        error: {
          message: 'The calling key cannot cover that amount, or is inactive.',
          type: 'insufficient_quota',
          code: 'insufficient_balance',
        },
      }),
    } as unknown as Response);

    await expect(
      request('POST', '/key/child', 'sk-test', { limit_usd: 999 }, 'https://test.local'),
    ).rejects.toMatchObject({
      name: 'PhantomApiError',
      status: 402,
      code: 'insufficient_balance',
      message: 'The calling key cannot cover that amount, or is inactive.',
    });
  });

  it('handles non-JSON error responses gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('Not JSON');
      },
    } as unknown as Response);

    await expect(request('GET', '/key/balance', 'sk-test', undefined, 'https://test.local')).rejects.toMatchObject({
      name: 'PhantomApiError',
      status: 500,
      code: '500',
      message: 'HTTP 500',
    });
  });

  it('sends correct headers with and without body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    await request('GET', '/key/balance', 'sk-test', undefined, 'https://test.local');
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/key/balance', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer sk-test',
      },
      body: undefined,
    });

    await request('POST', '/key/child', 'sk-test', { amount_usd: 5 }, 'https://test.local');
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/key/child', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk-test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount_usd: 5 }),
    });
  });
});

describe('client operations against stubbed fetch', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getBalance queries /key/balance and parses response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active: true,
        kind: 'credit',
        credit_balance_usd: 15.5,
        credit_spent_usd: 2.5,
        expires_at: '2027-01-01T00:00:00.000Z',
      }),
    } as unknown as Response);

    const res = await getBalance('sk-test', 'https://test.local');
    expect(res.active).toBe(true);
    expect(res.credit_balance_usd).toBe(15.5);
    expect(res.credit_spent_usd).toBe(2.5);
  });

  it('getBudget queries /key/budget', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        budget_usd: 20,
        spent_this_period_usd: 5,
        period_started: '2026-09-01T00:00:00.000Z',
        exhausted: false,
        rate_usd_per_min: 1.0,
        spent_this_minute_usd: 0.1,
        rate_exceeded: false,
      }),
    } as unknown as Response);

    const res = await getBudget('sk-test', 'https://test.local');
    expect(res.budget_usd).toBe(20);
    expect(res.rate_usd_per_min).toBe(1.0);
  });

  it('setBudget sends PATCH with budget and rate', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        budget_usd: 25,
        spent_this_period_usd: 0,
        period_started: '2026-09-21T00:00:00.000Z',
        exhausted: false,
        rate_usd_per_min: 2.0,
        spent_this_minute_usd: 0,
        rate_exceeded: false,
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    const res = await setBudget('sk-test', { budget_usd: 25, rate_usd_per_min: 2.0 }, 'https://test.local');
    expect(res.budget_usd).toBe(25);
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/key/budget', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ budget_usd: 25, rate_usd_per_min: 2.0 }),
    }));
  });

  it('createChild sends POST with parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        api_key: 'sk-child-123',
        limit_usd: 5,
        expires_at: '2026-09-22T00:00:00.000Z',
        rate_usd_per_min: null,
        parent_balance_usd: 10,
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    const res = await createChild('sk-test', { limit_usd: 5, ttl_hours: 12 }, 'https://test.local');
    expect(res.api_key).toBe('sk-child-123');
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/key/child', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ limit_usd: 5, ttl_hours: 12 }),
    }));
  });

  it('listChildren queries /key/children', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => CHILDREN } as unknown as Response);
    globalThis.fetch = fetchMock;

    const res = await listChildren('sk-test', 'https://test.local');
    expect(res.totals.count).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/key/children', expect.objectContaining({ method: 'GET' }));
  });

  it('rotateKey sends POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        api_key: 'sk-new-key',
        rotated_at: '2026-09-21T18:00:00.000Z',
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    const res = await rotateKey('sk-test', 'https://test.local');
    expect(res.api_key).toBe('sk-new-key');
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/key/rotate', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('burnKey sends DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        revoked: true,
        forfeited_usd: 3.5,
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    const res = await burnKey('sk-test', 'https://test.local');
    expect(res.revoked).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/key', expect.objectContaining({
      method: 'DELETE',
    }));
  });
});

describe('handleError and exit codes', () => {
  it('maps 401 and 403 PhantomApiError to exit code 2', () => {
    let stderr = '';
    const code401 = handleError(new PhantomApiError(401, 'invalid_key', 'Unauthorized'), (s) => {
      stderr += s;
    });
    expect(code401).toBe(2);
    expect(JSON.parse(stderr)).toEqual({
      error: { status: 401, code: 'invalid_key', message: 'Unauthorized' },
    });

    stderr = '';
    const code403 = handleError(new PhantomApiError(403, 'forbidden', 'Forbidden'), (s) => {
      stderr += s;
    });
    expect(code403).toBe(2);
  });

  it('maps 402 PhantomApiError to exit code 1', () => {
    let stderr = '';
    const code = handleError(
      new PhantomApiError(402, 'insufficient_balance', 'Cannot cover amount'),
      (s) => {
        stderr += s;
      },
    );
    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toEqual({
      error: { status: 402, code: 'insufficient_balance', message: 'Cannot cover amount' },
    });
  });

  it('handles CliError with its exitCode', () => {
    let stderr = '';
    const code = handleError(new CliError('Missing flag', 'cli_error', 1), (s) => {
      stderr += s;
    });
    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'cli_error', message: 'Missing flag' },
    });
  });

  it('handles generic Error with exit code 1', () => {
    let stderr = '';
    const code = handleError(new Error('Network timeout'), (s) => {
      stderr += s;
    });
    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'unknown', message: 'Network timeout' },
    });
  });
});

describe('end-to-end command runner: run()', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('prints help and exits 0 when --help is passed', async () => {
    let stdout = '';
    let stderr = '';
    const code = await run(['--help'], {}, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
    expect(code).toBe(0);
    expect(stdout).toContain('pai — keys, money and subagents for AI agents (Phantom AI)');
    expect(stderr).toBe('');
  });

  it('prints help instead of running a command given --help or -h', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'pai-help-'));
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    for (const argv of [['setup', '--help'], ['child', '--limit', '1', '-h'], ['wallet', 'create', '--help']]) {
      let stdout = '';
      const code = await run(argv, { HOME: home, PHANTOM_STATE_DIR: home }, { stdout: (s) => (stdout += s), stderr: () => {} });
      expect(code).toBe(0);
      expect(stdout).toContain('pai — keys, money and subagents');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readdirSync(home)).toEqual([]);
  });

  it('exits 1 with error when no key is set or saved', async () => {
    let stdout = '';
    let stderr = '';
    const empty = mkdtempSync(path.join(tmpdir(), 'phantom-nokey-'));
    const code = await run(['balance'], { PHANTOM_API_KEY: '', PHANTOM_STATE_DIR: empty }, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'cli_error', message: 'No API key. Set PHANTOM_API_KEY or run: pai login' },
    });
  });

  it('exits 1 for unknown command', async () => {
    let stderr = '';
    const code = await run(['nonexistent'], { PHANTOM_API_KEY: 'sk-test' }, { stdout: () => {}, stderr: (s) => (stderr += s) });
    expect(code).toBe(1);
    expect(JSON.parse(stderr).error.code).toBe('cli_error');
  });

  it('runs balance end-to-end with JSON output', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active: true,
        kind: 'credit',
        credit_balance_usd: 12.34,
        credit_spent_usd: 1.0,
        expires_at: '2027-01-01T00:00:00.000Z',
      }),
    } as unknown as Response);

    let stdout = '';
    let stderr = '';
    const code = await run(
      ['balance'],
      { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' },
      { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(0);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout);
    expect(parsed.credit_balance_usd).toBe(12.34);
  });

  it('runs balance --table with formatted table output', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active: true,
        kind: 'credit',
        credit_balance_usd: 12.34,
        credit_spent_usd: 1.0,
        expires_at: '2027-01-01T00:00:00.000Z',
      }),
    } as unknown as Response);

    let stdout = '';
    const code = await run(
      ['balance', '--table'],
      { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' },
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(stdout).toContain('balance         $12.3400');
    expect(stdout).toContain('spent           $1.0000');
  });

  it('dispatches a real 401 error through handleError to exit code 2', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_key' }),
    } as unknown as Response);

    let stderr = '';
    const code = await run(
      ['balance'],
      { PHANTOM_API_KEY: 'bad-key', PHANTOM_BASE_URL: 'https://test.local' },
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(2);
    expect(JSON.parse(stderr)).toEqual({
      error: { status: 401, code: 'invalid_key', message: 'invalid_key' },
    });
  });

  it('dispatches a real 402 error through handleError to exit code 1', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({
        error: {
          code: 'insufficient_balance',
          message: 'The calling key cannot cover that amount, or is inactive.',
        },
      }),
    } as unknown as Response);

    let stderr = '';
    const code = await run(
      ['child', '--amount', '500'],
      { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' },
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(JSON.parse(stderr)).toEqual({
      error: {
        status: 402,
        code: 'insufficient_balance',
        message: 'The calling key cannot cover that amount, or is inactive.',
      },
    });
  });

  it('rejects valueless numeric flag on CLI and exits 1 before making network calls', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    let stderr = '';
    const code = await run(
      ['child', '--amount', '--table'],
      { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' },
      { stdout: () => {}, stderr: (s) => (stderr += s) },
    );

    expect(code).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(stderr)).toEqual({
      error: { code: 'cli_error', message: '--amount requires a number' },
    });
  });

  it('runs children end-to-end, JSON by default and a table with --table', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => CHILDREN } as unknown as Response);
    const env = { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' };

    let stdout = '';
    expect(await run(['children'], env, { stdout: (s) => (stdout += s), stderr: () => {} })).toBe(0);
    expect(JSON.parse(stdout)).toEqual(CHILDREN);

    stdout = '';
    expect(await run(['children', '--table'], env, { stdout: (s) => (stdout += s), stderr: () => {} })).toBe(0);
    expect(stdout).toContain('a1b2c3d4e5f6');
    expect(stdout).toContain('total 1 keys, spent $0.2500');
  });

  it('runs budget clear end-to-end', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        budget_usd: null,
        spent_this_period_usd: 0,
        period_started: null,
        exhausted: false,
        rate_usd_per_min: null,
        spent_this_minute_usd: 0,
        rate_exceeded: false,
      }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    let stdout = '';
    const code = await run(
      ['budget', 'clear'],
      { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' },
      { stdout: (s) => (stdout += s), stderr: () => {} },
    );

    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/key/budget', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ budget_usd: null, rate_usd_per_min: null }),
    }));
    expect(JSON.parse(stdout).budget_usd).toBeNull();
  });
});

describe('table formatters', () => {
  it('renders all table formatters without throwing', () => {
    expect(
      tableBalance({
        active: true,
        kind: 'credit',
        credit_balance_usd: 10,
        credit_spent_usd: 2,
        expires_at: '2027-01-01T00:00:00.000Z',
      }),
    ).toContain('balance         $10.0000');

    expect(
      tableBudget({
        budget_usd: null,
        spent_this_period_usd: 0,
        period_started: null,
        exhausted: false,
        rate_usd_per_min: null,
        spent_this_minute_usd: 0,
        rate_exceeded: false,
      }),
    ).toContain('budget          uncapped');

    expect(
      tableChild({
        api_key: 'sk-child',
        limit_usd: 5,
        expires_at: '2027-01-01',
        rate_usd_per_min: 1,
        parent_balance_usd: 20,
      }),
    ).toContain('api_key         sk-child');

    expect(
      tableRotate({
        api_key: 'sk-new',
        rotated_at: '2026-09-21',
      }),
    ).toContain('api_key         sk-new');

    expect(
      tableBurn({
        revoked: true,
        forfeited_usd: 2.5,
      }),
    ).toContain('forfeited       $2.5000');

    expect(tableChildren(CHILDREN)).toContain('a1b2c3d4e5f6  true    $0.5000  $0.2500  $0.2500  $0.1000/min');
  });
});

describe('MCP server', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function connect(env: Record<string, string | undefined>) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(env).connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    return client;
  }

  it('lists its tools', async () => {
    const client = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'auto_top_up',
      'buy_credit',
      'check_payment',
      'create_child_key',
      'delete_key',
      'forget',
      'get_balance',
      'get_budget',
      'get_route',
      'list_children',
      'list_memories',
      'list_saved_keys',
      'list_wallets',
      'mail_draft',
      'mail_list',
      'mail_read',
      'mail_send',
      'pay_for_credit',
      'plan_status',
      'recall',
      'remember',
      'set_budget',
      'set_plan',
      'set_route',
      'test_route',
      'verify_model',
      'verify_receipt',
      'wallet_status',
    ]);
    expect(tools.find((t) => t.name === 'delete_key')?.annotations?.destructiveHint).toBe(true);
    expect(client.getServerVersion()).toEqual({ name: 'pai', version: VERSION });
    await client.close();
  });

  it('calls the same endpoint the CLI does, with the key from env', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => CHILDREN } as unknown as Response);
    globalThis.fetch = fetchMock;
    const client = await connect({ PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' });

    const res = await client.callTool({ name: 'list_children', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual(CHILDREN);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://test.local/key/children',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }) }),
    );
    await client.close();
  });

  it('deletes the key it is given, never the configured one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ revoked: true, forfeited_usd: 0.2 }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;
    const client = await connect({ PHANTOM_API_KEY: 'sk-phantom-parent', PHANTOM_BASE_URL: 'https://test.local' });

    await client.callTool({ name: 'delete_key', arguments: { api_key: 'sk-phantom-child' } });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://test.local/key',
      expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ Authorization: 'Bearer sk-phantom-child' }) }),
    );
    await client.close();
  });

  it('reports a missing key and a refused request as tool errors', async () => {
    const noKey = await connect({ PHANTOM_STATE_DIR: mkdtempSync(path.join(tmpdir(), 'phantom-nokey-')) });
    const missing = await noKey.callTool({ name: 'get_balance', arguments: {} });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain('No API key');
    await noKey.close();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ error: { code: 'insufficient_balance', message: 'Not enough credit.' } }),
    } as unknown as Response);
    const client = await connect({ PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' });
    const refused = await client.callTool({ name: 'create_child_key', arguments: { limit_usd: 100 } });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('402 insufficient_balance');
    await client.close();
  });

  it('starts over stdio from `pai mcp`', async () => {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [path.resolve(__dirname, '../src/pai.mts'), 'mcp'],
      env: { PATH: process.env.PATH ?? '' },
    });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(28);
    await client.close();
  }, 15_000);
});

describe('process execution', () => {
  const cliDir = path.resolve(__dirname, '..');
  const scriptPath = path.join(cliDir, 'src', 'pai.mts');

  it('executes the CLI entry point directly with --help without syntax errors', () => {
    const stdout = execFileSync('node', ['--experimental-strip-types', scriptPath, '--help'], {
      encoding: 'utf8',
    });
    expect(stdout).toContain('pai — keys, money and subagents for AI agents (Phantom AI)');
  });

  it('runs built, through the extensionless symlink npm installs', () => {
    // Two things the published package gets wrong if nobody checks. Node
    // refuses to strip types anywhere under node_modules, so the bin cannot be
    // the .mts; and npm links the bin as `phantom-key` with no extension,
    // which Node would not read as TypeScript anyway. Hence a compiled dist
    // and a plain-JS bin. Build first, because dist is not in the tree.
    execFileSync('npx', ['tsc', '-p', cliDir], { encoding: 'utf8' });

    const dir = mkdtempSync(path.join(tmpdir(), 'phantom-key-bin-'));
    const link = path.join(dir, 'pai');
    try {
      symlinkSync(path.join(cliDir, 'bin.mjs'), link);
      const stdout = execFileSync('node', [link, '--help'], { encoding: 'utf8' });
      expect(stdout).toContain('pai — keys, money and subagents for AI agents (Phantom AI)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // Compiling pulls in the MCP SDK's types, which takes seconds under a
    // parallel run.
  }, 30_000);

  it('declares the bin entry and the build that produces it', () => {
    const manifest = JSON.parse(readFileSync(path.join(cliDir, 'package.json'), 'utf8'));
    expect(manifest.name).toBe('@connortessaro/pai');
    // Two bins, one entry point: `pai`, which is also what `npx -y
    // @connortessaro/pai` runs (npx picks the bin named like the package,
    // scope dropped), and `phantom-key` for anyone who installed the first name.
    // No './' prefix: npm's publish-time normaliser rejects it and drops the
    // entry, which would publish a CLI with no executable at all.
    expect(manifest.bin['pai']).toBe('bin.mjs');
    expect(manifest.bin.phai).toBeUndefined();
    expect(manifest.bin['phantom-key']).toBe('bin.mjs');
    // Without both of these npm publishes a package whose entry point is
    // missing, or one whose dist was never built. `prepare` rather than
    // `prepack` so `npx github:connortessaro/pai` builds on install too.
    expect(manifest.files).toEqual(expect.arrayContaining(['bin.mjs', 'dist']));
    expect(manifest.scripts.prepare).toBe('npm run build');
  });
});

const PURCHASE = {
  payment_id: 'pay_123',
  coin: 'usdt',
  recipient: 'SoLAddr111',
  amount: '5',
  amount_base_units: '5000000',
  mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  reference: 'Ref111',
  expires_at: '2026-09-24T00:00:00.000Z',
  recovery_code: 'rc-1',
  solana_pay_url: 'solana:SoLAddr111?amount=5',
};

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe('buying credit', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('requestSolanaPayment asks for a payment that lands on the calling key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(PURCHASE));
    globalThis.fetch = fetchMock;
    expect(await requestSolanaPayment('sk-phantom-a', { amount_usd: 5, coin: 'usdt' }, 'https://test.local')).toEqual(PURCHASE);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test.local/purchase/solana');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ amount_usd: 5, coin: 'usdt', target_api_key: 'sk-phantom-a' });
  });

  it('parseBuyCoin takes usdc, usdt and sol, and the older spellings', () => {
    expect(parseBuyCoin('USDC')).toBe('usdc');
    expect(parseBuyCoin('usdtsol')).toBe('usdt');
    expect(parseBuyCoin('sol')).toBe('sol');
    expect(parseBuyCoin('btc')).toBeNull();
  });

  it('surfaces the purchase routes { detail } errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'coin must be usdc, usdt or sol.' }),
    } as unknown as Response);
    await expect(requestSolanaPayment('sk-a', { amount_usd: 1, coin: 'usdc' }, 'https://test.local')).rejects.toMatchObject({
      status: 400,
      message: 'coin must be usdc, usdt or sol.',
    });
  });

  it('getPaymentStatus sends the recovery code as a header, never in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ status: 'waiting', topped_up: false, credit_usd: 4.76, expires_at: 'x' }));
    globalThis.fetch = fetchMock;
    await getPaymentStatus('sk-a', 'pay_123', 'https://test.local', 'rc-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test.local/purchase/pay_123/status');
    expect(init.headers['x-phantom-recovery-code']).toBe('rc-1');
  });

  it('waitForPayment polls until the credit lands and reports each new status once', async () => {
    const statuses = ['waiting', 'waiting', 'confirming', 'completed'];
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      const status = statuses.shift()!;
      return okJson({ status, topped_up: status === 'completed', credit_usd: 4.76, expires_at: 'x' });
    });
    const seen: string[] = [];
    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await waitForPayment('sk-a', 'pay_123', { baseUrl: 'https://test.local', onStatus: (s) => seen.push(s), sleep });
    expect(result.topped_up).toBe(true);
    expect(seen).toEqual(['waiting', 'confirming', 'completed']);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('waitForPayment stops with an error when the payment expires', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson({ status: 'expired', topped_up: false, credit_usd: 4.76, expires_at: 'x' }));
    await expect(
      waitForPayment('sk-a', 'pay_123', { baseUrl: 'https://test.local', sleep: async () => {} }),
    ).rejects.toMatchObject({ code: 'payment_expired' });
  });

  it('run buy prints the payment as JSON, and --table shows what to send', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okJson(PURCHASE));
    const env = { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' };
    let stdout = '';
    expect(await run(['buy', '--amount', '5', '--coin', 'usdt'], env, { stdout: (s) => (stdout += s), stderr: () => {} })).toBe(0);
    expect(JSON.parse(stdout)).toEqual(PURCHASE);
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('https://test.local/purchase/solana');
    expect(tableSolanaPayment(PURCHASE)).toContain('send            5 USDT');
    expect(tableSolanaPayment(PURCHASE)).toContain('reference       Ref111');
  });

  it('run buy refuses a coin Phantom AI does not take, before any call', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    let stderr = '';
    const env = { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' };
    expect(await run(['buy', '--amount', '5', '--coin', 'btc'], env, { stdout: () => {}, stderr: (s) => (stderr += s) })).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderr).toContain('--coin must be usdc, usdt or sol');
  });

  it('run buy --wait puts the address on stderr and one JSON result on stdout', async () => {
    let n = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/purchase/solana')) return okJson(PURCHASE);
      n += 1;
      return okJson({ status: n > 1 ? 'completed' : 'waiting', topped_up: n > 1, credit_usd: 4.76, expires_at: 'x' });
    });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const env = { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' };
    let stdout = '';
    let stderr = '';
    const pending = run(['buy', '--amount', '5', '--wait'], env, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
    await vi.runAllTimersAsync();
    expect(await pending).toBe(0);
    vi.useRealTimers();
    expect(stderr).toContain('to              SoLAddr111');
    expect(stderr).toContain('status: waiting');
    expect(JSON.parse(stdout)).toMatchObject({ payment_id: 'pay_123', status: 'completed', topped_up: true });
  });

  it('run buy requires --amount and makes no call without it', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    let stderr = '';
    const code = await run(['buy'], { PHANTOM_API_KEY: 'sk-test' }, { stdout: () => {}, stderr: (s) => (stderr += s) });
    expect(code).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderr).toContain('buy requires --amount <usd>');
  });
});

describe('agent wallet', () => {
  const originalFetch = globalThis.fetch;
  let stateDir = '';
  const PAYEE = '7vCZgHfqu7jnitjExGnKTsfNJfyGsfxqnT7mFyQxVSFf';
  const REFERENCE = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const solanaRequest = (coin: 'usdc' | 'sol') => ({
    payment_id: 'pay_1',
    coin,
    recipient: PAYEE,
    amount: coin === 'sol' ? '0.01727227' : '2.000000',
    amount_base_units: coin === 'sol' ? '17272270' : '2000000',
    mint: coin === 'sol' ? null : USDC,
    reference: REFERENCE,
    expires_at: '2026-09-23T17:00:00.000Z',
    recovery_code: 'rc',
    solana_pay_url: `solana:${PAYEE}?amount=2&reference=${REFERENCE}`,
  });

  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), 'phantom-wallet-'));
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    rmSync(stateDir, { recursive: true, force: true });
  });

  const env = () => ({
    PHANTOM_BASE_URL: 'https://test.local',
    PHANTOM_STATE_DIR: stateDir,
    PHANTOM_WALLET_MAX_USD: '10',
    PHANTOM_SOLANA_RPC: 'https://rpc.test',
  });

  /** Routes Phantom AI API calls and Solana JSON-RPC calls to canned answers. */
  function stubNetwork(
    opts: {
      balance?: number;
      statuses?: string[];
      lamports?: number;
      usdc?: string;
      coin?: string;
      request?: Record<string, unknown>;
      solUsd?: string | null;
    } = {},
  ) {
    const statuses = [...(opts.statuses ?? ['completed'])];
    const sent: string[] = [];
    const solanaBodies: Record<string, unknown>[] = [];
    const rpc = (id: unknown, result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://test.local/purchase/solana') {
        solanaBodies.push(JSON.parse(String(init?.body ?? '{}')));
        return okJson({ ...solanaRequest(opts.coin === 'sol' ? 'sol' : 'usdc'), ...opts.request });
      }
      if (url === 'https://api.coinbase.com/v2/prices/SOL-USD/spot') {
        if (opts.solUsd === null) return new Response('down', { status: 503 });
        return okJson({ data: { amount: opts.solUsd ?? '115.79' } });
      }
      if (url.startsWith('https://test.local/purchase/')) {
        const status = statuses.shift() ?? 'completed';
        if (status === 'http502') return new Response(JSON.stringify({ error: 'bad gateway' }), { status: 502 });
        return okJson({ status, topped_up: status === 'completed', credit_usd: 1.9, expires_at: 'x' });
      }
      if (url === 'https://test.local/key/balance') {
        return okJson({ active: true, kind: 'credit', credit_balance_usd: opts.balance ?? 0.1, credit_spent_usd: 0, expires_at: 'x' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const ctx = { slot: 1 };
      switch (body.method) {
        case 'getBalance':
          return rpc(body.id, { context: ctx, value: opts.lamports ?? 50_000_000 });
        case 'getTokenAccountBalance':
          return rpc(body.id, { context: ctx, value: { amount: opts.usdc ?? '5000000', decimals: 6, uiAmountString: '5' } });
        case 'getLatestBlockhash':
          return rpc(body.id, { context: ctx, value: { blockhash: 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N', lastValidBlockHeight: 100 } });
        case 'sendTransaction':
          sent.push(body.params[0]);
          return rpc(body.id, 'sig');
        case 'getSignatureStatuses':
          return rpc(body.id, { context: ctx, value: [{ confirmationStatus: 'confirmed', err: null, slot: 1, confirmations: 1 }] });
      }
      throw new Error(`unexpected fetch ${url} ${body.method ?? ''}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return { fetchMock, sent, solanaBodies };
  }

  const keyBytes = (a: string) => Buffer.from(new Uint8Array(getBase58Encoder().encode(a)));
  const payeeBytes = () => keyBytes(PAYEE);
  const u64 = (n: number) => Buffer.from(new BigUint64Array([BigInt(n)]).buffer);

  it('toBaseUnits rounds up so a payment is never short', () => {
    expect(toBaseUnits('0.01727227', 9)).toBe(BigInt(17272270));
    expect(toBaseUnits(2.00323879, 6)).toBe(BigInt(2003239));
    expect(toBaseUnits('5', 6)).toBe(BigInt(5000000));
    expect(toBaseUnits(1e-7, 9)).toBe(BigInt(100));
  });

  it('wallet create writes a keypair readable only by this user, and never overwrites it', async () => {
    const { fetchMock } = stubNetwork();
    void fetchMock;
    const first = await createWallet(env());
    expect(first.created).toBe(true);
    expect(statSync(first.file!).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(first.file!, 'utf-8'))).toHaveLength(64);
    const again = await createWallet(env());
    expect(again).toMatchObject({ created: false, address: first.address });
  });

  it('refuses to pay without an owner-set cap, or over it, before any network call', async () => {
    const { fetchMock } = stubNetwork();
    await createWallet({ ...env(), PHANTOM_SOLANA_RPC: 'https://rpc.test' });
    fetchMock.mockClear();
    const { PHANTOM_WALLET_MAX_USD, ...noCap } = env();
    void PHANTOM_WALLET_MAX_USD;
    await expect(buyAndPay('sk-a', noCap, { amount_usd: 2, coin: 'usdcsol', sleep: async () => {} })).rejects.toMatchObject({ code: 'wallet_cap_missing' });
    await expect(buyAndPay('sk-a', env(), { amount_usd: 11, coin: 'usdcsol', sleep: async () => {} })).rejects.toMatchObject({ code: 'wallet_cap_exceeded' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pays the USDC account of the recipient Phantom AI named, with the reference, then waits for the credit', async () => {
    const { sent, solanaBodies } = stubNetwork({ statuses: ['waiting', 'completed'] });
    await createWallet(env());
    const result = await buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdcsol', sleep: async () => {} });
    expect(result).toMatchObject({ payment_id: 'pay_1', topped_up: true });
    expect(solanaBodies).toEqual([{ amount_usd: 2, coin: 'usdc', target_api_key: 'sk-a' }]);
    expect(sent).toHaveLength(1);
    const tx = Buffer.from(sent[0], 'base64');
    const recipientAta = await associatedTokenAddress(address(PAYEE), address(USDC));
    expect(tx.includes(keyBytes(recipientAta))).toBe(true);
    expect(tx.includes(keyBytes(REFERENCE))).toBe(true);
    // TransferChecked of exactly amount_base_units.
    expect(tx.includes(Buffer.concat([Buffer.from([12]), u64(2000000), Buffer.from([6])]))).toBe(true);
  });

  it('pays in SOL with a system transfer of the exact lamports', async () => {
    const { sent } = stubNetwork({ coin: 'sol' });
    await createWallet(env());
    await buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'sol', sleep: async () => {} });
    const tx = Buffer.from(sent[0], 'base64');
    expect(tx.includes(Buffer.concat([Buffer.from([2, 0, 0, 0]), u64(17272270)]))).toBe(true);
    expect(tx.includes(payeeBytes())).toBe(true);
    expect(tx.includes(keyBytes(REFERENCE))).toBe(true);
  });

  it('stops before creating a payment when the wallet cannot cover it', async () => {
    const { sent, fetchMock } = stubNetwork({ usdc: '1000000' });
    await createWallet(env());
    await expect(buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdcsol', sleep: async () => {} })).rejects.toMatchObject({ code: 'wallet_insufficient' });
    expect(sent).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url]) => url === 'https://test.local/purchase/solana')).toBe(false);
  });

  it('waits for a payment already in flight instead of paying twice', async () => {
    const { sent } = stubNetwork({ statuses: ['waiting', 'waiting', 'completed'] });
    await createWallet(env());
    let second: Promise<unknown> | null = null;
    await buyAndPay('sk-a', env(), {
      amount_usd: 2,
      coin: 'usdcsol',
      sleep: async () => {
        if (!second) second = buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdcsol', sleep: async () => {} });
      },
    });
    await expect(second).resolves.toMatchObject({ resumed: true });
    expect(sent).toHaveLength(1);
  });

  it('autoTopup does nothing while the balance is above the threshold', async () => {
    const { sent } = stubNetwork({ balance: 5 });
    await createWallet(env());
    const result = await autoTopup('sk-a', env(), { below_usd: 1, amount_usd: 2, coin: 'usdcsol' });
    expect(result).toEqual({ balance_usd: 5, below_usd: 1, bought: false });
    expect(sent).toHaveLength(0);
  });

  it('autoTopup buys and pays when the balance is under the threshold', async () => {
    const { sent } = stubNetwork({ balance: 0.1 });
    await createWallet(env());
    const result = await autoTopup('sk-a', env(), { below_usd: 1, amount_usd: 2, coin: 'usdcsol', sleep: async () => {} });
    expect(result.bought).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('keeps several named wallets, and pays from the one asked for', async () => {
    const { sent } = stubNetwork();
    const main = await createWallet(env());
    const work = await createWallet(env(), 'work');
    expect(main.default).toBe(true);
    expect(work.default).toBe(false);
    const { wallets } = await listWallets(env());
    expect(wallets.map((w) => [w.name, w.default])).toEqual([['main', true], ['work', false]]);

    const result = await buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdcsol', wallet: 'work', sleep: async () => {} });
    expect(result.wallet).toBe('work');
    const workKey = Buffer.from(new Uint8Array(getBase58Encoder().encode(work.address)));
    expect(Buffer.from(sent[0], 'base64').includes(workKey)).toBe(true);
    expect(result).toMatchObject({ balance_before_usd: 0.1, balance_after_usd: 0.1 });
  });

  it('pays from the default wallet, and says which names exist when there is no default', async () => {
    stubNetwork();
    await createWallet(env());
    await createWallet(env(), 'work');
    expect(resolveWalletName(env())).toBe('main');
    useWallet(env(), 'work');
    expect(resolveWalletName(env())).toBe('work');
    rmSync(path.join(stateDir, 'wallets', '.default'));
    expect(() => resolveWalletName(env())).toThrow('Several wallets are saved. Pick one with --wallet <name>: main, work');
    expect(() => resolveWalletName(env(), 'nope')).toThrow('No saved wallet named nope');
  });

  it('reports each step: payment request, send, Solana confirmation, credit', async () => {
    stubNetwork({ statuses: ['waiting', 'confirming', 'completed'] });
    await createWallet(env());
    const steps: string[] = [];
    await buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdcsol', onStatus: (s) => steps.push(s), sleep: async () => {} });
    expect(steps).toEqual([
      'Getting a payment request from Phantom AI',
      'Sending 2.000000 USDC from main to 7vCZ…VSFf',
      'Confirming on Solana',
      'Waiting for Phantom AI to see the payment',
      'Phantom AI is confirming the payment',
      'Credit added',
    ]);
  });

  it('progress prints one plain line per step outside a terminal', () => {
    let err = '';
    const p = progress({ stderr: (s) => (err += s), isTTY: false });
    p.step('Getting a payment request from Phantom AI');
    p.step('Getting a payment request from Phantom AI');
    p.step(paymentStage('confirming'));
    p.end('Credit $0.10 -> $2.00');
    expect(err).toBe('... Getting a payment request from Phantom AI\n... Phantom AI is confirming the payment\nCredit $0.10 -> $2.00\n');
  });

  it('keeps the pending record when a send is unconfirmed, so the next run waits instead of paying again', async () => {
    const { sent, fetchMock } = stubNetwork({ statuses: ['completed'] });
    await createWallet(env());
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.method === 'getSignatureStatuses') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { context: { slot: 1 }, value: [null] } }));
      }
      return base(url, init);
    });
    await expect(buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdc', sleep: async () => {} })).rejects.toMatchObject({ code: 'wallet_tx_unconfirmed' });
    fetchMock.mockImplementation(base);
    const again = await buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdc', sleep: async () => {} });
    expect(again).toMatchObject({ resumed: true, payment_id: 'pay_1' });
    expect(sent).toHaveLength(1);
  });

  it('keeps the pending record when a status check fails after the send, so the next run does not pay again', async () => {
    const { sent } = stubNetwork({ statuses: ['http502', 'completed'] });
    await createWallet(env());
    await expect(buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdc', sleep: async () => {} })).rejects.toThrow();
    const again = await buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdc', sleep: async () => {} });
    expect(again).toMatchObject({ resumed: true, payment_id: 'pay_1', topped_up: true });
    expect(sent).toHaveLength(1);
  });

  it('keeps the pending record past a timeout, and clears it once the payment is reported dead', async () => {
    const { sent } = stubNetwork({ statuses: ['expired', 'completed'] });
    await createWallet(env());
    await expect(buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdc', sleep: async () => {} })).rejects.toMatchObject({ code: 'payment_expired' });
    // Dead, so the next run pays afresh.
    const next = await buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'usdc', sleep: async () => {} });
    expect(next.resumed).toBeUndefined();
    expect(sent).toHaveLength(2);
  });

  it('caps the total over 24 hours, one payment by default', async () => {
    const { sent } = stubNetwork({ usdc: '50000000' });
    await createWallet(env());
    await buyAndPay('sk-a', env(), { amount_usd: 6, coin: 'usdc', sleep: async () => {} });
    await expect(buyAndPay('sk-a', env(), { amount_usd: 6, coin: 'usdc', sleep: async () => {} })).rejects.toMatchObject({
      code: 'wallet_daily_cap_exceeded',
    });
    expect(sent).toHaveLength(1);
    await buyAndPay('sk-a', { ...env(), PHANTOM_WALLET_MAX_USD_PER_DAY: '12' }, { amount_usd: 6, coin: 'usdc', sleep: async () => {} });
    expect(sent).toHaveLength(2);
    expect(walletSpentToday(env())).toBe(12);
  });

  it('pays once when two runs start together', async () => {
    const { sent } = stubNetwork();
    await createWallet(env());
    const runs = await Promise.allSettled([
      buyAndPay('sk-a', { ...env(), PHANTOM_WALLET_MAX_USD_PER_DAY: '100' }, { amount_usd: 2, coin: 'usdc', sleep: async () => {} }),
      buyAndPay('sk-a', { ...env(), PHANTOM_WALLET_MAX_USD_PER_DAY: '100' }, { amount_usd: 2, coin: 'usdc', sleep: async () => {} }),
    ]);
    expect(sent).toHaveLength(1);
    expect(runs.map((r) => (r.status === 'rejected' ? (r.reason as { code: string }).code : 'ok')).sort()).toEqual(['ok', 'wallet_busy']);
  });

  it.each([
    ['more USDC than asked for', 'usdc', { amount_base_units: '2000001' }],
    ['another token', 'usdc', { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' }],
    ['another coin', 'usdc', { coin: 'sol' }],
    ['far more SOL than the price allows', 'sol', { amount_base_units: '30000000' }],
  ])('refuses a payment request for %s, before sending', async (_what, coin, request) => {
    const { sent } = stubNetwork({ coin, request });
    await createWallet(env());
    await expect(buyAndPay('sk-a', env(), { amount_usd: 2, coin: coin as 'usdc' | 'sol', sleep: async () => {} })).rejects.toMatchObject({
      code: 'wallet_request_mismatch',
    });
    expect(sent).toHaveLength(0);
    expect(walletSpentToday(env())).toBe(0);
  });

  it('refuses to pay in SOL when it cannot check the price', async () => {
    const { sent } = stubNetwork({ coin: 'sol', solUsd: null });
    await createWallet(env());
    await expect(buyAndPay('sk-a', env(), { amount_usd: 2, coin: 'sol', sleep: async () => {} })).rejects.toMatchObject({
      code: 'wallet_price_unavailable',
    });
    expect(sent).toHaveLength(0);
  });

  it('run buy --coin usdc without --pay prints a Solana Pay link a phone wallet can open', async () => {
    stubNetwork();
    let stdout = '';
    const code = await run(['buy', '--amount', '2', '--coin', 'usdc', '--table'], { ...env(), PHANTOM_API_KEY: 'sk-test' }, {
      stdout: (s) => (stdout += s),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(stdout).toContain(`to              ${PAYEE}`);
    expect(stdout).toContain(`reference       ${REFERENCE}`);
    expect(stdout).toContain(`pay link        solana:${PAYEE}?amount=2&reference=${REFERENCE}`);
  });
});

describe('verifying receipts', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const KEY_RESPONSE = { signs: true, public_key_jwk: publicKey.export({ format: 'jwk' }) };

  function signed(fields: Record<string, unknown>) {
    const payload = JSON.stringify({
      v: 1,
      request_id: 'req_1',
      ts: '2026-09-23T00:00:00.000Z',
      model_requested: 'deepseek/deepseek-v3.2',
      model_served: 'deepseek/deepseek-v3.2',
      prompt_tokens: 12,
      completion_tokens: 2,
      reasoning_tokens: 0,
      cost_micro_usd: 42,
      ...fields,
    });
    const sig = sign(null, Buffer.from(payload), privateKey);
    return `${Buffer.from(payload).toString('base64url')}.${sig.toString('base64url')}`;
  }

  // /receipts/key answers the public key; /chat/completions answers `receipt`.
  function stubApi(receipt: string | null) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/receipts/key')) return { ok: true, json: async () => KEY_RESPONSE };
      return {
        ok: true,
        headers: new Headers(receipt ? { 'x-phantom-receipt': receipt } : {}),
        json: async () => ({ choices: [] }),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('accepts a receipt signed by the published key', async () => {
    stubApi(null);
    const result = await checkReceipt(signed({}), 'https://test.local');
    expect(result.valid).toBe(true);
    expect(result.receipt?.model_served).toBe('deepseek/deepseek-v3.2');
  });

  it('rejects a receipt whose payload was edited after signing', async () => {
    stubApi(null);
    const [, sig] = signed({}).split('.');
    const forged = Buffer.from(JSON.stringify({ v: 1, model_served: 'openai/gpt-5' })).toString('base64url');
    const result = await checkReceipt(`${forged}.${sig}`, 'https://test.local');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Signature');
  });

  it('rejects something that is not a receipt', async () => {
    stubApi(null);
    expect((await checkReceipt('garbage', 'https://test.local')).valid).toBe(false);
  });

  it('verify_model makes one small call and reports a match', async () => {
    const fetchMock = stubApi(signed({}));
    const result = await verifyModel('sk-test', 'deepseek/deepseek-v3.2', 'https://test.local');
    expect(result).toMatchObject({ match: true, signature_valid: true, model_served: 'deepseek/deepseek-v3.2', cost_usd: 0.000042 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'deepseek/deepseek-v3.2', max_tokens: 16 });
  });

  it('verify_model reports a different served model as no match', async () => {
    stubApi(signed({ model_served: 'deepseek/deepseek-v3.1' }));
    const result = await verifyModel('sk-test', 'deepseek/deepseek-v3.2', 'https://test.local');
    expect(result).toMatchObject({ match: false, signature_valid: true, model_served: 'deepseek/deepseek-v3.1' });
  });

  it('verify_model says so when no receipt comes back', async () => {
    stubApi(null);
    const result = await verifyModel('sk-test', 'deepseek/deepseek-v3.2', 'https://test.local');
    expect(result).toMatchObject({ match: false, signature_valid: false, reason: 'The response carried no receipt' });
  });

  it('treats a served id without its provider prefix as the same model', () => {
    expect(modelsMatch('deepseek/deepseek-v3.2', 'deepseek-v3.2')).toBe(true);
    expect(modelsMatch('deepseek/deepseek-v3.2', 'deepseek/deepseek-v3.1')).toBe(false);
  });

  it('`verify --receipt` needs no API key and exits 1 on a bad signature', async () => {
    stubApi(null);
    const stdout: string[] = [];
    const io = { stdout: (s: string) => stdout.push(s), stderr: () => {} };
    const env = { PHANTOM_BASE_URL: 'https://test.local' };
    expect(await run(['verify', '--receipt', signed({})], env, io)).toBe(0);
    expect(await run(['verify', '--receipt', 'x.y'], env, io)).toBe(1);
  });
});

describe('saved key and agent setup', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const io = () => {
    const o = { out: '', err: '' };
    return { o, io: { stdout: (s: string) => (o.out += s), stderr: (s: string) => (o.err += s) } };
  };

  it('login checks the key, saves it mode 600, and later commands use it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'phantom-login-'));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ active: true, credit_balance_usd: 1, credit_spent_usd: 0, expires_at: 'x' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = { PHANTOM_STATE_DIR: dir, PHANTOM_BASE_URL: 'https://test.local' };
    const { o, io: sink } = io();
    expect(await run(['login', 'sk-phantom-saved'], env, sink)).toBe(0);
    expect(o.out).not.toContain('sk-phantom-saved');
    expect(statSync(path.join(dir, 'key')).mode & 0o777).toBe(0o600);
    expect(resolveApiKey(env)).toBe('sk-phantom-saved');
    expect(resolveApiKey({ ...env, PHANTOM_API_KEY: 'sk-phantom-env' })).toBe('sk-phantom-env');

    await run(['balance'], env, io().io);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://test.local/key/balance',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-phantom-saved' }) }),
    );

    expect(await run(['logout'], env, io().io)).toBe(0);
    expect(resolveApiKey(env)).toBe('');
  });

  it('login refuses something that is not a key, and a key the API rejects', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'phantom-login-'));
    const env = { PHANTOM_STATE_DIR: dir, PHANTOM_BASE_URL: 'https://test.local' };
    expect(await run(['login', 'hello'], env, io().io)).toBe(1);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'invalid_key' }) }) as unknown as typeof fetch;
    expect(await run(['login', 'sk-phantom-bad'], env, io().io)).toBe(2);
    expect(existsSync(path.join(dir, 'key'))).toBe(false);
  });

  it('setup installs the skill for each agent it finds, and adds MCP only with --mcp', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'phantom-home-'));
    mkdirSync(path.join(home, '.pi'));
    mkdirSync(path.join(home, '.claude'));
    const exec = vi.fn();
    const r = setupAgents({ HOME: home }, { exec });
    expect(r.agents.map((a) => a.agent)).toEqual(['pi', 'claude']);
    expect(readFileSync(path.join(home, '.agents/skills/phantom-ai/SKILL.md'), 'utf-8')).toContain('name: phantom-ai');
    expect(existsSync(path.join(home, '.claude/skills/phantom-ai/SKILL.md'))).toBe(true);
    expect(exec).not.toHaveBeenCalled();
    expect(r.agents.find((a) => a.agent === 'claude')?.mcp).toContain('claude mcp add phantom');

    setupAgents({ HOME: home }, { agent: 'claude', mcp: true, exec });
    expect(exec).toHaveBeenCalledWith('claude', ['mcp', 'add', 'phantom', '--', 'npx', '-y', '@connortessaro/pai', 'mcp']);
  });

  it('setup --mcp for cursor merges into mcp.json without dropping other servers', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'phantom-home-'));
    mkdirSync(path.join(home, '.cursor'));
    writeFileSync(path.join(home, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    setupAgents({ HOME: home }, { agent: 'cursor', mcp: true });
    const config = JSON.parse(readFileSync(path.join(home, '.cursor/mcp.json'), 'utf-8'));
    expect(Object.keys(config.mcpServers).sort()).toEqual(['other', 'phantom']);
  });

  it('setup --provider points Claude Code at Phantom, keeps other settings, and undoes cleanly', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'phantom-home-'));
    const state = mkdtempSync(path.join(tmpdir(), 'phantom-state-'));
    mkdirSync(path.join(home, '.claude'));
    const file = path.join(home, '.claude/settings.json');
    writeFileSync(file, JSON.stringify({ model: 'opus', env: { FOO: '1' } }));
    const env = { HOME: home, PHANTOM_STATE_DIR: state, PHANTOM_API_KEY: 'sk-phantom-abc', ANTHROPIC_API_KEY: 'sk-ant-x' };

    const r = setupAgents(env, { agent: 'claude', provider: true, model: 'auto', onPath: () => true });
    const on = JSON.parse(readFileSync(file, 'utf-8'));
    expect(on).toEqual({
      model: 'opus',
      apiKeyHelper: 'pai key show',
      env: { FOO: '1', ANTHROPIC_BASE_URL: 'https://phantom.codes', ENABLE_TOOL_SEARCH: 'true', ANTHROPIC_MODEL: 'auto' },
    });
    // The key itself is never written into Claude's settings.
    expect(readFileSync(file, 'utf-8')).not.toContain('sk-phantom');
    expect(r.agents[0].provider?.warnings[0]).toContain('ANTHROPIC_API_KEY');

    setupAgents(env, { agent: 'claude', provider: 'off' });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ model: 'opus', env: { FOO: '1' } });
  });

  it('setup --provider runs this pai by absolute path when pai is not installed, and follows PHANTOM_BASE_URL', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'phantom-home-'));
    mkdirSync(path.join(home, '.claude'));
    setupAgents(
      { HOME: home, PHANTOM_API_KEY: 'sk-phantom-abc', PHANTOM_BASE_URL: 'https://localhost:3000/v1' },
      { agent: 'claude', provider: true, onPath: () => false },
    );
    const on = JSON.parse(readFileSync(path.join(home, '.claude/settings.json'), 'utf-8'));
    expect(on.apiKeyHelper).toBe(`${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve(process.argv[1]))} key show`);
    expect(on.env.ANTHROPIC_BASE_URL).toBe('https://localhost:3000');
  });

  it('setup --provider refuses an http PHANTOM_BASE_URL, even on localhost, and writes nothing', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'phantom-home-'));
    mkdirSync(path.join(home, '.claude'));
    expect(() =>
      setupAgents(
        { HOME: home, PHANTOM_API_KEY: 'sk-phantom-abc', PHANTOM_BASE_URL: 'http://localhost:3000/v1' },
        { agent: 'claude', provider: true, onPath: () => false },
      ),
    ).toThrow(/must start with https:\/\//);
    expect(existsSync(path.join(home, '.claude/settings.json'))).toBe(false);
  });

  it('setup --provider refuses without a key, a broken settings file, or another agent', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'phantom-home-'));
    const state = mkdtempSync(path.join(tmpdir(), 'phantom-state-'));
    mkdirSync(path.join(home, '.claude'));
    mkdirSync(path.join(home, '.pi'));
    expect(() => setupAgents({ HOME: home, PHANTOM_STATE_DIR: state }, { agent: 'claude', provider: true })).toThrow(/pai login/);
    writeFileSync(path.join(home, '.claude/settings.json'), '{ not json');
    expect(() => setupAgents({ HOME: home, PHANTOM_API_KEY: 'sk-phantom-abc' }, { agent: 'claude', provider: true })).toThrow(/not valid JSON/);
    expect(readFileSync(path.join(home, '.claude/settings.json'), 'utf-8')).toBe('{ not json');
    expect(() => setupAgents({ HOME: home, PHANTOM_API_KEY: 'sk-phantom-abc' }, { agent: 'pi', provider: true })).toThrow(/--agent claude/);
  });

  it('key show with no name prints the key pai is using', async () => {
    const state = mkdtempSync(path.join(tmpdir(), 'phantom-state-'));
    const o = io();
    expect(await run(['key', 'show'], { PHANTOM_STATE_DIR: state, PHANTOM_API_KEY: 'sk-phantom-abc' }, o.io)).toBe(0);
    expect(o.o.out).toBe('sk-phantom-abc\n');
  });

  it('setup with no agent installed says so', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'phantom-home-'));
    expect(() => setupAgents({ HOME: home })).toThrow(/Found no agent/);
  });
});

describe('plans and routing', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const env = { PHANTOM_API_KEY: 'sk-test', PHANTOM_BASE_URL: 'https://test.local' };
  const sink = { stdout: () => {}, stderr: () => {} };
  const POLICY = { models: ['a/big', 'b/cheap'], rules: [{ if: { pace: 'ahead' }, use: 'cheapest' }] };

  it('parses conditions into typed values', () => {
    expect(parseCondition('pace=ahead')).toEqual({ pace: 'ahead' });
    expect(parseCondition('input_tokens_over=50000')).toEqual({ input_tokens_over: 50000 });
    expect(parseCondition('has_tools=true')).toEqual({ has_tools: true });
    expect(() => parseCondition('pace')).toThrow(/name=value/);
  });

  it('plan set sends the amount and period to the budget route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ budget_usd: 20 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await run(['plan', 'set', '--amount', '20', '--days', '30'], env, sink)).toBe(0);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://test.local/key/budget');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ budget_usd: 20, period_days: 30 });
  });

  it('route rule add appends to the stored rules, and --at puts it first', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ route_policy: POLICY }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await run(['route', 'rule', 'add', '--if', 'has_tools=true', '--use', 'a/big', '--at', '1'], env, sink)).toBe(0);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://test.local/key/route');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body)).rules).toEqual([{ if: { has_tools: true }, use: 'a/big' }, ...POLICY.rules]);
  });

  it('route rule rm refuses a rule number that does not exist', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ route_policy: POLICY }) }) as unknown as typeof fetch;
    expect(await run(['route', 'rule', 'rm', '5'], env, sink)).toBe(1);
  });

  it('route set creates a policy with PUT when the key has none', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ route_policy: null }) })
      .mockResolvedValue({ ok: true, json: async () => ({ route_policy: POLICY }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await run(['route', 'set', '--models', 'a/big,b/cheap'], env, sink)).toBe(0);
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ models: ['a/big', 'b/cheap'] });
  });
});

describe('named keys', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const setup = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'phantom-keys-'));
    const env = { PHANTOM_API_KEY: 'sk-phantom-parent', PHANTOM_BASE_URL: 'https://test.local', PHANTOM_STATE_DIR: dir };
    let out = '';
    const io = { stdout: (x: string) => (out += x), stderr: () => {} };
    return { dir, env, io, output: () => out, reset: () => (out = '') };
  };
  const CHILD = { api_key: 'sk-phantom-child-1', limit_usd: 0.5, expires_at: 'x', rate_usd_per_min: null, parent_balance_usd: 1 };

  it('child --save stores the key mode 600 and never prints it', async () => {
    const t = setup();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => CHILD }) as unknown as typeof fetch;
    expect(await run(['child', '--amount', '0.5', '--save', 'researcher'], t.env, t.io)).toBe(0);
    expect(t.output()).not.toContain('sk-phantom-child-1');
    expect(JSON.parse(t.output())).toMatchObject({ saved_as: 'researcher', id: keyId('sk-phantom-child-1') });
    const file = path.join(t.dir, 'keys', 'researcher');
    expect(readFileSync(file, 'utf-8').trim()).toBe('sk-phantom-child-1');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('refuses a name already taken before any money moves', async () => {
    const t = setup();
    mkdirSync(path.join(t.dir, 'keys'), { recursive: true });
    writeFileSync(path.join(t.dir, 'keys', 'researcher'), 'sk-phantom-old\n');
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await run(['child', '--amount', '0.5', '--save', 'researcher'], t.env, t.io)).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PHANTOM_KEY_NAME runs as the saved key; key list, show and rm', async () => {
    const t = setup();
    mkdirSync(path.join(t.dir, 'keys'), { recursive: true });
    writeFileSync(path.join(t.dir, 'keys', 'coder'), 'sk-phantom-coder\n', { mode: 0o600 });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ active: true, credit_balance_usd: 1, credit_spent_usd: 0, expires_at: 'x' }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const env = { PHANTOM_BASE_URL: 'https://test.local', PHANTOM_STATE_DIR: t.dir, PHANTOM_KEY_NAME: 'coder' };
    await run(['balance'], env, t.io);
    expect(fetchMock).toHaveBeenLastCalledWith('https://test.local/key/balance', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk-phantom-coder' }) }));

    t.reset();
    await run(['key', 'list'], t.env, t.io);
    expect(JSON.parse(t.output())).toEqual({ keys: [{ name: 'coder', id: keyId('sk-phantom-coder') }] });
    t.reset();
    await run(['key', 'show', 'coder'], t.env, t.io);
    expect(t.output()).toBe('sk-phantom-coder\n');
    await run(['key', 'rm', 'coder'], t.env, t.io);
    expect(listNamedKeys(t.env).keys).toEqual([]);
  });

  it('rotate saves the new key over the saved one; burn --key-name forgets it', async () => {
    const t = setup();
    mkdirSync(path.join(t.dir, 'keys'), { recursive: true });
    writeFileSync(path.join(t.dir, 'keys', 'coder'), 'sk-phantom-coder\n', { mode: 0o600 });
    const env = { PHANTOM_BASE_URL: 'https://test.local', PHANTOM_STATE_DIR: t.dir, PHANTOM_KEY_NAME: 'coder' };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ api_key: 'sk-phantom-coder-2', rotated_at: 'now' }) }) as unknown as typeof fetch;
    await run(['rotate'], env, t.io);
    expect(t.output()).not.toContain('sk-phantom-coder-2');
    expect(readFileSync(path.join(t.dir, 'keys', 'coder'), 'utf-8').trim()).toBe('sk-phantom-coder-2');

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ revoked: true, forfeited_usd: 0.1 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await run(['burn', '--key-name', 'coder'], t.env, t.io)).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/key', expect.objectContaining({ method: 'DELETE', headers: expect.objectContaining({ Authorization: 'Bearer sk-phantom-coder-2' }) }));
    expect(existsSync(path.join(t.dir, 'keys', 'coder'))).toBe(false);
  });

  it('child sends limit_usd from --limit, --limit none, or the --amount alias', async () => {
    const t = setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => CHILD });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const body = (i: number) => JSON.parse(String((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].body));
    await run(['child', '--limit', '0.5', '--ttl', '6'], t.env, t.io);
    expect(body(0)).toEqual({ limit_usd: 0.5, ttl_hours: 6 });
    await run(['child', '--limit', 'none'], t.env, t.io);
    expect(body(1)).toEqual({ limit_usd: null });
    await run(['child', '--amount', '2'], t.env, t.io);
    expect(body(2)).toEqual({ limit_usd: 2 });
    expect(await run(['child', '--limit', '1', '--budget', '5'], t.env, t.io)).toBe(1);
    expect(await run(['child'], t.env, t.io)).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a key name with a path in it', async () => {
    const t = setup();
    expect(await run(['key', 'show', '../key'], t.env, t.io)).toBe(1);
  });
});

describe('keychain', () => {
  let items: Map<string, string>;
  let setOk: boolean;
  beforeEach(() => {
    items = new Map();
    setOk = true;
    vi.spyOn(keychain, 'get').mockImplementation((id) => items.get(id) ?? null);
    vi.spyOn(keychain, 'set').mockImplementation((id, _label, value) => {
      if (setOk) items.set(id, value);
      return setOk;
    });
    vi.spyOn(keychain, 'delete').mockImplementation((id) => void items.delete(id));
  });
  afterEach(() => vi.restoreAllMocks());
  const env = () => ({ PAI_KEYCHAIN: '1', PHANTOM_STATE_DIR: mkdtempSync(path.join(tmpdir(), 'pai-keychain-')) });

  it('saves the key in the Keychain and leaves only a pointer in the file', () => {
    const e = env();
    const { saved } = saveApiKey(e, 'sk-phantom-secret');
    expect(readFileSync(saved, 'utf-8')).toMatch(/^pai-keychain:[0-9a-f]+\n$/);
    expect(resolveApiKey(e)).toBe('sk-phantom-secret');
    expect(removeApiKey(e)).toEqual({ removed: true });
    expect(items.size).toBe(0);
  });

  it('keeps the mail password out of the file', () => {
    const e = env();
    const { saved } = mailSetup(e, { user: 'me@gmail.com', pass: 'app-pass' });
    expect(readFileSync(saved, 'utf-8')).not.toContain('app-pass');
    expect(mailConfig(e).pass).toBe('app-pass');
  });

  it('moves a secret file written before into the Keychain on first read', () => {
    const e = env();
    writeFileSync(path.join(e.PHANTOM_STATE_DIR, 'key'), 'sk-phantom-old\n');
    expect(resolveApiKey(e)).toBe('sk-phantom-old');
    expect(readFileSync(path.join(e.PHANTOM_STATE_DIR, 'key'), 'utf-8')).toMatch(/^pai-keychain:/);
    expect([...items.values()]).toEqual(['sk-phantom-old\n']);
  });

  it('leaves the file alone when the Keychain will not take it', () => {
    const e = env();
    setOk = false;
    writeFileSync(path.join(e.PHANTOM_STATE_DIR, 'key'), 'sk-phantom-old\n');
    expect(resolveApiKey(e)).toBe('sk-phantom-old');
    expect(readFileSync(path.join(e.PHANTOM_STATE_DIR, 'key'), 'utf-8')).toBe('sk-phantom-old\n');
  });

  it('refuses to save when the Keychain is locked, rather than falling back to a file', () => {
    const e = env();
    setOk = false;
    expect(() => saveApiKey(e, 'sk-phantom-secret')).toThrow(/Keychain/);
    expect(existsSync(path.join(e.PHANTOM_STATE_DIR, 'key'))).toBe(false);
  });

  it('says so when a pointer leads nowhere', () => {
    const e = env();
    writeFileSync(path.join(e.PHANTOM_STATE_DIR, 'key'), 'pai-keychain:gone\n');
    expect(() => resolveApiKey(e)).toThrow(/could not be read/);
  });
});

describe('memory', () => {
  const env = () => ({ PHANTOM_STATE_DIR: mkdtempSync(path.join(tmpdir(), 'pai-memory-')) });
  const T = (min: number) => new Date(Date.UTC(2026, 8, 23, 12, min));

  it('saves a note as a markdown file only the user can read', () => {
    const e = env();
    const n = addMemory(e, 'main', 'Use pnpm, not npm, in this repo', { tags: ['setup'], now: T(0) });
    expect(n.id).toBe('20260923-120000-use-pnpm-not-npm-in-this-repo');
    const file = path.join(e.PHANTOM_STATE_DIR, 'memory', 'main', n.id + '.md');
    expect(readFileSync(file, 'utf-8')).toContain('tags: [setup]');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('ranks title matches and rare words first, and needs every word unless any', () => {
    const e = env();
    addMemory(e, 'main', 'The deploy runs pnpm gate first', { title: 'Deploy steps', now: T(0) });
    addMemory(e, 'main', 'Neon keeps 6 hours of history for the database', { now: T(1) });
    addMemory(e, 'main', 'Never deploy on Fridays', { title: 'Friday rule', now: T(2) });
    expect(searchMemory(e, 'main', 'deploy').map((n) => n.title)).toEqual(['Deploy steps', 'Friday rule']);
    expect(searchMemory(e, 'main', 'deploy database')).toEqual([]);
    expect(searchMemory(e, 'main', 'deploy database', { any: true })).toHaveLength(3);
  });

  it('keeps spaces apart, and defaults to the saved key name', () => {
    const e = env();
    addMemory(e, 'researcher', 'found the paper', { now: T(0) });
    expect(listMemory(e, 'main')).toEqual([]);
    expect(memorySpace({ PHANTOM_KEY_NAME: 'researcher' })).toBe('researcher');
    expect(memorySpace({ PHANTOM_KEY_NAME: 'researcher', PAI_MEMORY_SPACE: 'shared' })).toBe('shared');
    expect(memorySpace({})).toBe('main');
    expect(() => addMemory(e, '../escape', 'x')).toThrow(/space names/);
  });

  it('works from the CLI with no API key: add, search, show, rm', async () => {
    const e = env();
    let out = '';
    const io = { stdout: (x: string) => (out += x), stderr: () => {} };
    expect(await run(['memory', 'add', 'Staging', 'uses', 'the', 'test-plans', 'branch', '--tag', 'db'], e, io)).toBe(0);
    const id = JSON.parse(out).id;
    out = '';
    await run(['memory', 'search', 'staging', 'branch'], e, io);
    expect(JSON.parse(out).notes.map((n: { id: string }) => n.id)).toEqual([id]);
    out = '';
    await run(['memory', 'show', id, '--table'], e, io);
    expect(out).toContain('Staging uses the test-plans branch');
    expect(await run(['memory', 'rm', id], e, io)).toBe(0);
    out = '';
    await run(['memory', 'list'], e, io);
    expect(JSON.parse(out).notes).toEqual([]);
  });
});

describe('browser and sandbox', () => {
  it('gives each space its own browser session and profile, unless the user set one', () => {
    const e = { PHANTOM_STATE_DIR: '/s' };
    expect(browserEnv(e, 'researcher')).toEqual({ AGENT_BROWSER_SESSION: 'pai-researcher', AGENT_BROWSER_PROFILE: '/s/browser/researcher' });
    expect(browserEnv({ ...e, AGENT_BROWSER_PROFILE: 'Default' }, 'main').AGENT_BROWSER_PROFILE).toBe('Default');
  });

  it('locks the sandbox down by default', () => {
    const a = sandboxArgs('pai-sandbox-x', 'npm test', { dir: '/proj' });
    expect(a.slice(0, 5)).toEqual(['run', '--rm', '-i', '--name', 'pai-sandbox-x']);
    expect(a).toEqual(expect.arrayContaining(['--network', 'none', '--cap-drop', 'ALL', '--user', '1000:1000', '--mount', 'type=bind,src=/proj,dst=/work,readonly']));
    expect(a.slice(-4)).toEqual(['node:24-slim', 'sh', '-c', 'npm test']);
  });

  it('opens the network and the folder only when asked', () => {
    const a = sandboxArgs('n', 'x', { dir: '/proj', network: true, write: true, image: 'python:3.13-slim' });
    expect(a).not.toContain('none');
    expect(a).toContain('type=bind,src=/proj,dst=/work');
    expect(a).toContain('python:3.13-slim');
  });

  it('refuses an image that would read as a flag, and a folder --mount would misparse', () => {
    expect(() => sandboxArgs('n', 'x', { dir: '/proj', image: '--privileged' })).toThrow(/Not an image name/);
    expect(() => sandboxArgs('n', 'x', { dir: '/proj', image: 'alpine --privileged' })).toThrow(/Not an image name/);
    expect(() => sandboxArgs('n', 'x', { dir: '/a,readonly=false' })).toThrow(/comma or quote/);
    expect(sandboxArgs('n', 'x', { dir: '/my:proj' })).toContain('type=bind,src=/my:proj,dst=/work,readonly');
    expect(sandboxArgs('n', 'x', { dir: '/p', image: 'ghcr.io/org/img:1.2@sha256:abc' })).toContain('ghcr.io/org/img:1.2@sha256:abc');
  });

  it('needs -- before the sandbox command', async () => {
    let err = '';
    const io = { stdout: () => {}, stderr: (x: string) => (err += x) };
    expect(await run(['sandbox', 'run', 'ls'], {}, io)).toBe(1);
    expect(err).toContain('Usage: pai sandbox run');
  });
});

describe('mail', () => {
  const env = () => ({ PHANTOM_STATE_DIR: mkdtempSync(path.join(tmpdir(), 'pai-mail-')) });
  const msg = { to: 'a@example.test', subject: 's', text: 't' };

  it('reads servers as host:port, secure on 993 and 465', () => {
    expect(parseServer('imap.example.com')).toEqual({ host: 'imap.example.com', port: 993, secure: true });
    expect(parseServer('smtp.example.com:587')).toEqual({ host: 'smtp.example.com', port: 587, secure: false });
    expect(parseServer('localhost:993', true)).toEqual({ host: 'localhost', port: 993, secure: false, insecure: true });
  });

  it('presets common providers and saves the login mode 600', () => {
    const e = env();
    const r = mailSetup(e, { user: 'me@gmail.com', pass: 'app-pass' });
    expect(r.imap.host).toBe('imap.gmail.com');
    expect(statSync(r.saved).mode & 0o777).toBe(0o600);
    expect(() => mailSetup(e, { user: 'me@unknown.example', pass: 'x' })).toThrow(/No preset/);
  });

  it('only sends when the environment allows it', async () => {
    expect(mailSendLimit({})).toEqual({ allowed: false, perDay: 10 });
    expect(mailSendLimit({ PAI_MAIL_SEND: '1', PAI_MAIL_MAX_PER_DAY: '3' })).toEqual({ allowed: true, perDay: 3 });
    await expect(mailSend(env(), msg)).rejects.toThrow(/Sending is off/);
  });

  it('stops at the daily cap before connecting', async () => {
    const e = { ...env(), PAI_MAIL_SEND: '1', PAI_MAIL_MAX_PER_DAY: '1' };
    const now = Date.now();
    writeFileSync(path.join(e.PHANTOM_STATE_DIR, 'mail-sent.log'), `${now - 1000}\n`);
    await expect(mailSend(e, msg, now)).rejects.toThrow(/Sent to 1 recipients today/);
  });

  describe('sending', () => {
    const sendEnv = (over: Record<string, string> = {}) => {
      const e = { ...env(), PAI_MAIL_SEND: '1', PAI_MAIL_MAX_PER_DAY: '3', ...over };
      mailSetup(e, { user: 'me@outlook.com', pass: 'app-pass' });
      return e;
    };
    const sentLines = (e: { PHANTOM_STATE_DIR: string }) =>
      readFileSync(path.join(e.PHANTOM_STATE_DIR, 'mail-sent.log'), 'utf-8').split('\n').filter(Boolean).length;
    beforeEach(() => {
      nodemailerMock.createTransport.mockClear();
      nodemailerMock.sendMail.mockReset().mockResolvedValue({ messageId: '<m@x>' });
    });

    it('requires STARTTLS on a 587 server, so a stripped upgrade sends no password', async () => {
      const e = sendEnv();
      await mailSend(e, msg);
      expect(nodemailerMock.createTransport.mock.calls[0][0]).toMatchObject({ host: 'smtp.office365.com', port: 587, secure: false, requireTLS: true });
    });

    it('counts each recipient against the cap, and names them all in the envelope', async () => {
      const e = sendEnv();
      await expect(mailSend(e, { ...msg, to: 'a@x.test, b@x.test, Name <c@x.test>, d@x.test' })).rejects.toMatchObject({ code: 'mail_send_cap' });
      expect(nodemailerMock.sendMail).not.toHaveBeenCalled();
      const r = await mailSend(e, { ...msg, to: 'a@x.test, Name <C@X.test>' });
      expect(r.sent_today).toBe(2);
      expect(nodemailerMock.sendMail.mock.calls[0][0].envelope.to).toEqual(['a@x.test', 'c@x.test']);
      expect(() => mailRecipients('not an address')).toThrow(/Not an email address/);
    });

    it('sends only to PAI_MAIL_SEND_TO when it is set', async () => {
      const e = sendEnv({ PAI_MAIL_SEND_TO: 'boss@work.test, @family.test' });
      await expect(mailSend(e, { ...msg, to: 'attacker@evil.test' })).rejects.toMatchObject({ code: 'mail_recipient_refused' });
      await expect(mailSend(e, { ...msg, to: 'mom@family.test, x@evil.test' })).rejects.toMatchObject({ code: 'mail_recipient_refused' });
      expect(nodemailerMock.sendMail).not.toHaveBeenCalled();
      await mailSend(e, { ...msg, to: 'Boss@work.test, mom@family.test' });
      expect(nodemailerMock.sendMail).toHaveBeenCalledTimes(1);
      expect(mailAllowed(e, 'x@notfamily.test')).toBe(false);
    });

    it('lets parallel sends through only up to the cap', async () => {
      const e = sendEnv({ PAI_MAIL_MAX_PER_DAY: '2' });
      const runs = await Promise.allSettled([1, 2, 3, 4].map((i) => mailSend(e, { ...msg, to: `r${i}@x.test` })));
      expect(nodemailerMock.sendMail.mock.calls.length).toBeLessThanOrEqual(2);
      expect(runs.filter((r) => r.status === 'fulfilled').length).toBe(nodemailerMock.sendMail.mock.calls.length);
      expect(sentLines(e)).toBe(nodemailerMock.sendMail.mock.calls.length);
    });

    it('does not count a send that failed', async () => {
      const e = sendEnv();
      nodemailerMock.sendMail.mockRejectedValueOnce(new Error('smtp down'));
      await expect(mailSend(e, msg)).rejects.toThrow('smtp down');
      expect(sentLines(e)).toBe(0);
    });
  });
});

describe('fixes from the docs review', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('a named key wins over PHANTOM_API_KEY, so a subagent never spends the parent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pai-prec-'));
    mkdirSync(path.join(dir, 'keys'), { recursive: true });
    writeFileSync(path.join(dir, 'keys', 'child'), 'sk-phantom-child-1\n');
    expect(resolveApiKey({ PHANTOM_STATE_DIR: dir, PHANTOM_API_KEY: 'sk-phantom-parent', PHANTOM_KEY_NAME: 'child' })).toBe('sk-phantom-child-1');
    expect(resolveApiKey({ PHANTOM_STATE_DIR: dir, PHANTOM_API_KEY: 'sk-phantom-parent' })).toBe('sk-phantom-parent');
  });

  it('prints its version', async () => {
    let out = '';
    expect(await run(['--version'], {}, { stdout: (x) => (out += x), stderr: () => {} })).toBe(0);
    expect(out.trim()).toBe(VERSION);
  });

  it("delete_key won't delete the key the MCP server runs as", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer({ PHANTOM_API_KEY: 'sk-phantom-parent', PHANTOM_BASE_URL: 'https://test.local' }).connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    const res = await client.callTool({ name: 'delete_key', arguments: { api_key: 'sk-phantom-parent' } });
    expect(res.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.close();
  });

  it('create_child_key keeps the key out of the reply while mail can send', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer({ PHANTOM_API_KEY: 'sk-phantom-parent', PHANTOM_BASE_URL: 'https://test.local', PAI_MAIL_SEND: '1' }).connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    const res = await client.callTool({ name: 'create_child_key', arguments: { limit_usd: 1 } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('save_as');
    expect(fetchMock).not.toHaveBeenCalled();
    await client.close();
  });

  it('wallet tools work without an API key', async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer({ PHANTOM_STATE_DIR: mkdtempSync(path.join(tmpdir(), 'pai-nokey-')) }).connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    const res = await client.callTool({ name: 'list_wallets', arguments: {} });
    expect(JSON.stringify(res.content)).not.toContain('No API key');
    await client.close();
  });
});
