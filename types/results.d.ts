/**
 * @description API Key 检测结果的类型定义
 */

/**
 * 结果分类
 */
export type ResultCategory =
  | 'valid'
  | 'lowBalance'
  | 'zeroBalance'
  | 'noQuota'
  | 'rateLimit'
  | 'invalid'
  | 'duplicate';

/**
 * 单个 API Key 的检测结果
 */
export interface CheckResult {
  /** API Key 原文 */
  token: string;
  /** 是否有效 */
  isValid: boolean;
  /** 错误或状态消息 */
  message?: string;
  /** 是否为错误结果 */
  error?: boolean;
  /** 余额（-1 表示无法获取） */
  balance?: number;
  /** 总余额 */
  totalBalance?: number;
  /** 已使用余额 */
  usedBalance?: number;
  /** 货币类型 */
  currency?: string;
  /** 赠送余额 */
  grantedBalance?: number;
  /** 充值余额 */
  toppedUpBalance?: number;
  /** 过期时间 */
  expiresAt?: string;
  /** 原始 API 响应 */
  rawResponse?: unknown;
  /** 原始错误信息 */
  rawError?: {
    status: number;
    content: unknown;
  };
  /** 原始余额响应 */
  rawBalanceResponse?: unknown;
  /** 最终分类（前端赋值） */
  finalCategory?: ResultCategory;
  /** 排序序号 */
  order?: number;
}

/**
 * 错误分类结果
 */
export interface CategorizedError {
  /** 分类 */
  category: ResultCategory;
  /** 简短消息 */
  simpleMessage: string;
}
