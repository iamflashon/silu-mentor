import CentralAdminTabs from "../CentralAdminTabs";
import PengliBookMap from "./PengliBookMap";
import "./pengli-book-map.css";

export default function Page() {
  return <main className="central-admin-page pengli-map-page"><CentralAdminTabs active="pengli-book-map"/><PengliBookMap/></main>;
}
