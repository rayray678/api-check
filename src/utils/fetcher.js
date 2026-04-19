import { validateTargetUrl } from './security.js';
import { UserAgentManager } from './userAgent.js';

/**
 * @description 单例 UserAgentManager 实例，避免每次请求都创建新实例。
 */
const uaManager = new UserAgentManager();

/**
 * @description 安全地发起代理请求的通用函数。它会根据配置决定是否通过 Durable Object 进行区域代理。
 * @param {string} url - 目标 URL。
 * @param {RequestInit} options - fetch 请求的选项。
 * @param {string} region - 指定的区域名称，用于 Durable Object 代理。
 * @param {object} env - Cloudflare Worker 的环境变量。
 * @param {number} [timeout=30000] - 请求超时时间（毫秒），默认 30 秒。
 * @returns {Promise<Response>} - fetch 请求的响应。
 */
export async function secureProxiedFetch(url, options, region, env, timeout = 30000) {
    if (!validateTargetUrl(url)) {
        return new Response(JSON.stringify({ error: { message: 'Invalid or forbidden target URL' } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const enableUaRandomization = env.ENABLE_UA_RANDOMIZATION !== 'false';
    const enableAcceptLanguageRandomization = env.ENABLE_ACCEPT_LANGUAGE_RANDOMIZATION !== 'false';

    const finalHeaders = { ...options.headers };

    if (enableUaRandomization) {
        const randomUA = uaManager.getRandomUserAgent();
        if (randomUA) finalHeaders['user-agent'] = randomUA;
    }

    if (enableAcceptLanguageRandomization) {
        const randomAcceptLanguage = uaManager.getRandomAcceptLanguage();
        if (randomAcceptLanguage) finalHeaders['accept-language'] = randomAcceptLanguage;
    }

    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const finalOptions = { ...options, headers: finalHeaders, signal: controller.signal };

    try {
        let response;
        // 如果没有指定区域或没有 Durable Object 绑定，则直接发起请求
        if (!region || !env.REGIONAL_FETCHER) {
            response = await fetch(url, finalOptions);
        } else {
            // 通过 Durable Object 进行区域代理
            try {
                const doId = env.REGIONAL_FETCHER.idFromName(region);
                const doStub = env.REGIONAL_FETCHER.get(doId, { location: region });

                const payload = {
                    targetUrl: url,
                    method: finalOptions.method,
                    headers: finalOptions.headers,
                    body: finalOptions.body,
                };

                const targetHostname = new URL(url).hostname;
                const internalUrl = `http://do.internal/proxy/${targetHostname}`;

                const proxyRequestToDO = new Request(internalUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });

                response = await doStub.fetch(proxyRequestToDO);
            } catch (error) {
                console.error(`Durable Object fetch failed for region ${region}:`, error);
                response = await fetch(url, finalOptions);
            }
        }
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            return new Response(JSON.stringify({ error: { message: 'Request timeout' } }), {
                status: 408,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        throw error;
    }
}
