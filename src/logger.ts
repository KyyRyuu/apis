/*
 * KuroNeko API | sylvatica.my.id
 * © Dandy
 */
import { Request, Response } from 'express';

const realIp = (req: Request): string => {
    // Sama seperti rate limiter: req.ip (trust proxy 1 hop), bukan XFF mentah.
    const ip = req.ip || req.socket?.remoteAddress || '';
    return String(ip).replace('::ffff:', '');
};

export const logRouterRequest = (
    req: Request,
    res: Response
) => {
    res.on('finish', () => {
        const ip = realIp(req);
        const status = res.statusCode;
        const url = `${req.protocol}://${req.get(
            'host'
        )}${req.originalUrl}`;
        let color = '\x1b[0m';
        if (status >= 500) {
            color = '\x1b[31m';
        } else if (status >= 400) {
            color = '\x1b[33m';
        } else if (status >= 300) {
            color = '\x1b[36m';
        } else if (status >= 200) {
            color = '\x1b[32m';
        }
        console.log(
            `[${ip}] = ${color}[${status}]\x1b[0m ${url}`
        );
    });
};

export const logRateLimit = (
    req: Request
) => {
    const ip = realIp(req);
    console.log(
        `[${ip}] = \x1b[31m[429]\x1b[0m RATE LIMIT BAN`
    );
};