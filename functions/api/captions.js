// Cloudflare Pages Function: /api/captions?url=<video page link>
// Fetches plain-text captions for approved sites only. Stores nothing.
const ALLOWED = ['archive.org']; // add more approved video sites here

const reply = (msg, status = 200) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request }) {
  // only our own site may call this
  const ref = request.headers.get('Referer');
  if (ref) { try { if (new URL(ref).host !== new URL(request.url).host) return reply('Not allowed', 403); } catch { return reply('Not allowed', 403); } }

  let target;
  try { target = new URL(new URL(request.url).searchParams.get('url') || ''); } catch { return reply('That does not look like a link.', 400); }
  const ok = target.protocol === 'https:' && ALLOWED.some(h => target.hostname === h || target.hostname.endsWith('.' + h));
  if (!ok) return reply('This site is not supported yet. Paste the transcript instead.', 400);

  const m = target.pathname.match(/^\/(?:details|embed)\/([^/]+)/);
  if (!m) return reply('Paste a link to an Internet Archive video page.', 400);
  const id = encodeURIComponent(m[1]);
  try {
    const meta = await (await fetch('https://archive.org/metadata/' + id)).json();
    const f = (meta.files || []).find(x => /\.(vtt|srt)$/i.test(x.name));
    if (!f) return reply('This video has no captions. Paste the transcript instead.', 404);
    const raw = await (await fetch('https://archive.org/download/' + id + '/' + f.name.split('/').map(encodeURIComponent).join('/'))).text();
    const text = raw.replace(/^WEBVTT.*$/m, '').replace(/^\d+\s*$/gm, '').replace(/^.*-->.*$/gm, '')
      .replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim().slice(0, 100000);
    return reply(text || 'The captions file was empty.');
  } catch { return reply('Could not read the captions right now.', 502); }
}
