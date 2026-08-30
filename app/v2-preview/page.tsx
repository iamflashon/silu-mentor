import type { Metadata } from "next";
import { getV2Catalog, getV2Config } from "../../lib/v2-platform";
import V2Preview from "./V2Preview";
import "./v2.css";

export const metadata: Metadata = { title: "V2 模組化學習平台", description: "高點與元照共用 AI 學習中台測試入口" };

export default async function Page() {
  const [catalog, config] = await Promise.all([getV2Catalog(), getV2Config()]);
  return <V2Preview catalog={catalog} config={config} />;
}
