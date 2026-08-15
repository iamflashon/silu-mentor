"use client";

import DocumentQuestionWorkspace from "../../../medtech/admin/document-workspace/DocumentQuestionWorkspace";

/**
 * 中會沿用醫檢後台已驗證的文件工作區：同一套題目搜尋、搜尋取代、
 * 原稿版本切換與逐題編輯流程，但 API 路徑會由 category=accounting 自動切換。
 */
export default function AccountingDocumentWorkspace() {
  return <DocumentQuestionWorkspace category="accounting" />;
}
