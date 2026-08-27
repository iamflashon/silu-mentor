import TeacherInbox from "./TeacherInbox";
import "../../../admin/pengli-questions/pengli-questions.css";

export default function Page(){return <main className="pengli-inbox-page"><header className="pengli-teacher-inbox-head"><div><h1>我的待回答</h1><p>只顯示管理員確認後、指定給你的彭狸學生疑問。</p></div><a href="/account">返回我的帳號</a></header><TeacherInbox/></main>}
