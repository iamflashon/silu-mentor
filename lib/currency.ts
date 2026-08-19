// 成本畫面使用統一的估算匯率；日後可集中調整，不影響 API 內的美元成本紀錄。
export const USD_TO_TWD_RATE = 32.5;
export const COST_CURRENCY_LABEL = "台幣暫估";

export function usdToTwd(usd: number) {
  return Math.max(0, Number(usd) || 0) * USD_TO_TWD_RATE;
}

export function formatTwd(usd: number, digits = 2) {
  return usdToTwd(usd).toFixed(digits);
}
