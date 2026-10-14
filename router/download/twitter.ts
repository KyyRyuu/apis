/*
 * X/Twitter Downloader
 * type: Scraper + Proxy
 * base url: x.com (fxtwitter -> syndication -> vxtwitter fallback)
 * author: wa.me/ikyykzy
 * note: ambil cdn url video + full statistik (caption, like, comment, save, dll).
 *       SEMUA url media di-response sudah dibungkus link proxy (field "proxy") supaya
 *       user TIDAK perlu set header (User-Agent/Referer) sendiri -> tinggal klik.
 */
import { Request, Response } from 'express';
import axios from 'axios';

const UA_BROWSER =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const http = axios.create({
    headers: { 'User-Agent': UA_BROWSER },
    timeout: 25000,
    maxRedirects: 5,
    validateStatus: (s: number) => s < 500,
});

const HOSTS = new Set([
    'x.com',
    'www.x.com',
    'twitter.com',
    'www.twitter.com',
    'mobile.twitter.com',
    'mobile.x.com',
    'fxtwitter.com',
    'vxtwitter.com',
    'fixupx.com',
]);

const PROXY_HOSTS = new Set(['video.twimg.com', 'pbs.twimg.com']);

function proxyConf(): Record<string, any> {
    const raw = process.env.TWITTER_PROXY || process.env.YOUTUBE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
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

function b64urlEncode(str: string): string {
    return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
    let pad = str.replace(/-/g, '+').replace(/_/g, '/');
    while (pad.length % 4) pad += '=';
    return Buffer.from(pad, 'base64').toString('utf8');
}

function sanitizeName(s: string): string {
    return String(s || 'file').replace(/[^\w\-. ]+/g, '_').replace(/\s+/g, '_').slice(0, 90) || 'file';
}

function isAllowedMediaHost(mediaUrl: string): boolean {
    try {
        return PROXY_HOSTS.has(new URL(mediaUrl).hostname.toLowerCase());
    } catch {
        return false;
    }
}

function parseTweetUrl(input: string): { id: string; url: string; user: string | null; hint: string | null } {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('URL kosong');

    if (/^\d+$/.test(raw)) return { id: raw, url: `https://x.com/i/status/${raw}`, user: null, hint: null };

    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let u: URL;
    try {
        u = new URL(withProto);
    } catch {
        throw new Error('URL tidak valid');
    }

    const host = u.hostname.toLowerCase();
    if (host === 'pic.twitter.com' || host === 't.co') {
        const inner = u.searchParams.get('s') || u.searchParams.get('url');
        if (inner) return parseTweetUrl(inner);
    }
    if (!HOSTS.has(host)) throw new Error(`Host tidak didukung: ${host}`);

    const m = /\/status(?:es)?\/(\d+)/.exec(u.pathname) || /\/(\d+)$/.exec(u.pathname);
    if (!m) throw new Error('Tweet ID tidak ditemukan di URL');

    const id = m[1];
    const user = /(?:^|\/)(?:i\/web\/)?([A-Za-z0-9_]{1,15})(?:\/|$)/.exec(u.pathname.replace(/^\/+/, ''));
    const screen = u.pathname.split('/').filter(Boolean)[0];
    const isUserPath = !!screen && !['i', 'status', 'statuses', 'home', 'explore'].includes(screen);

    return {
        id,
        url: isUserPath ? `https://x.com/${screen}/status/${id}` : `https://x.com/i/status/${id}`,
        user: isUserPath ? screen : null,
        hint: user ? user[1] : null,
    };
}

function syndicationToken(id: string): string {
    return ((Number(id) / 1e15) * Math.PI)
        .toString(36)
        .replace(/(0+|\.)/g, '');
}

const stripTco = (text: any): string =>
    String(text || '').replace(/\s*https?:\/\/t\.co\/\w+\s*$/u, '').trim();

function extractEntities(text: any): { hashtags: string[]; mentions: string[]; urls: string[] } {
    const t = String(text || '');
    return {
        hashtags: [...new Set([...t.matchAll(/#(\p{L}\w+)/gu)].map((m) => m[1]))],
        mentions: [...new Set([...t.matchAll(/@(\w+)/g)].map((m) => m[1]))],
        urls: [...new Set([...t.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0]))],
    };
}

function buildVariants(list: any[]): any[] {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const v of list || []) {
        if (!v || !v.url) continue;
        const isMp4 = v.container === 'mp4' || v.content_type === 'video/mp4' || /\/vid\//.test(v.url);
        const isHls = v.container === 'm3u8' || v.content_type === 'application/x-mpegURL' || /\.m3u8/.test(v.url);
        if (!isMp4 && !isHls) continue;
        if (seen.has(v.url)) continue;
        seen.add(v.url);

        const res = v.resolution || ((/\/(\d{2,4})x(\d{2,4})\//.exec(v.url) || []).slice(1).join('x')) || null;
        out.push({
            url: v.url,
            type: isMp4 ? 'mp4' : 'm3u8',
            resolution: res || null,
            bitrate: typeof v.bitrate === 'number' && v.bitrate > 0 ? v.bitrate : null,
            codec: v.codec || null,
        });
    }
    out.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    return out;
}

function bestCdn(variants: any[]): string | null {
    const mp4 = variants.filter((v) => v.type === 'mp4');
    if (mp4.length) return mp4[0].url;
    return variants.length ? variants[0].url : null;
}

function photoCdn(url: string | null): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.hostname === 'pbs.twimg.com') u.searchParams.set('name', 'orig');
        return u.toString();
    } catch {
        return url;
    }
}

function normalizeFx(raw: any): any {
    const t = raw.tweet;
    const caption = stripTco(t.text || t.raw_text?.text || '');
    const media = (t.media?.all || []).map((m: any, i: number) => {
        const variants = buildVariants(
            (m.formats || []).map((f: any) => ({
                url: f.url,
                container: f.container,
                bitrate: f.bitrate,
                codec: f.codec,
            })).concat(
                (m.variants || []).map((v: any) => ({ url: v.url, content_type: v.content_type, bitrate: v.bitrate }))
            )
        );
        return {
            index: i + 1,
            id: m.id || null,
            type: m.type || 'photo',
            width: m.width || null,
            height: m.height || null,
            duration_seconds: typeof m.duration === 'number' ? m.duration : null,
            thumbnail: m.type === 'photo' ? photoCdn(m.thumbnail_url || m.url) : (m.thumbnail_url || m.url || null),
            alt_text: m.alt_text || m.altText || null,
            cdn_url: bestCdn(variants) || (m.type === 'photo' ? photoCdn(m.url) : null),
            variants,
        };
    });

    return {
        source: 'fxtwitter',
        id: t.id,
        url: t.url,
        created_at: t.created_at || null,
        created_timestamp: t.created_timestamp || null,
        lang: t.lang || null,
        possibly_sensitive: !!t.possibly_sensitive,
        community_note: t.community_note || null,
        caption: { text: caption, raw: t.text || null, ...extractEntities(caption) },
        author: {
            id: t.author?.id || null,
            name: t.author?.name || null,
            username: t.author?.screen_name || null,
            url: t.author?.url || null,
            avatar: t.author?.avatar_url || null,
            verified: !!t.author?.verification?.verified,
            verification_type: t.author?.verification?.type || null,
            followers: t.author?.followers ?? null,
            following: t.author?.following ?? null,
            likes: t.author?.likes ?? null,
            media_count: t.author?.media_count ?? null,
            joined: t.author?.joined || null,
            protected: !!t.author?.protected,
        },
        stats: {
            like: t.likes ?? null,
            comment: t.replies ?? null,
            save: t.bookmarks ?? null,
            retweet: t.retweets ?? null,
            quote: t.quotes ?? null,
            view: t.views ?? null,
        },
        media,
        has_video: media.some((m: any) => m.type === 'video' || m.type === 'gif'),
        note_tweet: t.is_note_tweet ? t.raw_text?.text || t.text : null,
    };
}

function normalizeSynd(raw: any): any {
    const caption = stripTco(raw.text || '');
    const details = raw.mediaDetails || [];
    const photos = raw.photos || [];

    const media = details.map((m: any, i: number) => {
        const variants = buildVariants(
            (m.video_info?.variants || []).map((v: any) => ({
                url: v.url,
                content_type: v.content_type,
                bitrate: v.bitrate,
            }))
        );
        return {
            index: i + 1,
            id: m.id_str || null,
            type: m.type || 'photo',
            width: m.original_info?.width || null,
            height: m.original_info?.height || null,
            duration_seconds: m.video_info?.duration_millis
                ? Math.round(m.video_info.duration_millis / 100) / 10
                : null,
            thumbnail: m.media_url_https || null,
            alt_text: m.ext_alt_text || null,
            cdn_url: bestCdn(variants) || (m.type === 'photo' ? photoCdn(m.media_url_https) : null),
            variants,
        };
    });

    const keyOf = (v: any): string => String(v || '').split('?')[0];
    const seen = new Set<string>();
    for (const m of media) {
        if (m.id) seen.add(String(m.id));
        seen.add(keyOf(m.thumbnail));
        seen.add(keyOf(m.cdn_url));
    }
    photos.forEach((p: any) => {
        const url = photoCdn(p.media_url_https || p.url);
        const id = p.id_str ? String(p.id_str) : null;
        const k = keyOf(p.media_url_https || p.url);
        if ((id && seen.has(id)) || seen.has(k)) return;
        if (id) seen.add(id);
        seen.add(k);
        media.push({
            index: media.length + 1,
            id: p.id_str || null,
            type: 'photo',
            width: p.original_info?.width || p.width || null,
            height: p.original_info?.height || p.height || null,
            duration_seconds: null,
            thumbnail: url,
            alt_text: p.ext_alt_text || null,
            cdn_url: url,
            variants: [],
        });
    });

    return {
        source: 'syndication',
        id: raw.id_str,
        url: raw.url || null,
        created_at: raw.created_at || null,
        created_timestamp: raw.created_at ? Math.floor(new Date(raw.created_at).getTime() / 1000) : null,
        lang: raw.lang || null,
        possibly_sensitive: !!raw.possibly_sensitive,
        community_note: null,
        caption: { text: caption, raw: raw.text || null, ...extractEntities(caption) },
        author: {
            id: raw.user?.id_str || null,
            name: raw.user?.name || null,
            username: raw.user?.screen_name || null,
            url: raw.user?.screen_name ? `https://x.com/${raw.user.screen_name}` : null,
            avatar: raw.user?.profile_image_url_https || null,
            verified: !!raw.user?.verified,
            verification_type: raw.user?.is_blue_verified ? 'blue' : null,
            followers: null,
            following: null,
            likes: null,
            media_count: null,
            joined: null,
            protected: false,
        },
        stats: {
            like: raw.favorite_count ?? null,
            comment: raw.conversation_count ?? null,
            save: null,
            retweet: raw.retweet_count ?? null,
            quote: raw.quote_count ?? null,
            view: null,
        },
        media,
        has_video: !!raw.video || media.some((m: any) => m.type === 'video' || m.type === 'gif'),
        note_tweet: null,
    };
}

function normalizeVx(raw: any): any {
    const caption = stripTco(raw.text || '');
    const media = (raw.media_extended || []).map((m: any, i: number) => {
        const variants = buildVariants([{ url: m.url, content_type: m.type === 'video' ? 'video/mp4' : null }]);
        return {
            index: i + 1,
            id: m.id_str || null,
            type: m.type || 'photo',
            width: m.size?.width || null,
            height: m.size?.height || null,
            duration_seconds: m.duration_millis ? Math.round(m.duration_millis / 100) / 10 : null,
            thumbnail: m.type === 'photo' ? photoCdn(m.thumbnail_url || m.url) : m.thumbnail_url || null,
            alt_text: m.altText || null,
            cdn_url: bestCdn(variants) || (m.type === 'photo' ? photoCdn(m.url) : m.url) || null,
            variants,
        };
    });

    return {
        source: 'vxtwitter',
        id: raw.tweetID,
        url: raw.tweetURL || null,
        created_at: raw.date || null,
        created_timestamp: raw.date_epoch || null,
        lang: raw.lang || null,
        possibly_sensitive: !!raw.possibly_sensitive,
        community_note: raw.communityNote || null,
        caption: { text: caption, raw: raw.text || null, ...extractEntities(caption) },
        author: {
            id: null,
            name: raw.user_name || null,
            username: raw.user_screen_name || null,
            url: raw.user_screen_name ? `https://x.com/${raw.user_screen_name}` : null,
            avatar: raw.user_profile_image_url || null,
            verified: false,
            verification_type: null,
            followers: null,
            following: null,
            likes: null,
            media_count: null,
            joined: null,
            protected: false,
        },
        stats: {
            like: raw.likes ?? null,
            comment: raw.replies ?? null,
            save: null,
            retweet: raw.retweets ?? null,
            quote: null,
            view: null,
        },
        media,
        has_video: media.some((m: any) => m.type === 'video' || m.type === 'gif'),
        note_tweet: null,
    };
}

async function fetchFx(id: string): Promise<any> {
    const res = await http.get(`https://api.fxtwitter.com/status/${id}`);
    if (res.status !== 200 || res.data?.code !== 200 || !res.data?.tweet) {
        throw new Error(`fxtwitter http ${res.status}`);
    }
    return normalizeFx(res.data);
}

async function fetchSynd(id: string): Promise<any> {
    const token = syndicationToken(id);
    const res = await http.get('https://cdn.syndication.twimg.com/tweet-result', {
        params: { id, token, lang: 'id' },
    });
    if (res.status !== 200 || !res.data || res.data.__typename === 'TweetTombstone') {
        throw new Error(`syndication http ${res.status}`);
    }
    return normalizeSynd(res.data);
}

async function fetchVx(id: string, screen: string | null): Promise<any> {
    const res = await http.get(`https://api.vxtwitter.com/${screen || 'i'}/status/${id}`, {
        headers: { 'User-Agent': 'TwitterAndroid/10.45.1' },
    });
    if (res.status !== 200 || !res.data?.tweetID) throw new Error(`vxtwitter http ${res.status}`);
    return normalizeVx(res.data);
}

function merge(primary: any, extras: any[]): any {
    const out = { ...primary };
    const sources = [primary.source];

    out.stats = { ...primary.stats };
    for (const e of extras) {
        if (!e) continue;
        sources.push(e.source);
        for (const k of Object.keys(out.stats)) {
            if (out.stats[k] === null || out.stats[k] === undefined) out.stats[k] = e.stats[k] ?? null;
        }
        if (!out.author.avatar) out.author.avatar = e.author.avatar;
        if (!out.author.verified && e.author.verified) {
            out.author.verified = true;
            out.author.verification_type = e.author.verification_type;
        }
        if (out.author.followers === null) out.author.followers = e.author.followers;
        if (out.media.length < e.media.length && e.media.length) {
            const byId = new Map<any, any>(e.media.map((m: any) => [m.id, m]));
            for (const m of out.media) if (m.id && byId.has(m.id)) Object.assign(m, { ...byId.get(m.id), index: m.index });
            if (!out.media.length) out.media = e.media;
        }
    }

    out.sources = [...new Set(sources)];
    return out;
}

async function verifyCdn(url: string | null): Promise<any> {
    if (!url) return { ok: false, error: 'tidak ada cdn url' };
    try {
        const res = await axios.head(url, {
            headers: { 'User-Agent': UA_BROWSER, Referer: 'https://x.com/' },
            timeout: 15000,
            maxRedirects: 5,
            validateStatus: (s: number) => s < 500,
            ...proxyConf(),
        });
        return {
            ok: res.status >= 200 && res.status < 300,
            status: res.status,
            content_type: res.headers['content-type'] || null,
            content_length: Number(res.headers['content-length']) || null,
            error: res.status >= 400 ? `HTTP ${res.status}` : null,
        };
    } catch (e) {
        const err = e as any;
        return { ok: false, error: err.message };
    }
}

async function scrapeTwitter(input: string): Promise<any> {
    const parsed = parseTweetUrl(input);

    const ctx: { id: string; screen: string | null } = { id: parsed.id, screen: parsed.user };
    const attempts: Array<[string, () => Promise<any>]> = [
        ['fxtwitter', () => fetchFx(ctx.id)],
        ['syndication', () => fetchSynd(ctx.id)],
        ['vxtwitter', () => fetchVx(ctx.id, ctx.screen)],
    ];

    const results: any[] = [];
    const errors: any[] = [];
    for (const [name, fn] of attempts) {
        try {
            const r = await fn();
            results.push(r);
            if (!ctx.screen && r.author?.username) ctx.screen = r.author.username;
        } catch (e) {
            const err = e as any;
            errors.push({ source: name, error: err.message });
        }
        if (results.length >= 2 && results[0]?.source === 'fxtwitter') break;
    }

    if (!results.length) throw new Error(`Gagal mengambil tweet: ${errors.map((e) => `${e.source}(${e.error})`).join(', ')}`);

    const primary = results[0];
    const merged = merge(primary, results.slice(1));

    const cdnUrl =
        merged.media.find((m: any) => m.type === 'video' || m.type === 'gif')?.cdn_url ||
        merged.media[0]?.cdn_url ||
        null;

    const hdUrl =
        merged.media
            .flatMap((m: any) => m.variants)
            .filter((v: any) => v.type === 'mp4' && v.resolution && Number(v.resolution.split('x')[0]) >= 720)
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url || cdnUrl;

    // verifikasi best + tiap media (paralel)
    const uniq: string[] = [...new Set(merged.media.map((m: any) => m.cdn_url).filter(Boolean))] as string[];
    const checks = await Promise.all(uniq.map((u) => verifyCdn(u)));
    const checkMap = new Map(uniq.map((u, i) => [u, checks[i]]));
    merged.media.forEach((m: any) => { m.verification = checkMap.get(m.cdn_url) || null; });

    const verification = await verifyCdn(cdnUrl);

    return {
        ok: true,
        input,
        tweet: {
            id: merged.id,
            url: merged.url || parsed.url,
            created_at: merged.created_at,
            created_timestamp: merged.created_timestamp,
            lang: merged.lang,
            possibly_sensitive: merged.possibly_sensitive,
            community_note: merged.community_note,
            caption: merged.caption,
            author: merged.author,
            stats: merged.stats,
            has_video: merged.has_video,
            note_tweet: merged.note_tweet,
        },
        media: merged.media,
        cdn: {
            best: cdnUrl,
            hd: hdUrl,
            thumbnail: merged.media.find((m: any) => m.thumbnail)?.thumbnail || null,
            count: merged.media.length,
        },
        verification,
        source: merged.sources,
        errors: errors.length ? errors : undefined,
        fetched_at: new Date().toISOString(),
    };
}

// ---------- proxy (header-free stream) ----------

function proxyLink(req: Request, mediaUrl: string, filename: string): string {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.get('host'));
    return `${proto}://${host}/api/download/twitter?dl=${b64urlEncode(mediaUrl)}&fn=${encodeURIComponent(filename)}`;
}

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'twitter.bin');

    let mediaUrl: string;
    try {
        mediaUrl = b64urlDecode(dlParam);
    } catch {
        res.status(400).json({ success: false, error: 'Parameter dl tidak valid' });
        return;
    }

    if (!isAllowedMediaHost(mediaUrl)) {
        res.status(400).json({ success: false, error: 'Host media tidak diizinkan' });
        return;
    }

    const range = req.headers.range;
    const headers: Record<string, string> = {
        'User-Agent': UA_BROWSER,
        Referer: 'https://x.com/',
    };
    if (range) headers.Range = String(range);

    const upstream = await axios.get(mediaUrl, {
        responseType: 'stream',
        ...proxyConf(),
        timeout: 30000,
        decompress: false,
        validateStatus: (s: number) => s < 400,
        maxRedirects: 5,
        headers,
    });

    const h: any = upstream.headers || {};
    if (h['content-type']) res.setHeader('Content-Type', String(h['content-type']));
    if (h['content-length']) res.setHeader('Content-Length', String(h['content-length']));
    if (h['content-range']) res.setHeader('Content-Range', String(h['content-range']));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/["\\]/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');

    res.status(upstream.status);
    upstream.data.on('error', () => { try { res.end(); } catch { /* noop */ } });
    upstream.data.pipe(res);
}

// ---------- handler ----------

export default async function twitterHandler(req: Request, res: Response) {
    try {
        if (req.query.dl !== undefined && req.query.dl !== '') {
            await proxyMedia(req, res);
            return;
        }

        const input = String(req.query.url || req.query.id || (req.body && (req.body as any).url) || '');
        if (!input) {
            res.status(400).json({ success: false, error: 'Parameter url / id wajib diisi' });
            return;
        }

        const r = await scrapeTwitter(input);
        const uname = sanitizeName(r.tweet?.author?.username || 'x');
        const tid = String(r.tweet?.id || 'tweet');
        const type = r.tweet?.has_video
            ? (r.media.length > 1 ? 'slide' : 'video')
            : (r.media.length > 1 ? 'slide' : 'image');

        const extOf = (u: string | null, fallback: string): string => {
            const m = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(String(u || ''));
            return m ? '.' + m[1].toLowerCase() : fallback;
        };

        r.media.forEach((m: any) => {
            const isVid = m.type === 'video' || m.type === 'gif';
            const ext = isVid ? '.mp4' : extOf(m.cdn_url, '.jpg');
            const fn = sanitizeName(`twitter_${uname}_${tid}_${m.index}${ext}`);
            m.download = m.cdn_url ? { proxy: proxyLink(req, m.cdn_url, fn), filename: fn } : null;
            (m.variants || []).forEach((v: any, vi: number) => {
                if (v.type !== 'mp4' || !v.url) { v.download = null; return; }
                const label = v.resolution ? v.resolution.split('x')[0] + 'p' : `v${vi + 1}`;
                const vfn = sanitizeName(`twitter_${uname}_${tid}_${m.index}_${label}.mp4`);
                v.download = { proxy: proxyLink(req, v.url, vfn), filename: vfn };
            });
        });

        res.json({ success: true, kind: 'tweet', type, ...r });
    } catch (e) {
        const err = e as any;
        res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
}
