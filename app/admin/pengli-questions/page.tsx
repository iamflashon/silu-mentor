import CentralAdminTabs from "../CentralAdminTabs";
import PengliQuestionAdmin from "./PengliQuestionAdmin";
import "./pengli-questions.css";
export default function Page(){return <main className="central-admin-page pengli-inbox-page"><CentralAdminTabs active="pengli-questions"/><PengliQuestionAdmin/></main>}
