import type { Metadata } from "next";
import StudyRoomStudio from "../../teachers/pengli/study-room/StudyRoomStudio";
import ArtifactManager from "./ArtifactManager";
import "../../study-room.css";
import "../../teachers/pengli/study-room/studio.css";

export const metadata: Metadata = { title: "學霸成果庫｜彭狸行政法後台" };

export default function PengliStudyRoomAdminPage() {
  return <main className="study-room legal">
    <header className="study-room-top"><a className="study-room-brand" href="/admin/library"><span>彭</span><div><b>學霸成果庫</b><small>ADMIN · SHARED LEARNING CONTENT</small></div></a><nav><a href="/admin/library">返回中央總管理</a><a href="/teachers/pengli/study-room">查看學生端</a></nav></header>
    <section className="study-room-head"><span>管理者無限生成 · 不扣使用次數</span><h1>彭狸行政法學習內容</h1><p>先選擇主題與範本產生內容。學生使用相同設定時會直接讀取這份成果，不再重複產生成本或扣除使用次數。</p></section>
    <ArtifactManager />
    <StudyRoomStudio adminMode />
  </main>;
}
