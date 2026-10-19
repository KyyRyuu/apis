/*
 * Proxysite web-proxy fetch layer (fallback bila IP server kena wall).
 * BUKAN modul endpoint (tidak ada default export) — hanya di-import.
 *
 * Flow: POST https://<srv>.proxysite.com/includes/process.php?action=update
 *   (d=target, server-option=srv, allowCookies=on) -> 302 location.
 *   GET location: server menjawab "HTTP/1.1 103" PALSU lalu langsung body
 *   tanpa status-line final (parser HTTP normal: Node/curl => Parse Error /
 *   hang). Solusi: baca via raw TLS socket, buang blok header pertama
 *   (s/d \r\n\r\n), baca body sampai </html> + grace 1.2 dtk.
 *   Cookie dari POST WAJIB dibawa (tanpa itu di-redirect ke www.+ CF 403).
 */
import axios from 'axios';
import * as tls from 'tls';

const PS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const PS_SERVERS = ['us8', 'eu19', 'us4', 'eu14', 'us12', 'eu7', 'us20', 'eu20'];
let _rr = 0;

function pickServers(n: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(PS_SERVERS[(_rr + i) % PS_SERVERS.length]);
    _rr = (_rr + n) % PS_SERVERS.length;
    return out;
}

function proxyConf(): Record<string, any> {
    const raw = process.env.XHAMSTER_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (!raw) return {};
    try {
        const u = new URL(raw);
        const conf: Record<string, any> = {
            proxy: {
                protocol: u.protocol.replace(':', ''),
                host: u.hostname,
                port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
            },
        };
        if (u.username) conf.proxy.auth = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
        return conf;
    } catch {
        return {};
    }
}

async function psPost(server: string, target: string): Promise<{ location: string; cookie: string } | null> {
    const host = `https://${server}.proxysite.com`;
    try {
        const res = await axios.post(
            `${host}/includes/process.php?action=update`,
            new URLSearchParams({ d: target, 'server-option': server, allowCookies: 'on' }).toString(),
            {
                headers: {
                    'User-Agent': PS_UA,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Origin: host,
                    Referer: `${host}/`,
                },
                maxRedirects: 0,
                validateStatus: (s: number) => s < 600,
                timeout: 25000,
                ...proxyConf(),
            }
        );
        const loc = res.headers.location;
        if ((res.status === 301 || res.status === 302) && loc) {
            const sc = res.headers['set-cookie'];
            const cookie = Array.isArray(sc)
                ? sc.map((c) => String(c).split(';')[0].trim()).filter(Boolean).join('; ')
                : '';
            return { location: loc, cookie };
        }
    } catch { /* coba server lain */ }
    return null;
}

// GET mentah via TLS: toleran terhadap status-line "103" palsu.
// Resolve body (string) atau null. Body dianggap komplit saat </html> ketemu.
function rawTlsGet(pageUrl: string, cookie: string, referer: string, timeoutMs = 55000): Promise<string | null> {
    return new Promise((resolve) => {
        let done = false;
        const finish = (v: string | null) => { if (!done) { done = true; resolve(v); } };
        let u: URL;
        try { u = new URL(pageUrl); } catch { finish(null); return; }
        if (u.protocol !== 'https:') { finish(null); return; }

        const sock = tls.connect(443, u.hostname, { servername: u.hostname }, () => {
            const lines = [
                `GET ${u.pathname}${u.search} HTTP/1.1`,
                `Host: ${u.hostname}`,
                `User-Agent: ${PS_UA}`,
                'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language: ' + 'en-US,en;q=0.9',
                `Referer: ${referer}`,
                ...(cookie ? [`Cookie: ${cookie}`] : []),
                'Connection: close',
                '', '',
            ];
            sock.write(lines.join('\r\n'));
        });

        let buf = Buffer.alloc(0);
        let graceTimer: any = null;
        const endMarker = Buffer.from('</html>');

        sock.on('data', (c: Buffer) => {
            buf = Buffer.concat([buf, c]);
            if (!graceTimer && buf.includes(endMarker)) {
                graceTimer = setTimeout(() => { try { sock.destroy(); } catch { /* noop */ } }, 1200);
            }
            if (buf.length > 8 * 1024 * 1024) { try { sock.destroy(); } catch { /* noop */ } }
        });
        sock.on('close', () => {
            if (graceTimer) clearTimeout(graceTimer);
            const sep = buf.indexOf('\r\n\r\n');
            if (sep === -1) { finish(null); return; }
            const body = buf.slice(sep + 4).toString('utf8');
            finish(body.length > 500 ? body : null);
        });
        sock.on('error', () => {
            if (graceTimer) clearTimeout(graceTimer);
            finish(null);
        });
        setTimeout(() => { try { sock.destroy(); } catch { /* noop */ } finish(null); }, timeoutMs);
    });
}

export async function fetchViaProxysite(targetUrl: string, maxServers = 3): Promise<{ html: string; server: string } | null> {
    for (const server of pickServers(Math.min(maxServers, PS_SERVERS.length))) {
        const posted = await psPost(server, targetUrl);
        if (!posted) continue;
        const body = await rawTlsGet(posted.location, posted.cookie, `https://${server}.proxysite.com/`);
        if (body && body.includes('window.initials') && !/Just a moment|cf-chl/i.test(body)) {
            return { html: body, server };
        }
    }
    return null;
}
