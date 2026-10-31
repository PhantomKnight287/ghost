import { createTransport } from 'nodemailer';
import { proxyTransport } from './proxy.transport.js';

describe('proxyTransport', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('posts the rendered mail to the relay', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '' });

    await createTransport(
      proxyTransport('https://relay.test', 's3cret'),
    ).sendMail({
      from: 'Ghost <noreply@ghost.local>',
      to: 'user@example.com',
      subject: 'Verify your email',
      html: '<p>hi</p>',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://relay.test');
    expect(JSON.parse(init.body)).toMatchObject({
      to: 'user@example.com',
      from: 'Ghost <noreply@ghost.local>',
      subject: 'Verify your email',
      htmlBody: '<p>hi</p>',
      secret: 's3cret',
    });
  });

  it('fails the send when the relay rejects', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    });

    await expect(
      createTransport(proxyTransport('https://relay.test')).sendMail({
        from: 'a@b.c',
        to: 'user@example.com',
        subject: 's',
        html: 'x',
      }),
    ).rejects.toThrow('502');
  });
});
