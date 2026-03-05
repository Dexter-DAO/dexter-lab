import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployApiError, persistResourceUpdateToApi, syncResourceUpdateWithRecovery } from './api-client';

describe('deployment api-client recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns patched when PATCH succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    const outcome = await syncResourceUpdateWithRecovery({
      resourceId: 'res-test',
      update: { status: 'running', healthy: true },
      recreate: { id: 'res-test', status: 'running', healthy: true },
    });

    expect(outcome).toBe('patched');
  });

  it('recreates on PATCH 404', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":"Resource not found"}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const outcome = await syncResourceUpdateWithRecovery({
      resourceId: 'res-test',
      update: { status: 'running', healthy: true },
      recreate: { id: 'res-test', status: 'running', healthy: true },
    });

    expect(outcome).toBe('recreated_after_404');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws DeployApiError for non-404 update errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }));

    await expect(persistResourceUpdateToApi('res-test', { healthy: false })).rejects.toBeInstanceOf(DeployApiError);
  });
});
