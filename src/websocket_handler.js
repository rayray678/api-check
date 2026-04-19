import * as checker from './checkers.js';
import * as providersData from '../config/providers.json';

/**
 * @description 单个 WebSocket 会话允许处理的最大 Token 数量。
 * 防止客户端绕过前端限制发送过多 Key。
 */
const MAX_TOKENS_PER_SESSION = 50000;

/**
 * @description 单个批次允许的最大并发数。
 */
const MAX_CONCURRENCY = 20;

/**
 * @description TaskManager 类负责处理单个批次的检测任务。
 * 支持在同一 WebSocket 会话中被多次重置和复用，以处理多个批次。
 */
class TaskManager {
    /**
     * @param {object} env - Cloudflare Worker 的环境变量。
     * @param {object} callbacks - 包含 onResult, onStatus, onError, onBatchDone 等回调函数。
     */
    constructor(env, { onResult, onStatus, onError, onBatchDone }) {
        this.env = env;
        this.callbacks = { onResult, onStatus, onError, onBatchDone };
        this.isProcessing = false;
        this._reset();
    }

    /**
     * @description 重置内部状态，为处理新批次做准备。
     */
    _reset() {
        this.queue = [];
        this.currentIndex = 0;
        this.isStopped = false;
        this.concurrency = 5;
        this.providerMeta = null;
        this.providerConfig = null;
    }

    /**
     * @description 线程安全地获取下一个任务项。
     * @returns {object|null} - 下一个任务项，如果队列为空则返回 null。
     */
    getNextItem() {
        if (this.currentIndex >= this.queue.length) return null;
        return this.queue[this.currentIndex++];
    }

    /**
     * @description 开始处理接收到的一个批次任务。
     * @param {object} initialData - 包含 tokens, providerConfig, concurrency 的初始数据。
     */
    start(initialData) {
        if (this.isProcessing) {
            this.callbacks.onError('A batch is already being processed');
            return;
        }

        const { tokens, providerConfig, concurrency } = initialData;

        if (!tokens || !Array.isArray(tokens) || !providerConfig) {
            this.callbacks.onError('Invalid initial data for a batch');
            return;
        }

        // 服务端校验：限制单批次 Token 数量
        if (tokens.length > MAX_TOKENS_PER_SESSION) {
            this.callbacks.onError(`Token count exceeds server limit (max ${MAX_TOKENS_PER_SESSION})`);
            return;
        }

        // 服务端校验：限制并发数
        const safeConcurrency = Math.min(Math.max(concurrency || 5, 1), MAX_CONCURRENCY);

        this._reset();
        this.queue = tokens;
        this.concurrency = safeConcurrency;
        this.providerConfig = providerConfig;
        this.providerMeta = providersData.default[providerConfig.provider];

        if (!this.providerMeta) {
            this.callbacks.onError(`Provider '${providerConfig.provider}' not found`);
            return;
        }

        this.isProcessing = true;
        this.runWorkerPool();
    }

    /**
     * @description 创建并运行一个并发工作池来处理当前批次的任务。
     */
    async runWorkerPool() {
        const workerPromises = [];
        for (let i = 0; i < this.concurrency; i++) {
            const worker = async () => {
                while (true) {
                    if (this.isStopped) break;

                    const item = this.getNextItem();
                    if (!item) break;

                    await this.runCheck(item);

                    await new Promise(r => setTimeout(r, 0));
                }
            };
            workerPromises.push(worker());
        }

        await Promise.all(workerPromises);

        this.isProcessing = false;
        if (!this.isStopped) {
            this.callbacks.onBatchDone('Batch processing complete');
        }
    }

    /**
     * @description 运行单个 Key 的检测。
     * @param {object} item - 包含 token 和 order 的任务项。
     */
    async runCheck(item) {
        if (this.isStopped) return;
        try {
            // 从 item 对象中正确地取出 token 字符串进行检测
            const result = await checker.checkToken(item.token, this.providerMeta, this.providerConfig, this.env);
            this.callbacks.onResult({ ...result, order: item.order });
        } catch (e) {
            this.callbacks.onResult({ token: item.token, message: e.message, error: true, order: item.order });
        }
    }

    /**
     * @description 停止当前批次的任务。
     */
    stop() {
        this.isStopped = true;
        this.isProcessing = false;
    }
}

/**
 * @description 处理 WebSocket 会话的入口函数。
 * 支持在同一连接上处理多个批次，客户端通过发送多个 'start' 命令来提交批次。
 * @param {WebSocket} ws - WebSocket 服务器端实例。
 * @param {object} env - Cloudflare Worker 的环境变量。
 * @returns {Promise<void>}
 */
export function handleWebSocketSession(ws, env) {
    ws.accept();

    /**
     * @description 安全地向 WebSocket 发送消息，忽略已关闭连接的错误。
     */
    function safeSend(data) {
        try { ws.send(data); } catch (_) { /* 连接已关闭 */ }
    }

    const taskManager = new TaskManager(env, {
        onResult: (result) => safeSend(JSON.stringify({ type: 'result', data: result })),
        onStatus: (message) => safeSend(JSON.stringify({ type: 'status', message })),
        onError: (message) => {
            safeSend(JSON.stringify({ type: 'error', message }));
        },
        onBatchDone: (message) => {
            // 批次完成，发送 batch_done 但不关闭连接，等待下一个批次
            safeSend(JSON.stringify({ type: 'batch_done', message }));
        },
    });

    return new Promise((resolve, reject) => {
        ws.addEventListener('message', event => {
            try {
                const message = JSON.parse(event.data);
                if (message.command === 'start') {
                    taskManager.start(message.data);
                } else if (message.command === 'stop') {
                    taskManager.stop();
                    ws.close(1000, 'Client requested stop');
                } else if (message.command === 'done') {
                    // 客户端通知所有批次已完成，关闭连接
                    taskManager.stop();
                    ws.close(1000, 'All batches complete');
                } else {
                    safeSend(JSON.stringify({ type: 'error', message: 'Unknown command' }));
                }
            } catch (e) {
                safeSend(JSON.stringify({ type: 'error', message: 'Invalid JSON message' }));
            }
        });

        const closeOrErrorHandler = (err) => {
            taskManager.stop();
            if (err) {
                console.error('WebSocket error:', err);
                reject(err);
            } else {
                resolve();
            }
        };

        ws.addEventListener('close', () => closeOrErrorHandler());
        ws.addEventListener('error', (err) => closeOrErrorHandler(err));
    });
}
