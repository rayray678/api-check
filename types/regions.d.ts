/**
 * @description 区域配置的类型定义
 */

/**
 * 区域代码到显示名称的映射
 */
export type RegionsConfig = Record<string, string>;

/**
 * 区域代码类型（常见的区域）
 */
export type RegionCode =
  | 'wnam'
  | 'enam'
  | 'weur'
  | 'eeur'
  | 'apac'
  | string; // 允许其他自定义区域
