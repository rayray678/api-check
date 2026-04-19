import { defineStore } from 'pinia';
import { ref, reactive, computed, shallowRef, triggerRef } from 'vue';
import { useConfigStore } from './config';
import { RESULT_CATEGORIES } from '@/constants';

/**
 * @description HTML 转义函数，防止 XSS 攻击。
 * @param {string} text - 需要转义的文本。
 * @returns {string} - 转义后的安全文本。
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const str = String(text);
    const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return str.replace(/[&<>"']/g, char => htmlEscapes[char]);
}

/**
 * @description 定义了不同提供商的显示文本格式化策略。
 * 每个函数接收结果对象 `res`，并返回格式化后的 HTML 字符串。
 */
const displayTextFormatters = {
    /**
     * @description OpenRouter 提供商的余额显示格式化。
     * @param {object} res - 结果对象。
     */
    openrouter: (res) => {
        const safeToken = escapeHtml(res.token);
        const bal = res.balance;
        const balClass = bal >= 10 ? "high" : bal > 0 ? "medium" : "low";
        return `${safeToken} <span class="message">(余额: <span class="balance-${balClass}">${escapeHtml(bal)} / ${escapeHtml(res.totalBalance)}</span>)</span>`;
    },
    /**
     * @description DeepSeek 提供商的余额显示格式化。
     * @param {object} res - 结果对象。
     */
    deepseek: (res) => {
        const safeToken = escapeHtml(res.token);
        const bal = res.balance;
        const balClass = bal >= 10 ? "high" : bal > 0 ? "medium" : "low";
        const balanceDisplay = res.currency === 'USD' ? `$${res.balance.toFixed(2)}` : `${res.balance} ${escapeHtml(res.currency)}`;
        return `${safeToken} <span class="message">(余额: <span class="balance-${balClass}">${escapeHtml(balanceDisplay)}</span> | 赠送: ${escapeHtml(res.grantedBalance)} | 充值: ${escapeHtml(res.toppedUpBalance)})</span>`;
    },
    /**
     * @description 默认的余额显示格式化，适用于大多数提供商。
     * @param {object} res - 结果对象。
     */
    default: (res) => {
        const safeToken = escapeHtml(res.token);
        const bal = res.balance;
        const balClass = bal >= 10 ? "high" : bal > 0 ? "medium" : "low";
        let balanceDisplay = bal !== undefined ? String(bal) : "-";

        if (res.currency === 'USD') {
            balanceDisplay = `$${res.balance.toFixed(2)}`;
        } else if (res.currency) {
            balanceDisplay = `${res.balance} ${escapeHtml(res.currency)}`;
        }

        let extraInfo = '';
        if (res.totalGranted !== undefined) {
            const grantedDisplay = res.currency === 'USD' ? `$${res.totalGranted.toFixed(2)}` : res.totalGranted;
            extraInfo += ` | 总额: ${escapeHtml(grantedDisplay)}`;
        }
        if (res.expiresAt !== undefined) {
            const expiresDate = res.expiresAt === 0
                ? '永不'
                : new Date(res.expiresAt * 1000).toLocaleDateString();
            extraInfo += ` | 过期: ${escapeHtml(expiresDate)}`;
        }

        return `${safeToken} <span class="message">(余额: <span class="balance-${balClass}">${escapeHtml(balanceDisplay)}</span>${extraInfo})</span>`;
    },
    /**
     * @description 没有余额信息的提供商的显示格式化。
     * @param {object} res - 结果对象。
     */
    noBalance: (res) => {
        const safeToken = escapeHtml(res.token);
        return `${safeToken} <span class="message">(状态: 有效)</span>`;
    }
};

/** @description 所有结果类别的枚举 */
const CATEGORIES = RESULT_CATEGORIES;

/**
 * @description results Store 用于管理 API Key 检测结果的显示和排序。
 * 性能优化：使用 shallowRef 减少深层响应式开销，按类别独立计算过滤/排序结果。
 */
export const useResultsStore = defineStore('results', () => {
    // --- 状态 (State) ---
    /** @type {Ref<string>} 当前激活的结果标签页。*/
    const activeTab = ref('valid');

    /**
     * @description 使用 shallowRef 存储结果数组，减少响应式开销。
     * 每个类别的数组变化需要手动调用 triggerRef 来触发更新。
     */
    const results = {
        valid: shallowRef([]),
        lowBalance: shallowRef([]),
        zeroBalance: shallowRef([]),
        noQuota: shallowRef([]),
        rateLimit: shallowRef([]),
        invalid: shallowRef([]),
        duplicate: shallowRef([]),
    };

    /** @type {Reactive<object>} 各个结果类别的搜索关键词。*/
    const searchTerms = reactive({
        valid: '', lowBalance: '', zeroBalance: '', noQuota: '', rateLimit: '', invalid: '', duplicate: '',
    });

    /** @type {Reactive<object>} 各个结果类别的排序状态。*/
    const sortState = reactive({
        valid: 'default', lowBalance: 'default',
    });

    /** @description 缓存的 configStore 引用，避免重复获取 */
    let _configStore = null;
    const getConfigStore = () => {
        if (!_configStore) {
            _configStore = useConfigStore();
        }
        return _configStore;
    };

    // --- 按类别独立计算的 Getters ---
    /**
     * @description 为每个类别创建独立的过滤+排序计算属性。
     * 这样只有对应类别的数据变化时才会重新计算，而不是所有类别一起计算。
     */
    const _sortedResultsComputed = {};

    for (const category of CATEGORIES) {
        _sortedResultsComputed[category] = computed(() => {
            const data = results[category].value;
            const searchTerm = searchTerms[category]?.toLowerCase() || '';
            const sortKey = sortState[category];

            // 1. 过滤
            let filtered;
            if (!searchTerm) {
                filtered = data;
            } else {
                filtered = data.filter(r =>
                    r.token.toLowerCase().includes(searchTerm) ||
                    r.displayText.toLowerCase().includes(searchTerm)
                );
            }

            // 2. 排序（仅在需要时创建副本）
            if (!sortKey || sortKey === 'default') {
                // 默认排序：按 order 升序
                // 如果已经是按 order 排序的，直接返回（添加时保证顺序）
                if (filtered === data && data.length > 0) {
                    // 检查是否需要排序
                    let needsSort = false;
                    for (let i = 1; i < data.length; i++) {
                        if (data[i].order < data[i - 1].order) {
                            needsSort = true;
                            break;
                        }
                    }
                    if (!needsSort) {
                        return filtered;
                    }
                }
                return [...filtered].sort((a, b) => a.order - b.order);
            }

            // 余额排序
            return [...filtered].sort((a, b) => {
                const balanceA = a.balance ?? -Infinity;
                const balanceB = b.balance ?? -Infinity;
                return sortKey === 'balance-desc' ? balanceB - balanceA : balanceA - balanceB;
            });
        });
    }

    /**
     * @description 获取指定类别的排序结果。
     * @param {string} category - 结果类别。
     * @returns {Array<object>} - 排序后的结果数组。
     */
    function getSortedResults(category) {
        const comp = _sortedResultsComputed[category];
        return comp ? comp.value : [];
    }

    /**
     * @description 兼容旧 API 的 sortedResults 代理对象。
     * 使得 resultsStore.sortedResults[category] 可以正常工作。
     */
    const sortedResults = new Proxy({}, {
        get(target, prop) {
            if (_sortedResultsComputed[prop]) {
                return _sortedResultsComputed[prop].value;
            }
            return undefined;
        }
    });

    // --- 兼容旧 API 的代理对象 ---
    /**
     * @description 创建一个代理对象，使得 resultsStore.results[category] 可以正常工作。
     */
    const resultsProxy = new Proxy({}, {
        get(target, prop) {
            if (results[prop]) {
                return results[prop].value;
            }
            return undefined;
        },
        set(target, prop, value) {
            if (results[prop]) {
                results[prop].value = value;
                return true;
            }
            return false;
        }
    });

    // --- 动作 (Actions) ---
    /**
     * @description 根据结果对象和提供商获取要显示的文本。
     * @param {object} res - 检测结果对象。
     * @param {string} provider - 当前提供商的 Key。
     * @returns {string} - 格式化后的显示文本（HTML 字符串）。
     */
    function getDisplayText(res, provider) {
        const safeToken = escapeHtml(res.token);
        // 处理重复 Key 的特殊情况
        if (res.finalCategory === 'duplicate') {
            return `${safeToken} <span class="message">(重复)</span>`;
        }
        // 处理无效 Key 的情况
        if (!res.isValid) {
            const safeMessage = escapeHtml(res.message || '未知错误');
            return `${safeToken} <span class="message">(${safeMessage})</span>`;
        }

        const configStore = getConfigStore();
        // 如果提供商没有余额概念，则使用无余额格式化
        if (!configStore.providers[provider].hasBalance) {
            return displayTextFormatters.noBalance(res);
        }

        // 根据提供商选择对应的格式化函数，如果没有则使用默认格式化
        const formatter = displayTextFormatters[provider] || displayTextFormatters.default;
        return formatter(res);
    }

    /**
     * @description 构建结果对象，供 addResult 和 addResults 内部使用。
     * @param {object} res - 检测结果对象。
     * @param {number} order - 结果的原始顺序。
     * @param {string} provider - 当前提供商。
     * @returns {object|null} - 构建的结果对象，或 null（如果类别无效）。
     */
    function buildResultItem(res, order, provider) {
        const category = res.finalCategory;
        if (!results[category]) {
            console.error("无效的结果分类:", category, res);
            return null;
        }

        const displayText = getDisplayText(res, provider);
        const details = {};

        // 填充详细信息，用于模态框显示
        if (res.rawError) details.error_details = res.rawError;
        if (res.rawResponse) details.validation_response = res.rawResponse;
        if (res.rawBalanceResponse) details.balance_response = res.rawBalanceResponse;
        if (res.totalGranted !== undefined) details.totalGranted = res.totalGranted;
        if (res.expiresAt !== undefined) details.expiresAt = res.expiresAt;
        if (res.currency) details.currency = res.currency;
        if (res.grantedBalance !== undefined) details.grantedBalance = res.grantedBalance;

        return {
            category,
            item: {
                id: `${res.token}-${order}`,  // 唯一 ID，用于虚拟滚动的 key
                token: res.token,
                displayText: displayText,
                balance: res.balance,
                order: order,
                details: Object.keys(details).length > 0 ? details : null,
            }
        };
    }

    /**
     * @description 添加一个检测结果到对应的类别中。
     * @param {object} res - 检测结果对象。
     * @param {number} order - 结果的原始顺序。
     */
    function addResult(res, order) {
        const configStore = getConfigStore();
        const built = buildResultItem(res, order, configStore.currentProvider);
        if (!built) return;

        const { category, item } = built;
        // 使用 shallowRef，需要创建新数组来触发更新
        results[category].value = [...results[category].value, item];
    }

    /**
     * @description 批量添加检测结果，减少响应式触发次数。
     * @param {Array<{res: object, order: number}>} items - 检测结果数组。
     */
    function addResults(items) {
        if (!items || items.length === 0) return;

        const configStore = getConfigStore();
        const provider = configStore.currentProvider;

        // 按类别分组
        const grouped = {};
        for (const category of CATEGORIES) {
            grouped[category] = [];
        }

        for (const { res, order } of items) {
            const built = buildResultItem(res, order, provider);
            if (built) {
                grouped[built.category].push(built.item);
            }
        }

        // 批量更新每个类别（只触发一次响应式更新）
        for (const category of CATEGORIES) {
            if (grouped[category].length > 0) {
                results[category].value = [...results[category].value, ...grouped[category]];
            }
        }
    }

    /**
     * @description 清空所有检测结果。
     */
    function clearResults() {
        for (const category of CATEGORIES) {
            results[category].value = [];
        }
    }

    /**
     * @description 设置指定类别的排序方式。
     * @param {string} category - 结果类别。
     * @param {string} value - 排序值（如 'default', 'balance-desc'）。
     */
    function setSort(category, value) {
        sortState[category] = value;
    }

    return {
        activeTab,
        results: resultsProxy,
        searchTerms,
        sortState,
        sortedResults,
        getSortedResults,
        addResult,
        addResults,
        clearResults,
        setSort
    };
});
