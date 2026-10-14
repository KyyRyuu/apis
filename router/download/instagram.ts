/*
 * Instagram Downloader
 * type: Scraper + Proxy
 * base url: instagram.com (embed + page scrape, tanpa login)
 * author: wa.me/ikyykzy
 * note: buat download video & image. support slide, tidak support story.
 *       SEMUA url media di-response sudah dibungkus link proxy (field "proxy") supaya
 *       user TIDAK perlu set header (User-Agent/Referer/Range) sendiri -> tinggal klik.
 */
import { Request, Response } from 'express';
import axios from 'axios';

const UA_CRAWLER = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const APP_ID = '936619743392459';

const http = axios.create({ timeout: 25000, maxRedirects: 5, validateStatus: (s: number) => s < 500 });

const htmlHeaders = (referer: string): Record<string, string> => ({
    'User-Agent': UA_CRAWLER,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'x-ig-app-id': APP_ID,
    Referer: referer,
});

const cdnHeaders = (): Record<string, string> => ({ 'User-Agent': UA_BROWSER, Referer: 'https://www.instagram.com/' });

const CDN_SUFFIXES = ['fbcdn.net', 'cdninstagram.com', 'instagram.com'];

function proxyConf(): Record<string, any> {
    const raw = process.env.INSTAGRAM_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
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
        const host = new URL(mediaUrl).hostname.toLowerCase();
        return CDN_SUFFIXES.some((sfx) => host === sfx || host.endsWith('.' + sfx));
    } catch {
        return false;
    }
}

const firstDefined = (...vals: any[]): any => {
    for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
    return null;
};

function parseUrl(input: string): any {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('URL kosong');

    let u: URL;
    try {
        u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        throw new Error(`URL tidak valid: ${raw}`);
    }

    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) {
        throw new Error(`Host bukan instagram.com: ${u.hostname}`);
    }

    const segs = u.pathname.split('/').filter(Boolean);
    const containers = ['reel', 'reels', 'p', 'tv', 'embed'];

    let shortcode: string | null = null;
    let kind: string | null = null;

    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const low = seg.toLowerCase();

        if (containers.includes(low)) {
            const next = segs[i + 1];
            if (next && !containers.includes(next.toLowerCase())) {
                kind = low === 'reels' ? 'reel' : low === 'embed' ? null : low;
                shortcode = next;
            }
            continue;
        }

        if (!shortcode && /^[A-Za-z0-9_-]{5,}$/.test(seg)) {
            shortcode = seg;
            kind = kind || 'reel';
        }
    }

    if (!shortcode) throw new Error(`Shortcode tidak ditemukan pada URL: ${raw}`);

    const type = kind === 'p' ? 'post' : kind === 'tv' ? 'igtv' : 'reel';
    const path = type === 'post' ? 'p' : type === 'igtv' ? 'tv' : 'reel';
    const imgIndex = Number(u.searchParams.get('img_index'));

    return {
        input: raw,
        shortcode,
        type,
        index: Number.isInteger(imgIndex) && imgIndex >= 1 ? imgIndex : null,
        permalink: `https://www.instagram.com/${path}/${shortcode}/`,
        embedUrl: `https://www.instagram.com/${path}/${shortcode}/embed/`,
    };
}

function balancedSlice(text: string, from: number): string | null {
    let i = from;
    while (i >= 0 && text[i] !== '{' && text[i] !== '[') i--;
    if (i < 0) return null;

    let depth = 0;
    let inStr = false;
    let esc = false;

    for (let j = i; j < text.length; j++) {
        const c = text[j];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') {
            depth--;
            if (depth === 0) return text.slice(i, j + 1);
        }
    }
    return null;
}

function parseRoots(html: string): any[] {
    const roots: any[] = [];

    for (const tag of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
        try { roots.push(JSON.parse(tag[1])); } catch { /* skip */ }
    }

    for (const tag of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
        const body = tag[1];
        const handle = body.match(/\.handle\(/);
        if (handle && handle.index !== undefined) {
            const slice = balancedSlice(body, handle.index + handle[0].length);
            if (slice) {
                try { roots.push(JSON.parse(slice)); } catch { /* skip */ }
            }
        }
    }

    return roots;
}

function collectStrings(node: any, needle: string, out: string[], depth: number): void {
    if (depth > 24 || !node || typeof node !== 'object') return;
    for (const value of Object.values(node)) {
        if (typeof value === 'string') {
            if (value.includes(needle)) out.push(value);
        } else if (typeof value === 'object') {
            collectStrings(value, needle, out, depth + 1);
        }
    }
}

function isMediaNode(node: any): boolean {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    return Array.isArray(node.video_versions)
        || node.video_view_count !== undefined
        || !!node.video_dash_manifest
        || Array.isArray(node.image_versions2)
        || Array.isArray(node.carousel_media)
        || typeof node.display_url === 'string'
        || typeof node.display_uri === 'string';
}

function collectMedia(node: any, seen: Set<any>, depth: number): void {
    if (depth > 26 || !node || typeof node !== 'object') return;
    if (isMediaNode(node)) seen.add(node);
    for (const value of Object.values(node)) collectMedia(value, seen, depth + 1);
}

function mediaScore(node: any, wanted: string): number {
    let score = 0;
    const code = String(node.code || node.shortcode || '').toLowerCase();
    if (code) score += 40;
    if (code === wanted) score += 1000;
    if (Array.isArray(node.video_versions) && node.video_versions.length) score += 10;
    if (Array.isArray(node.image_versions2)) score += 10;
    if (node.caption || node.edge_media_to_caption) score += 5;
    if (node.taken_at) score += 5;
    return score;
}

function findMedia(html: string, shortcode: string): any {
    const roots = parseRoots(html);
    const seen = new Set<any>();

    for (const root of roots) {
        collectMedia(root, seen, 0);
        for (const needle of ['video_view_count', 'video_versions', 'video_dash_manifest', 'image_versions2', 'display_uri']) {
            const strings: string[] = [];
            collectStrings(root, needle, strings, 0);
            for (const raw of strings) {
                let value: any = raw;
                for (let i = 0; i < 3; i++) {
                    try { value = JSON.parse(value); } catch { break; }
                }
                collectMedia(value, seen, 0);
            }
        }
    }

    const wanted = String(shortcode).toLowerCase();
    let best: any = null;
    let bestScore = -1;
    for (const node of seen) {
        const score = mediaScore(node, wanted);
        if (score > bestScore) {
            best = node;
            bestScore = score;
        }
    }
    return best;
}

function decodeXmlEntities(text: any): string {
    return String(text)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\\//g, '/');
}

function attrMap(text: any): Record<string, string> {
    const map: Record<string, string> = {};
    for (const m of String(text).matchAll(/([\w:.-]+)="([^"]*)"/g)) map[m[1]] = m[2];
    return map;
}

function parseDash(manifest: any): any {
    const result: any = { audio: [], video: [], raw: manifest || null };
    if (!manifest) return result;

    for (const set of String(manifest).matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/g)) {
        const setAttrs = attrMap(set[1]);
        const contentType = (setAttrs.contentType || '').toLowerCase();
        if (contentType !== 'audio' && contentType !== 'video') continue;

        for (const rep of set[2].matchAll(/<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/g)) {
            const repAttrs = attrMap(rep[1]);
            const baseUrl = (rep[2].match(/<BaseURL>([\s\S]*?)<\/BaseURL>/) || [])[1];
            if (!baseUrl) continue;

            const entry = {
                id: repAttrs.id || null,
                bandwidth_bps: Number(repAttrs.bandwidth || 0) || null,
                codecs: repAttrs.codecs || null,
                mime_type: repAttrs.mimeType || null,
                sample_rate_hz: repAttrs.audioSamplingRate ? Number(repAttrs.audioSamplingRate) : null,
                encoding_tag: repAttrs.FBEncodingTag || null,
                url: decodeXmlEntities(baseUrl.trim()),
            };

            if (contentType === 'audio') result.audio.push(entry);
            else result.video.push(entry);
        }
    }

    result.audio.sort((a: any, b: any) => (b.bandwidth_bps || 0) - (a.bandwidth_bps || 0));
    result.video.sort((a: any, b: any) => (b.bandwidth_bps || 0) - (a.bandwidth_bps || 0));
    return result;
}

function bestImage(node: any): any {
    if (!node || typeof node !== 'object') return null;
    const candidates = Array.isArray(node.image_versions2?.candidates) ? node.image_versions2.candidates : [];
    let best: any = null;
    for (const c of candidates) {
        if (!c || typeof c.url !== 'string' || !c.url) continue;
        const area = (Number(c.width) || 0) * (Number(c.height) || 0);
        if (!best || area > best.area) {
            best = { url: decodeXmlEntities(c.url), area, width: c.width ?? null, height: c.height ?? null };
        }
    }
    if (best) return { url: best.url, width: best.width, height: best.height };

    const fallback = firstDefined(node.display_url, node.display_uri, null);
    if (!fallback) return null;
    return {
        url: decodeXmlEntities(fallback),
        width: node.original_width ?? null,
        height: node.original_height ?? null,
    };
}

function itemList(node: any): any[] {
    const kids = Array.isArray(node?.carousel_media) && node.carousel_media.length
        ? node.carousel_media
        : Array.isArray(node?.edge_sidecar_to_children?.edges)
            ? node.edge_sidecar_to_children.edges.map((x: any) => x?.node).filter(Boolean)
            : [];
    return kids.length ? kids : [node];
}

function collectItems(node: any): any[] {
    return itemList(node).map((item: any) => {
        const dash = parseDash(item?.video_dash_manifest || item?.dash_manifest || '');
        const versions = (Array.isArray(item?.video_versions) ? item.video_versions : [])
            .filter((v: any) => v && typeof v.url === 'string' && v.url)
            .sort((a: any, b: any) => (b.type || 0) - (a.type || 0));

        const video = versions.length
            ? decodeXmlEntities(versions[0].url)
            : dash.video[0]?.url || (typeof item?.video_url === 'string' ? decodeXmlEntities(item.video_url) : null);

        const image = video ? null : bestImage(item);

        return {
            is_video: Boolean(video) || Boolean(item?.is_video),
            video,
            audio: dash.audio[0]?.url || null,
            image,
        };
    });
}

function detectContainer(buf: any): { is_container: boolean; format: string | null; brand: string | null } {
    if (!buf || buf.length < 12) return { is_container: false, format: null, brand: null };

    const box = buf.slice(4, 8).toString('latin1');
    if (box === 'ftyp') {
        const brand = buf.slice(8, 12).toString('latin1').replace(/\0/g, '').trim();
        return { is_container: true, format: 'ISO-BMFF (mp4 / m4a / mov)', brand: brand || null };
    }
    if (buf.slice(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
        return { is_container: true, format: 'MPEG audio (mp3)', brand: null };
    }
    if (buf[0] === 0x89 && buf.slice(1, 4).toString('latin1') === 'PNG') {
        return { is_container: true, format: 'PNG image', brand: null };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        return { is_container: true, format: 'JPEG image', brand: null };
    }
    if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
        return { is_container: true, format: 'WebP image', brand: null };
    }
    return { is_container: false, format: null, brand: box };
}

async function verifyMediaUrl(url: string | null): Promise<any> {
    const result: any = { url: url || null, ok: false, head_ok: false, download_ok: false };

    if (!url) {
        result.error = 'URL tidak tersedia';
        return result;
    }

    try {
        const head = await http.head(url, { headers: cdnHeaders(), ...proxyConf() } as any);
        result.status = head.status;
        result.content_type = head.headers['content-type'] || null;
        result.content_length = Number(head.headers['content-length'] || 0) || null;
        result.accept_ranges = head.headers['accept-ranges'] || null;
        result.head_ok = head.status === 200 || head.status === 206;
    } catch (err) {
        result.error = (err as any).message;
    }

    try {
        const res = await http.get(url, {
            headers: { ...cdnHeaders(), Range: 'bytes=0-2047' },
            responseType: 'arraybuffer',
            ...proxyConf(),
        } as any);
        const buf = Buffer.from(res.data || []);
        result.range_status = res.status;
        result.bytes_sampled = buf.length;
        result.container = detectContainer(buf);
        result.download_ok = (res.status === 200 || res.status === 206) && buf.length > 0;
    } catch (err) {
        result.error = result.error || (err as any).message;
    }

    result.ok = Boolean((result.head_ok || result.download_ok) && result.container?.is_container);
    return result;
}

async function fetchTopComments(shortcode: string, referer: string): Promise<any[] | null> {
    const queries: Array<[string, string]> = [
        ['PolarisPostCommentsQuery', '8845758582119845'],
        ['PolarisPostCommentsQuery', '7898261790222653'],
        ['PolarisPostCommentsQuery', '7641767663676591'],
        ['PolarisPostRootCommentsQuery', '8778314485634597'],
    ];

    for (const [friendlyName, docId] of queries) {
        try {
            const body = new URLSearchParams({
                av: '0',
                __d: 'www',
                __user: '0',
                __a: '1',
                __req: '1',
                fb_api_caller_class: 'RelayModern',
                fb_api_req_friendly_name: friendlyName,
                variables: JSON.stringify({ shortcode, first: 10, after: null, data: { count: 10 } }),
                server_timestamps: 'true',
                doc_id: docId,
            }).toString();

            const res = await http.post('https://www.instagram.com/graphql/query', body, {
                headers: {
                    ...htmlHeaders(referer),
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                ...proxyConf(),
            } as any);

            if (typeof res.data !== 'object' || !res.data) continue;

            const root = findCommentsRoot(res.data, 0);
            if (!root) continue;

            const edges = Array.isArray(root.edges) ? root.edges : [];
            return edges
                .filter((e: any) => e && e.node)
                .map((e: any) => ({
                    id: firstDefined(e.node.id, String(e.node.pk || '')),
                    username: firstDefined(e.node.owner?.username, e.node.user?.username),
                    text: e.node.text || '',
                    created_at_unix: e.node.created_at ?? e.node.created_at_utc ?? null,
                    created_at_iso: e.node.created_at ? new Date(e.node.created_at * 1000).toISOString() : null,
                    like_count: firstDefined(e.node.edge_liked_by?.count, e.node.comment_like_count),
                    reply_count: firstDefined(e.node.child_comment_count),
                    is_pinned: Boolean(e.node.is_pinned),
                }));
        } catch { /* next docId */ }
    }

    return null;
}

function findCommentsRoot(node: any, depth: number): any {
    depth = depth || 0;
    if (depth > 14 || !node || typeof node !== 'object') return null;
    if (Array.isArray(node.edges)) return node;
    for (const value of Object.values(node)) {
        const found = findCommentsRoot(value, depth + 1);
        if (found) return found;
    }
    return null;
}

function extractTags(text: any): { hashtags: string[]; mentions: string[] } {
    const hashtags: string[] = [];
    const mentions: string[] = [];
    for (const m of String(text || '').matchAll(/#([\p{L}\p{N}_]{1,80})/gu)) {
        if (!hashtags.includes(m[1])) hashtags.push(m[1]);
    }
    for (const m of String(text || '').matchAll(/@([A-Za-z0-9._]{1,30})/g)) {
        if (!mentions.includes(m[1])) mentions.push(m[1]);
    }
    return { hashtags, mentions };
}

function slimCheck(result: any): any {
    if (!result) return null;
    return {
        ok: Boolean(result.ok),
        status: result.status ?? null,
        content_type: result.content_type ?? null,
        content_length: result.content_length ?? null,
        error: result.error ?? null,
    };
}

function toIso(unix: any): string | null {
    if (unix === null || unix === undefined) return null;
    const n = Number(unix);
    if (!Number.isFinite(n)) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function instagramDL(inputUrl: string): Promise<any> {
    const target = parseUrl(inputUrl);
    const startedAt = new Date().toISOString();

    const [embedRes, pageRes] = await Promise.allSettled([
        http.get(target.embedUrl, { headers: htmlHeaders(target.permalink), ...proxyConf() } as any),
        http.get(target.permalink, { headers: htmlHeaders(target.embedUrl), ...proxyConf() } as any),
    ]);

    const embedHtml = embedRes.status === 'fulfilled' ? String(embedRes.value.data || '') : '';
    const pageHtml = pageRes.status === 'fulfilled' ? String(pageRes.value.data || '') : '';

    const embed = embedHtml ? findMedia(embedHtml, target.shortcode) : null;
    const polaris = pageHtml ? findMedia(pageHtml, target.shortcode) : null;

    if (!embed && !polaris) {
        const err = new Error('Data media tidak ditemukan. Post mungkin privat, terhapus, atau Instagram mengubah format respons.') as any;
        err.detail = {
            embed_status: embedRes.status === 'fulfilled' ? embedRes.value.status : null,
            page_status: pageRes.status === 'fulfilled' ? pageRes.value.status : null,
            embed_bytes: embedHtml.length,
            page_bytes: pageHtml.length,
        };
        throw err;
    }

    const e = embed || {};
    const p = polaris || {};

    const usable = (node: any): any[] => collectItems(node).filter((i) => i.video || i.image);

    let items = usable(p);
    if (!items.length) items = usable(e);

    if (target.index && items.length < target.index) {
        try {
            const retry = await http.get(`${target.permalink}?img_index=${target.index}`, {
                headers: htmlHeaders(target.embedUrl),
            } as any);
            const retryMedia = findMedia(String(retry.data || ''), target.shortcode);
            const retryItems = retryMedia ? usable(retryMedia) : [];
            if (retryItems.length >= target.index) items = retryItems;
        } catch { /* abaikan */ }
    }

    const videos = items.filter((i) => i.video);
    const images = items.filter((i) => i.image && i.image.url);
    const audioOnly = items.flatMap((i) => (i.audio ? [i.audio] : []));

    const primaryVideo = videos[0]?.video || null;
    const primaryAudio = audioOnly[0] || null;
    const picked = target.index && target.index <= items.length ? items[target.index - 1] : null;
    const pickedUrl = picked ? picked.image?.url || picked.video || null : null;

    const coverItem = images[0] || null;
    const bestThumb = (() => {
        if (coverItem) return { url: coverItem.image.url, width: coverItem.image.width, height: coverItem.image.height };
        const thumbs = Array.isArray(e.thumbnail_resources) ? e.thumbnail_resources : [];
        const sizes = thumbs.map((t: any) => t.config_width || 0);
        const best = thumbs[sizes.indexOf(Math.max(...sizes))];
        return {
            url: firstDefined(e.display_url, p.display_uri, best?.src, null),
            width: firstDefined(best?.config_width, e.dimensions?.width, p.original_width),
            height: firstDefined(best?.config_height, e.dimensions?.height, p.original_height),
        };
    })();

    const like = firstDefined(e.edge_liked_by?.count, p.like_count);
    const view = firstDefined(e.video_view_count, e.play_count, e.view_count, p.play_count, p.view_count);
    const commentCount = firstDefined(e.edge_media_to_comment?.count, p.comment_count);

    const captionText = firstDefined(
        e.edge_media_to_caption?.edges?.[0]?.node?.text,
        p.caption?.text,
        e.caption?.text
    ) || '';
    const tags = extractTags(captionText);

    const music = e.clips_music_attribution_info || p.clips_metadata || null;
    const originalSound = music?.original_sound_info || null;
    const musicInfo = music?.music_info || null;

    const owner = e.owner || p.user || {};

    let topComments: any[] | null = null;
    let commentsError: string | null = null;
    if (commentCount && commentCount > 0) {
        try {
            topComments = await fetchTopComments(target.shortcode, target.permalink);
            if (topComments === null) commentsError = 'endpoint_komentar_login_wall';
        } catch (err) {
            commentsError = (err as any).message;
        }
    } else if (commentCount === 0) {
        topComments = [];
    }

    const result: any = {
        success: true,
        scraped_at: startedAt,
        source_url: target.input,
        shortcode: firstDefined(e.shortcode, e.code, p.code, target.shortcode),
        type: target.type,
        permalink: target.permalink,
        url: {
            video: primaryVideo,
            audio: primaryAudio,
            thumbnail: images.length ? null : bestThumb.url,
            images: images.map((i) => i.image.url),
            ...(pickedUrl ? { image: pickedUrl } : {}),
            ...(videos.length > 1 ? { videos: videos.map((i) => i.video) } : {}),
        },
        caption: {
            text: captionText,
            hashtags: tags.hashtags,
            mentions: tags.mentions,
        },
        author: {
            username: firstDefined(owner.username, null),
            id: firstDefined(owner.id, owner.pk, null),
            is_verified: firstDefined(owner.is_verified, false),
            followers: firstDefined(owner.edge_followed_by?.count, null),
            url: firstDefined(owner.username, null) ? `https://www.instagram.com/${owner.username}/` : null,
        },
        posted_at: toIso(firstDefined(p.taken_at, null)),
        stats: {
            like: like,
            view: view,
            comment: commentCount,
        },
        music: {
            title: firstDefined(music?.song_name, originalSound?.original_audio_title, musicInfo?.music_asset_info?.title, null),
            artist: firstDefined(music?.artist_name, originalSound?.ig_artist?.username, musicInfo?.music_asset_info?.display_artist, null),
        },
        media: {
            media_type: firstDefined(p.media_type, e.is_video ? 2 : null, images.length ? 1 : null, null),
            duration_seconds: firstDefined(e.video_duration, null),
            width: firstDefined(bestThumb.width, e.dimensions?.width, p.original_width, null),
            height: firstDefined(bestThumb.height, e.dimensions?.height, p.original_height, null),
            item_count: items.length,
            item_index: target.index,
            is_carousel: items.length > 1,
        },
        comments: {
            available: Array.isArray(topComments),
            count: commentCount,
            top: topComments,
            reason: Array.isArray(topComments)
                ? undefined
                : commentsError || 'Komentar tidak dapat diambil tanpa login (Instagram membatasi endpoint komentar untuk sesi anonim).',
        },
    };

    const videoCheck = result.url.video ? await verifyMediaUrl(result.url.video) : null;
    const audioCheck = result.url.audio ? await verifyMediaUrl(result.url.audio) : null;
    const imageUrls = [...result.url.images, result.url.thumbnail].filter(Boolean);
    const imageCheck = imageUrls.length ? await verifyMediaUrl(imageUrls[0]) : null;

    result.verification = {
        video: slimCheck(videoCheck),
        audio: slimCheck(audioCheck),
        image: slimCheck(imageCheck),
        images_checked: imageUrls.length,
        all_cdn_ok: Boolean(
            (videoCheck ? videoCheck.ok : true)
            && (audioCheck ? audioCheck.ok : true)
            && (imageCheck ? imageCheck.ok : true)
        ),
    };

    return result;
}

// ---------- proxy (header-free stream) ----------

function proxyLink(req: Request, mediaUrl: string, filename: string): string {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.get('host'));
    return `${proto}://${host}/api/download/instagram?dl=${b64urlEncode(mediaUrl)}&fn=${encodeURIComponent(filename)}`;
}

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'instagram.bin');

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
        Referer: 'https://www.instagram.com/',
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

export default async function instagramHandler(req: Request, res: Response) {
    try {
        if (req.query.dl !== undefined && req.query.dl !== '') {
            await proxyMedia(req, res);
            return;
        }

        const input = String(req.query.url || (req.body && (req.body as any).url) || '');
        if (!input) {
            res.status(400).json({ success: false, error: 'Parameter url wajib diisi' });
            return;
        }

        const r = await instagramDL(input);
        const tag = sanitizeName(r.author?.username || r.shortcode || 'instagram');
        const extOf = (u: string | null, fallback: string): string => {
            const m = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(String(u || ''));
            return m ? '.' + m[1].toLowerCase() : fallback;
        };
        const wrap = (u: string | null, fn: string): any =>
            u ? { url: u, proxy: proxyLink(req, u, fn), filename: fn } : null;

        r.download = {
            video: wrap(r.url.video, sanitizeName(`instagram_${tag}_${r.shortcode}.mp4`)),
            audio: wrap(r.url.audio, sanitizeName(`instagram_${tag}_${r.shortcode}.mp3`)),
            thumbnail: wrap(r.url.thumbnail, sanitizeName(`instagram_${tag}_${r.shortcode}_thumb.jpg`)),
            images: (r.url.images || []).map((u: string, i: number) =>
                wrap(u, sanitizeName(`instagram_${tag}_${r.shortcode}_${i + 1}${extOf(u, '.jpg')}`))),
        };
        if (r.url.image) r.download.picked = wrap(r.url.image, sanitizeName(`instagram_${tag}_${r.shortcode}_picked${extOf(r.url.image, '.jpg')}`));
        if (r.url.videos) r.download.videos = r.url.videos.map((u: string, i: number) =>
            wrap(u, sanitizeName(`instagram_${tag}_${r.shortcode}_v${i + 1}.mp4`)));

        res.json({ success: true, kind: 'instagram', ...r });
    } catch (e) {
        const err = e as any;
        res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
}
