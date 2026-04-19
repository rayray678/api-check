/**
 * @description 缓存解析后的允许来源列表，避免重复解析。
 */
let cachedAllowedOrigins = null;
let cachedEnvKey = null;

/**
 * @description 从环境变量中解析允许的 CORS 来源白名单。
 * 预期环境变量 `ALLOWED_ORIGINS` 为 JSON 字符串数组，例如 `'["https://example.com","https://*.example.com"]''`。
 * @param {object} env - Cloudflare Worker 的环境变量。
 * @returns {string[]} - 解析后的允许来源数组，如果解析失败则返回空数组。
 */
export function getAllowedOrigins(env) {
    const envValue = env.ALLOWED_ORIGINS || "[]";
    if (cachedEnvKey === envValue) {
        return cachedAllowedOrigins;
    }
    try {
        cachedAllowedOrigins = JSON.parse(envValue);
        cachedEnvKey = envValue;
        return cachedAllowedOrigins;
    } catch (e) {
        cachedAllowedOrigins = [];
        cachedEnvKey = envValue;
        return [];
    }
}

/**
 * @description 缓存编译后的通配符正则表达式。
 */
const regexCache = new Map();

/**
 * @description 校验请求的 Origin 是否在允许的白名单范围内。
 * 支持子域通配符（例如 `https://*.example.com`）。
 * @param {string} origin - 请求头中的 Origin 字符串。
 * @param {string[]} allowedOrigins - 允许的 Origin 白名单数组。
 * @returns {string|null} - 如果 Origin 合法，则返回实际的 Origin 字符串；否则返回 `null`。
 */
export function validateOrigin(origin, allowedOrigins) {
    if (!origin) return null;

    for (const rule of allowedOrigins) {
        if (rule === origin) return origin;

        if (rule.includes("*")) {
            let regex = regexCache.get(rule);
            if (!regex) {
                regex = new RegExp("^" + rule
                    .replace(/\./g, "\\.")
                    .replace(/\*/g, "[^.]+") + "$"
                );
                regexCache.set(rule, regex);
            }
            if (regex.test(origin)) return origin;
        }
    }
    return null;
}

/**
 * @description 检查 IPv4 地址是否属于私有/保留网段。
 * @param {string} hostname - 待检查的主机名。
 * @returns {boolean} - 如果是私有/保留地址则返回 true。
 */
function isPrivateIPv4(hostname) {
    const parts = hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;

    const [a, b] = parts;

    // 0.0.0.0/8 - 当前网络
    if (a === 0) return true;
    // 10.0.0.0/8 - RFC1918 私有地址
    if (a === 10) return true;
    // 100.64.0.0/10 - CGNAT 共享地址空间 (RFC6598)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 - 回环地址
    if (a === 127) return true;
    // 169.254.0.0/16 - 链路本地 / 云元数据端点
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 - RFC1918 私有地址
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 - RFC1918 私有地址
    if (a === 192 && b === 168) return true;
    // 198.18.0.0/15 - 基准测试地址 (RFC2544)
    if (a === 198 && (b === 18 || b === 19)) return true;
    // 240.0.0.0/4 - 保留地址
    if (a >= 240) return true;
    // 255.255.255.255 - 广播地址
    if (parts.every(p => p === 255)) return true;

    return false;
}

/**
 * @description 检查 IPv6 地址是否属于私有/保留网段。
 * @param {string} raw - 去除方括号后的 IPv6 地址字符串。
 * @returns {boolean} - 如果是私有/保留地址则返回 true。
 */
function isPrivateIPv6(raw) {
    const lower = raw.toLowerCase();
    // ::1 回环地址
    if (lower === '::1' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    // :: 未指定地址
    if (lower === '::') return true;
    // fc00::/7 - 唯一本地地址 (ULA)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // fe80::/10 - 链路本地地址
    if (lower.startsWith('fe80')) return true;
    // ::ffff:0:0/96 - IPv4 映射地址，需要检查映射的 IPv4 部分
    if (lower.startsWith('::ffff:')) {
        const v4Part = lower.slice(7);
        if (v4Part.includes('.') && isPrivateIPv4(v4Part)) return true;
    }
    return false;
}

/**
 * @description 校验目标 URL 的安全性，防止 SSRF（Server-Side Request Forgery）攻击。
 * 允许 HTTP/HTTPS 协议，并禁止访问内网地址、保留地址和云元数据端点。
 * @param {string} targetUrl - 待校验的目标 URL 字符串。
 * @returns {boolean} - 如果 URL 安全则返回 `true`，否则返回 `false`。
 */
export function validateTargetUrl(targetUrl) {
    try {
        const url = new URL(targetUrl);

        // 只允许 HTTP/HTTPS 协议
        if (!["http:", "https:"].includes(url.protocol)) return false;

        const hostname = url.hostname;

        // 禁止 localhost 及内网域名后缀
        const forbiddenHosts = ['localhost', 'localhost.localdomain'];
        if (forbiddenHosts.includes(hostname)) return false;

        const forbiddenSuffixes = ['.local', '.internal', '.localhost', '.example'];
        if (forbiddenSuffixes.some(s => hostname.endsWith(s))) return false;

        // 检查 IPv6 地址（URL 中以方括号包裹）
        if (hostname.startsWith('[') && hostname.endsWith(']')) {
            const ipv6 = hostname.slice(1, -1);
            if (isPrivateIPv6(ipv6)) return false;
        }
        // 检查纯 IPv6（URL 解析后可能去掉方括号）
        else if (hostname.includes(':')) {
            if (isPrivateIPv6(hostname)) return false;
        }
        // 检查 IPv4 地址
        else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
            if (isPrivateIPv4(hostname)) return false;
        }

        return true;
    } catch (err) {
        return false;
    }
}
