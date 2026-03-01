import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveDexterHolderStatus } from './holder-status';

const TEST_WALLET = 'EfPoo4wWgxKVToit7yX5VtXXBrhao4G8L7vrbKy6pump';

describe('holder-status resolver', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks holders when raw balance passes threshold', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            value: [
              {
                account: {
                  data: {
                    parsed: {
                      info: {
                        tokenAmount: { amount: '1500000' },
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );

    const status = await resolveDexterHolderStatus(TEST_WALLET, { forceRefresh: true });
    expect(status.isHolder).toBe(true);
    expect(status.balanceRaw).toBe('1500000');
    expect(fetchSpy).toHaveBeenCalled();
  });
});
