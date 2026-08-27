import CentralAdminTabs from "../CentralAdminTabs";
import PengliQuestionAdmin from "./PengliQuestionAdmin";
export default function Page(){return <main className="central-admin-page"><p className="eyebrow">PENGLI TEACHER INBOX</p><h1>彭狸學生疑問</h1><p>只處理 AI 查證後仍由學生轉交的疑問。</p><CentralAdminTabs active="pengli-questions"/><PengliQuestionAdmin/></main>}
