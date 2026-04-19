/**
 * @description WebSocket 消息的类型定义
 */

import type { CheckResult } from './results';
import type { ProviderConfig } from './providers';

/**
 * WebSocket 消息类型
 */
export type WebSocketMessageType = 'result' | 'batch_done' | 'error';

/**
 * WebSocket 命令类型
 */
export type WebSocketCommand = 'start' | 'done' | 'stop';

/**
 * 待检测的 Key 对象
 */
export interface TokenToCheck {
  /** API Key 原文 */
  token: string;
  /** 排序序号 */
  order: number;
}

/**
 * 客户端发送的 start 命令数据
 */
export interface StartCommandData {
  /** 待检测的 Key 列表 */
  tokens: TokenToCheck[];
  /** 提供商配置 */
  providerConfig: ProviderConfig;
  /** 并发数 */
  concurrency: number;
}

/**
 * 客户端发送的 WebSocket 消息
 */
export interface ClientMessage {
  /** 命令类型 */
  command: WebSocketCommand;
  /** 命令数据（start 命令时必需） */
  data?: StartCommandData;
}

/**
 * 服务端发送的 result 消息
 */
export interface ResultMessage {
  type: 'result';
  data: CheckResult;
}

/**
 * 服务端发送的 batch_done 消息
 */
export interface BatchDoneMessage {
  type: 'batch_done';
}

/**
 * 服务端发送的 error 消息
 */
export interface ErrorMessage {
  type: 'error';
  message: string;
}

/**
 * 服务端发送的 WebSocket 消息（联合类型）
 */
export type ServerMessage = ResultMessage | BatchDoneMessage | ErrorMessage;
