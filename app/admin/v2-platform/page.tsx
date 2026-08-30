import { getV2Catalog, getV2Config } from "../../../lib/v2-platform";
import V2Admin from "./V2Admin";
import "../../v2-preview/v2.css";

export default async function Page() {
  const [catalog, config] = await Promise.all([getV2Catalog(), getV2Config()]);
  return <V2Admin catalog={catalog} initialConfig={config} />;
}
