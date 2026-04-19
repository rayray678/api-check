import { secureProxiedFetch } from './utils/fetcher.js';
import { normalizeBaseUrl } from './utils/url.js';
import * as providersData from '../config/providers.json';

const PROVIDERS = providersData.default;

/**
 * @description 从 OpenAI 兼容 API 获取模型列表。
 * @param {string} token - API Key。
 * @param {string} baseUrl - API 基础 URL。
 * @param {string} region - 区域信息。
 * @param {object} env - 环境变量。
 * @returns {Promise<string[]>} - 模型 ID 数组。
 */
async function fetchOpenAIModels(token, baseUrl, region, env) {
    const apiUrl = normalizeBaseUrl(baseUrl) + "/models";
    const response = await secureProxiedFetch(apiUrl, { method: "GET", headers: { Authorization: "Bearer " + token } }, region, env);
    if (!response.ok) throw new Error("HTTP " + response.status + ": " + (await response.text()));
    const data = await response.json();
    if (Array.isArray(data)) return data.map((m) => m.id);
    if (data && Array.isArray(data.data)) return data.data.map((m) => m.id);
    return [];
}

/**
 * @description 从 GitHub Models API 获取模型列表，包含回退逻辑。
 * @param {string} token - API Key。
 * @param {string} baseUrl - API 基础 URL。
 * @param {string} region - 区域信息。
 * @param {object} env - 环境变量。
 * @returns {Promise<string[]>} - 模型 ID 数组。
 */
async function fetchGitHubModels(token, baseUrl, region, env) {
    try {
        const models = await fetchOpenAIModels(token, baseUrl, region, env);
        if (models && models.length > 0) return models;
    } catch (error) {
        console.warn("GitHub /models endpoint failed, trying fallback...", error.message);
    }
    const apiUrl = normalizeBaseUrl(baseUrl || PROVIDERS.github.defaultBase).replace("/inference", "") + "/catalog/models";
    const response = await secureProxiedFetch(apiUrl, { method: "GET", headers: { Authorization: "Bearer " + token } }, region, env);
    if (!response.ok) throw new Error("Fallback /catalog/models failed with HTTP " + response.status + ": " + (await response.text()));
    const data = await response.json();
    if (data && Array.isArray(data.data) && data.data.length > 0) return data.data.map((m) => m.id);
    if (Array.isArray(data) && data.length > 0) return data.map((m) => m.id);
    throw new Error("Fallback /catalog/models returned no models.");
}

/**
 * @description 从 Google Gemini API 获取模型列表，支持分页。
 * @param {string} token - API Key。
 * @param {string} baseUrl - API 基础 URL。
 * @param {string} region - 区域信息。
 * @param {object} env - 环境变量。
 * @returns {Promise<string[]>} - 模型 ID 数组。
 */
async function fetchGoogleModels(token, baseUrl, region, env) {
    const allModels = [];
    let pageToken = null;

    do {
        const apiUrl = `${normalizeBaseUrl(baseUrl)}/v1beta/models${pageToken ? `?pageToken=${pageToken}` : ''}`;
        const response = await secureProxiedFetch(
            apiUrl,
            {
                method: "GET",
                headers: { "x-goog-api-key": token }
            },
            region,
            env
        );

        if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error(err?.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const models = data.models || [];

        // 过滤支持 generateContent 且非 embedding 模型
        const validModels = models
            .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && !m.name.includes("embedding"))
            .map((m) => m.name.replace("models/", ""));

        allModels.push(...validModels);

        // 检查是否有下一页
        pageToken = data.nextPageToken || null;
    } while (pageToken);

    return allModels;
}

/**
 * @description 从 Anthropic API 获取模型列表。
 * @param {string} token - API Key。
 * @param {string} baseUrl - API 基础 URL。
 * @param {string} region - 区域信息。
 * @param {object} env - 环境变量。
 * @returns {Promise<string[]>} - 模型 ID 数组。
 */
async function fetchAnthropicModels(token, baseUrl, region, env) {
    const apiUrl = normalizeBaseUrl(baseUrl) + "/models";
    const response = await secureProxiedFetch(apiUrl, {
        method: "GET",
        headers: { "x-api-key": token, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    }, region, env);
    if (!response.ok) {
        const err = await response.json().catch(() => null);
        throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.data.map((model) => model.id);
}

/**
 * @description 映射不同提供商的模型获取函数。
 */
const fetcherMap = {
    fetchOpenAIModels,
    fetchGitHubModels,
    fetchGoogleModels,
    fetchAnthropicModels
};

/**
 * @description 根据提供商元数据获取模型列表。
 * @param {object} providerMeta - 提供商的元数据。
 * @param {string} token - API Key。
 * @param {object} providerConfig - 提供商配置。
 * @param {object} env - 环境变量。
 * @returns {Promise<string[]>} - 模型 ID 数组。
 * @throws {Error} 如果提供商不支持模型获取。
 */
export async function getModels(providerMeta, token, providerConfig, env) {
    const fetcherName = providerMeta.fetchModels;
    if (!fetcherName || !fetcherMap[fetcherName]) {
        throw new Error(`Model fetching is not supported for provider: ${providerConfig.provider}`);
    }
    return await fetcherMap[fetcherName](token, providerConfig.baseUrl, providerConfig.region, env);
}
