import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error Server modules are runtime .mjs files exercised by Vitest.
import { createAdminServer } from '../server/index.mjs';
// @ts-expect-error Server modules are runtime .mjs files exercised by Vitest.
import { EDITOR_GRID_COLS, normalizeRows } from '../server/campaignOverrideStore.mjs';

let tempDir: string | null = null;

async function createTestServer(adminPassword = 'test-secret-password') {
  tempDir = await mkdtemp(join(tmpdir(), 'bounce-forge-api-'));
  const server = createAdminServer({
    adminPassword,
    dataFile: join(tempDir, 'campaign-level-overrides.json'),
    apiOnly: true
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Invalid test server address.');
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

function makeRows(): string[] {
  const rows = normalizeRows([]);
  rows[0] = `1${'.'.repeat(EDITOR_GRID_COLS - 1)}`;
  return rows;
}

async function loginAdmin(baseUrl: string): Promise<string> {
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-secret-password' })
  });

  expect(login.status).toBe(200);
  return login.headers.get('set-cookie') ?? '';
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('admin server API', () => {
  it('rejects campaign writes without an admin session', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      const response = await fetch(`${baseUrl}/api/admin/campaign-levels/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Blocked', rows: makeRows() })
      });

      expect(response.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it('logs in and persists admin campaign changes', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'test-secret-password' })
      });
      const cookie = login.headers.get('set-cookie') ?? '';
      expect(login.status).toBe(200);
      expect(cookie).toContain('bounce_forge_admin');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(login.headers.get('content-security-policy')).toContain("default-src 'self'");

      const save = await fetch(`${baseUrl}/api/admin/campaign-levels/0`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie
        },
        body: JSON.stringify({ name: 'Admin Level', rows: makeRows() })
      });
      expect(save.status).toBe(200);

      const levels = await fetch(`${baseUrl}/api/admin/campaign-levels`);
      const payload = (await levels.json()) as { overrides: Array<{ name: string }> };

      expect(payload.overrides[0]?.name).toBe('Admin Level');
    } finally {
      server.close();
    }
  });

  it('refuses weak admin password configuration', async () => {
    const { server, baseUrl } = await createTestServer('secret');

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'secret' })
      });

      expect(login.status).toBe(503);
    } finally {
      server.close();
    }
  });

  it('rate limits repeated failed admin logins', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await fetch(`${baseUrl}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'wrong' })
        });
        expect(response.status).toBe(401);
      }

      const limited = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' })
      });
      expect(limited.status).toBe(429);
    } finally {
      server.close();
    }
  });

  it('rejects cross-origin admin mutations', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'test-secret-password' })
      });
      const cookie = login.headers.get('set-cookie') ?? '';

      const response = await fetch(`${baseUrl}/api/admin/campaign-levels/0`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie,
          origin: 'https://evil.example'
        },
        body: JSON.stringify({ name: 'Blocked', rows: makeRows() })
      });

      expect(response.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it('returns 400 for invalid campaign grids without exposing stack traces', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      const cookie = await loginAdmin(baseUrl);
      const rows = makeRows();
      rows[0] = `Z${'.'.repeat(EDITOR_GRID_COLS - 1)}`;

      const response = await fetch(`${baseUrl}/api/admin/campaign-levels/0`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie
        },
        body: JSON.stringify({ name: 'Broken Level', rows })
      });
      const payload = (await response.json()) as { message: string };

      expect(response.status).toBe(400);
      expect(payload.message).toContain('Unknown block');
      expect(payload.message).not.toContain('Error:');
    } finally {
      server.close();
    }
  });

  it('returns 400 for out-of-range campaign levels', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      const cookie = await loginAdmin(baseUrl);
      const response = await fetch(`${baseUrl}/api/admin/campaign-levels/24`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie
        },
        body: JSON.stringify({ name: 'Level 25', rows: makeRows() })
      });

      await expect(response.json()).resolves.toMatchObject({ message: 'Unknown campaign level.' });
      expect(response.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it('returns 400 for invalid admin campaign payloads and names', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      const cookie = await loginAdmin(baseUrl);
      const invalidPayload = await fetch(`${baseUrl}/api/admin/campaign-levels/0`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie
        },
        body: JSON.stringify(null)
      });

      expect(invalidPayload.status).toBe(400);

      const invalidName = await fetch(`${baseUrl}/api/admin/campaign-levels/0`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie
        },
        body: JSON.stringify({ name: ['Bad'], rows: makeRows() })
      });

      await expect(invalidName.json()).resolves.toMatchObject({ message: 'Invalid level name.' });
      expect(invalidName.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it('allows localhost dev proxy origins on different ports', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost:5173'
        },
        body: JSON.stringify({ password: 'test-secret-password' })
      });

      expect(login.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it('marks admin cookies secure behind HTTPS proxies', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-proto': 'https'
        },
        body: JSON.stringify({ password: 'test-secret-password' })
      });
      const cookie = login.headers.get('set-cookie') ?? '';

      expect(login.status).toBe(200);
      expect(cookie).toContain('Secure');
    } finally {
      server.close();
    }
  });

  it('deletes admin campaign overrides only with a session', async () => {
    const { server, baseUrl } = await createTestServer();

    try {
      const login = await fetch(`${baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'test-secret-password' })
      });
      const cookie = login.headers.get('set-cookie') ?? '';

      await fetch(`${baseUrl}/api/admin/campaign-levels/0`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie
        },
        body: JSON.stringify({ name: 'Temporary Level', rows: makeRows() })
      });

      const blocked = await fetch(`${baseUrl}/api/admin/campaign-levels/0`, {
        method: 'DELETE'
      });
      expect(blocked.status).toBe(401);

      const removed = await fetch(`${baseUrl}/api/admin/campaign-levels/0`, {
        method: 'DELETE',
        headers: { cookie }
      });
      expect(removed.status).toBe(200);
      await expect(removed.json()).resolves.toEqual({ removed: true });

      const levels = await fetch(`${baseUrl}/api/admin/campaign-levels`);
      const payload = (await levels.json()) as { overrides: Array<{ name: string }> };
      expect(payload.overrides).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('keeps admin campaign changes after server restart', async () => {
    const first = await createTestServer();

    try {
      const login = await fetch(`${first.baseUrl}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'test-secret-password' })
      });
      const cookie = login.headers.get('set-cookie') ?? '';

      await fetch(`${first.baseUrl}/api/admin/campaign-levels/0`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          cookie
        },
        body: JSON.stringify({ name: 'Reboot Level', rows: makeRows() })
      });
    } finally {
      await new Promise<void>((resolve) => first.server.close(() => resolve()));
    }

    const secondServer = createAdminServer({
      adminPassword: 'test-secret-password',
      dataFile: join(tempDir!, 'campaign-level-overrides.json'),
      apiOnly: true
    });

    await new Promise<void>((resolve) => {
      secondServer.listen(0, '127.0.0.1', resolve);
    });

    const address = secondServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Invalid restarted server address.');
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/campaign-levels`);
      const payload = (await response.json()) as { overrides: Array<{ name: string }> };

      expect(payload.overrides[0]?.name).toBe('Reboot Level');
    } finally {
      await new Promise<void>((resolve) => secondServer.close(() => resolve()));
    }
  });

  it('falls back to the SPA instead of serving files outside dist', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bounce-forge-static-'));
    const distDir = join(tempDir, 'dist');

    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.html'), '<h1>INDEX</h1>', 'utf8');
    await writeFile(join(tempDir, 'outside.txt'), 'OUTSIDE', 'utf8');

    const server = createAdminServer({
      adminPassword: 'test-secret-password',
      dataFile: join(tempDir, 'campaign-level-overrides.json'),
      distDir,
      apiOnly: false
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Invalid static test server address.');
    }

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/%2e%2e%2foutside.txt`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('INDEX');
      expect(body).not.toContain('OUTSIDE');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
