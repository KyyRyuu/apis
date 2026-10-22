/*
 * Threads Downloader
 * type: Scraper
 * base url: threads.com
 * author: wa.me/ikyykzy
 * note: ambil cdn url + full statistik (caption, like, comment/reply, repost, quote, reshare, dll).
 *       support image, video, carousel (& text post + linked carousel/embed).
 *       tanpa login, pakai SSR HTML (mobile UA) + RelayPrefetchedStreamCache.
 */
import { Request, Response } from 'express';
import axios from 'axios';
import { cdnLink } from '../../src/cdn';

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const http = axios.create({ timeout: 30000, maxRedirects: 5, validateStatus: (s) => s < 500 });

const htmlHeaders = (referer?: string) => ({
    'User-Agent': UA_MOBILE,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(referer ? { Referer: referer } : {}),
});

const cdnHeaders = () => ({ 'User-Agent': UA_BROWSER, Referer: 'https://www.threads.com/' });

const firstDefined = (...vals: any[]) => {
    for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
    return null;
};

function parseUrl(input: string) {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('URL kosong');

    let u: URL;
    try {
        u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        throw new Error(`URL tidak valid: ${raw}`);
    }

    if (!/(^|\.)threads\.com$/i.test(u.hostname) && !/(^|\.)threads\.net$/i.test(u.hostname)) {
        throw new Error(`Host bukan threads.com: ${u.hostname}`);
    }

    const segs = u.pathname.split('/').filter(Boolean);
    let token: string | null = null;
    const shareIdx = segs.findIndex((s) => s.toLowerCase() === 'share');
    if (shareIdx >= 0 && segs[shareIdx + 1]) token = segs[shareIdx + 1];
    else if (segs[0] && segs[0].toLowerCase() === 't' && segs[1]) token = segs[1];
    else if (segs.length) token = segs[segs.length - 1];

    return { input: raw, token, permalink: raw.split('?')[0] };
}

function decodeEntities(text: string) {
    return String(text || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'");
}

function attrMap(text: string) {
    const map: Record<string, string> = {};
    for (const m of String(text).matchAll(/([\w:.-]+)="([^"]*)"/g)) map[m[1]] = m[2];
    return map;
}

function parseDash(manifest: string) {
    const result: { audio: any[]; video: any[]; raw: string | null } = { audio: [], video: [], raw: manifest || null };
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
                bandwidth_bps: Number(repAttrs.bandwidth || 0) || null,
                codecs: repAttrs.codecs || null,
                mime_type: repAttrs.mimeType || null,
                width: repAttrs.width ? Number(repAttrs.width) : null,
                height: repAttrs.height ? Number(repAttrs.height) : null,
                quality_label: repAttrs.FBQualityLabel || null,
                url: decodeEntities(baseUrl.trim()),
            };
            if (contentType === 'audio') result.audio.push(entry);
            else result.video.push(entry);
        }
    }
    result.audio.sort((a, b) => (b.bandwidth_bps || 0) - (a.bandwidth_bps || 0));
    result.video.sort((a, b) => (b.bandwidth_bps || 0) - (a.bandwidth_bps || 0));
    return result;
}

function bestImage(node: any) {
    if (!node || typeof node !== 'object') return null;
    const candidates = Array.isArray(node.image_versions2?.candidates) ? node.image_versions2.candidates : [];
    let best: { url: string; area: number; width: any; height: any } | null = null;
    for (const c of candidates) {
        if (!c || typeof c.url !== 'string' || !c.url) continue;
        const area = (Number(c.width) || 0) * (Number(c.height) || 0);
        if (!best || area > best.area) best = { url: c.url, area, width: c.width ?? null, height: c.height ?? null };
    }
    if (best) return { url: best.url, width: best.width, height: best.height };
    return null;
}

function itemFromNode(node: any) {
    const dash = parseDash(node?.video_dash_manifest || '');
    const versions = (Array.isArray(node?.video_versions) ? node.video_versions : [])
        .filter((v: any) => v && typeof v.url === 'string' && v.url);
    const video = versions.length ? versions[0].url : (dash.video[0]?.url || null);
    const image = video ? null : bestImage(node);
    return {
        pk: firstDefined(node?.pk, null),
        code: firstDefined(node?.code, null),
        media_type: firstDefined(node?.media_type, null),
        is_video: Boolean(video),
        has_audio: firstDefined(node?.has_audio, null),
        video,
        video_versions: versions.map((v: any) => ({ type: v.type ?? null, url: v.url })),
        audio: dash.audio[0]?.url || null,
        dash_video: dash.video[0]?.url || null,
        dash_audio: dash.audio[0]?.url || null,
        image,
        width: firstDefined(node?.original_width, (image as any)?.width, null),
        height: firstDefined(node?.original_height, (image as any)?.height, null),
    };
}

function collectItems(media: any) {
    if (Array.isArray(media?.carousel_media) && media.carousel_media.length) {
        return media.carousel_media.map(itemFromNode);
    }
    const linked = media?.text_post_app_info?.linked_inline_media;
    if (linked && Array.isArray(linked.carousel_media) && linked.carousel_media.length) {
        return linked.carousel_media.map(itemFromNode);
    }
    if (linked && (linked.video_versions || linked.image_versions2)) {
        return [itemFromNode(linked)];
    }
    return [itemFromNode(media)];
}

function extractTags(text: string) {
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

function toIso(unix: any) {
    if (unix === null || unix === undefined) return null;
    const n = Number(unix);
    if (!Number.isFinite(n)) return null;
    const d = new Date(n > 1e12 ? n : n * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseJsonScripts(html: string) {
    const out: any[] = [];
    for (const m of String(html).matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
        try { out.push(JSON.parse(m[1])); } catch { /* skip */ }
    }
    return out;
}

function extractPostId(html: string) {
    const m1 = String(html).match(/"post_id":"(\d+)"/);
    if (m1) return m1[1];
    const m2 = String(html).match(/"targetPostID":"(\d+)"/);
    if (m2) return m2[1];
    const m3 = String(html).match(/"postID":"(\d+)"/);
    if (m3) return m3[1];
    return null;
}

function walkCollect(node: any, fn: (n: any, path: string) => void, depth = 0, path = '$') {
    if (depth > 32 || !node || typeof node !== 'object') return;
    try { fn(node, path); } catch { /* ignore */ }
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walkCollect(node[i], fn, depth + 1, `${path}[${i}]`);
    } else {
        for (const k of Object.keys(node)) walkCollect(node[k], fn, depth + 1, `${path}.${k}`);
    }
}

function findMainMedia(roots: any[], postId: string) {
    const holder: { best: { node: any; score: number } | null } = { best: null };
    for (const root of roots) {
        walkCollect(root, (node) => {
            if (!node || typeof node !== 'object' || Array.isArray(node)) return;
            if (String(node.pk || '') !== String(postId)) return;
            if (typeof node.like_count !== 'number') return;
            if (!node.caption || typeof node.caption.text !== 'string') {
                if (!node.text_post_app_info) return;
            }
            if (!node.user || typeof node.user !== 'object') return;
            const score = Object.keys(node).length + (node.code ? 50 : 0);
            if (!holder.best || score > holder.best.score) holder.best = { node, score };
        });
    }
    return holder.best ? holder.best.node : null;
}

function findTopReplies(roots: any[], postId: string) {
    const replies: any[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
        walkCollect(root, (node, path) => {
            if (!path.includes('direct_replies')) return;
            if (!node || typeof node !== 'object' || Array.isArray(node)) return;
            if (typeof node.like_count !== 'number') return;
            if (!node.caption || typeof node.caption.text !== 'string') return;
            if (String(node.pk || '') === String(postId)) return;
            if (!node.user) return;
            const key = String(node.pk || node.id || node.code);
            if (!key || seen.has(key)) return;
            seen.add(key);
            replies.push(node);
        });
    }
    return replies
        .sort((a, b) => (b.like_count || 0) - (a.like_count || 0))
        .slice(0, 10)
        .map((n) => ({
            pk: firstDefined(n.pk, null),
            code: firstDefined(n.code, null),
            username: firstDefined(n.user?.username, null),
            full_name: firstDefined(n.user?.full_name, null),
            text: n.caption?.text || '',
            like_count: firstDefined(n.like_count, null),
            posted_at: toIso(firstDefined(n.taken_at, null)),
        }));
}

function detectContainer(buf: Buffer) {
    if (!buf || buf.length < 12) return { is_container: false, format: null };
    const box = buf.slice(4, 8).toString('latin1');
    if (box === 'ftyp') return { is_container: true, format: 'ISO-BMFF (mp4/mov/m4a)' };
    if (buf.slice(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
        return { is_container: true, format: 'MPEG audio (mp3)' };
    }
    if (buf[0] === 0x89 && buf.slice(1, 4).toString('latin1') === 'PNG') return { is_container: true, format: 'PNG image' };
    if (buf[0] === 0xff && buf[1] === 0xd8) return { is_container: true, format: 'JPEG image' };
    if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
        return { is_container: true, format: 'WebP image' };
    }
    return { is_container: false, format: null as string | null };
}

async function verifyMediaUrl(url: string) {
    const result: any = { url: url || null, ok: false, head_ok: false, download_ok: false };
    if (!url) { result.error = 'URL tidak tersedia'; return result; }
    try {
        const head = await http.head(url, { headers: cdnHeaders() });
        result.status = head.status;
        result.content_type = head.headers['content-type'] || null;
        result.content_length = Number(head.headers['content-length'] || 0) || null;
        result.head_ok = head.status === 200 || head.status === 206;
    } catch (err: any) {
        result.error = err.message;
    }
    try {
        const res = await http.get(url, {
            headers: { ...cdnHeaders(), Range: 'bytes=0-2047' },
            responseType: 'arraybuffer',
        });
        const buf = Buffer.from(res.data || []);
        result.range_status = res.status;
        result.bytes_sampled = buf.length;
        result.container = detectContainer(buf);
        result.download_ok = (res.status === 200 || res.status === 206) && buf.length > 0;
    } catch (err: any) {
        result.error = result.error || err.message;
    }
    result.ok = Boolean((result.head_ok || result.download_ok) && result.container?.is_container);
    return result;
}

function slimCheck(r: any) {
    if (!r) return null;
    return { ok: Boolean(r.ok), status: r.status ?? null, content_type: r.content_type ?? null, content_length: r.content_length ?? null, error: r.error ?? null };
}

function deriveType(media: any, items: any[]) {
    const linked = media?.text_post_app_info?.linked_inline_media;
    if (Array.isArray(media?.carousel_media) && media.carousel_media.length) return 'carousel';
    if (linked && Array.isArray(linked.carousel_media) && linked.carousel_media.length) return 'carousel';
    if (items.some((i: any) => i.is_video)) return items.length > 1 ? 'carousel' : 'video';
    if (items.some((i: any) => i.image)) return items.length > 1 ? 'carousel' : 'image';
    return 'text';
}

export async function threadsDL(inputUrl: string) {
    const target = parseUrl(inputUrl);
    const startedAt = new Date().toISOString();

    const res = await http.get(target.permalink, { headers: htmlHeaders('https://www.threads.com/') });
    if (res.status >= 400) throw new Error(`Gagal fetch Threads (HTTP ${res.status})`);
    const html = String(res.data || '');
    if (html.length < 50000) throw new Error('HTML terlalu kecil, kemungkinan diblokir/CF');

    const postId = extractPostId(html);
    if (!postId) throw new Error('post_id tidak ditemukan di HTML (format berubah / post privat)');

    const roots = parseJsonScripts(html);
    const media = findMainMedia(roots, postId);
    if (!media) throw new Error('Data media utama tidak ditemukan di Relay payload');

    const replies = findTopReplies(roots, postId);
    const items = collectItems(media);
    const linked = media.text_post_app_info?.linked_inline_media || null;

    const videos = items.filter((i: any) => i.video);
    const images = items.filter((i: any) => i.image && i.image.url);
    const primaryImage = images[0]?.image?.url || bestImage(media)?.url || null;

    const uniq = (arr: any[]) => [...new Set(arr.filter(Boolean))];
    const uniqueVideos = uniq(videos.map((v: any) => v.video));
    const uniqueAudios = uniq(items.map((i: any) => i.audio));
    const uniqueImages = uniq(images.map((i: any) => i.image.url));

    const url: any = {};
    if (uniqueVideos.length === 1) url.video = uniqueVideos[0];
    else if (uniqueVideos.length > 1) url.videos = uniqueVideos;
    else url.video = null;
    if (uniqueAudios.length === 1) url.audio = uniqueAudios[0];
    else if (uniqueAudios.length > 1) url.audios = uniqueAudios;
    else url.audio = null;
    url.images = uniqueImages;
    if (!uniqueImages.length && primaryImage) url.thumbnail = primaryImage;

    const captionText = firstDefined(media.caption?.text, '');
    const tags = extractTags(captionText);
    const owner = media.user || {};
    const info = media.text_post_app_info || {};

    const type = deriveType(media, items);

    const result: any = {
        success: true,
        scraped_at: startedAt,
        source_url: target.input,
        permalink: target.permalink,
        post_id: String(media.pk || postId),
        code: firstDefined(media.code, null),
        type,
        canonical_url: firstDefined(media.canonical_url, media.code ? `https://www.threads.com/t/${media.code}` : null),
        url,
        caption: {
            text: captionText,
            hashtags: tags.hashtags,
            mentions: tags.mentions,
        },
        author: {
            username: firstDefined(owner.username, null),
            full_name: firstDefined(owner.full_name, null),
            id: firstDefined(owner.pk, owner.id, null),
            is_verified: firstDefined(owner.is_verified, false),
            profile_pic_url: firstDefined(owner.profile_pic_url, null),
            url: owner.username ? `https://www.threads.com/@${owner.username}` : null,
        },
        posted_at: toIso(firstDefined(media.taken_at, null)),
        posted_at_unix: firstDefined(media.taken_at, null),
        stats: {
            like: firstDefined(media.like_count, null),
            comment: firstDefined(info.direct_reply_count, null),
            reply: firstDefined(info.direct_reply_count, null),
            repost: firstDefined(info.repost_count, null),
            quote: firstDefined(info.quote_count, null),
            reshare: firstDefined(info.reshare_count, null),
        },
        media: {
            media_type: firstDefined(media.media_type, null),
            media_type_label: type,
            width: firstDefined(media.original_width, items[0]?.width, null),
            height: firstDefined(media.original_height, items[0]?.height, null),
            has_audio: firstDefined(media.has_audio, items.some((i: any) => i.has_audio), null),
            item_count: items.length,
            is_carousel: items.length > 1,
            items: items.map((it: any, idx: number) => ({
                index: idx + 1,
                pk: it.pk,
                code: it.code,
                media_type: it.media_type,
                is_video: it.is_video,
                width: it.width,
                height: it.height,
            })),
        },
        linked_post: linked ? {
            pk: firstDefined(linked.pk, null),
            code: firstDefined(linked.code, null),
            username: firstDefined(linked.user?.username, null),
            caption_text: linked.caption?.text || null,
            media_type: firstDefined(linked.media_type, null),
            url: firstDefined(linked.code, null) ? `https://www.instagram.com/p/${linked.code}/` : firstDefined(info.link_preview_attachment?.url, null),
        } : null,
        comments: {
            available: true,
            count: firstDefined(info.direct_reply_count, null),
            top: replies,
        },
    };

    const firstVideo = result.url.video || result.url.videos?.[0] || null;
    const firstImage = result.url.images?.[0] || result.url.thumbnail || null;
    const videoCheck = firstVideo ? await verifyMediaUrl(firstVideo) : null;
    const imageCheck = firstImage ? await verifyMediaUrl(firstImage) : null;

    result.verification = {
        video: slimCheck(videoCheck),
        image: slimCheck(imageCheck),
        all_cdn_ok: Boolean((videoCheck ? videoCheck.ok : true) && (imageCheck ? imageCheck.ok : true)),
    };

    return result;
}

const BAD_REQUEST = ['URL kosong', 'URL tidak valid', 'Host bukan threads.com'];

export default async function threadsHandler(req: Request, res: Response) {
    const url = String(req.query.url || (req.body as any)?.url || '').trim();

    if (!url) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' is required (threads.com post URL)",
        });
    }

    try {
        const result = await threadsDL(url);
        const tag = String(result.code || result.post_id || 'threads');
        const extOf = (u: string, fallback: string): string => {
            const m = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(String(u || ''));
            return m ? `.${m[1].toLowerCase()}` : fallback;
        };
        if (result.url) {
            const u = result.url;
            if (u.video) u.video = cdnLink(req, u.video, `threads_${tag}_video${extOf(u.video, '.mp4')}`, cdnHeaders());
            if (Array.isArray(u.videos)) u.videos = u.videos.map((v: string, i: number) => cdnLink(req, v, `threads_${tag}_video_${i + 1}${extOf(v, '.mp4')}`, cdnHeaders()));
            if (u.audio) u.audio = cdnLink(req, u.audio, `threads_${tag}_audio${extOf(u.audio, '.mp3')}`, cdnHeaders());
            if (Array.isArray(u.audios)) u.audios = u.audios.map((v: string, i: number) => cdnLink(req, v, `threads_${tag}_audio_${i + 1}${extOf(v, '.mp3')}`, cdnHeaders()));
            if (Array.isArray(u.images)) u.images = u.images.map((v: string, i: number) => cdnLink(req, v, `threads_${tag}_img_${i + 1}${extOf(v, '.jpg')}`, cdnHeaders()));
        }
        return res.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        const code = BAD_REQUEST.some((k) => message.startsWith(k)) ? 400 : 500;
        return res.status(code).json({ status: false, message });
    }
}
