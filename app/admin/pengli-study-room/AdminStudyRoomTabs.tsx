"use client";

import { useState } from "react";
import StudyRoomStudio from "../../teachers/pengli/study-room/StudyRoomStudio";
import ArtifactManager from "./ArtifactManager";

type AdminTab = "create" | "publish";

export default function AdminStudyRoomTabs() {
  const [tab, setTab] = useState<AdminTab>("create");

  return <section className="admin-study-tabs">
    <nav className="admin-study-tablist" aria-label="學霸成果庫功能" role="tablist">
      <button type="button" role="tab" aria-selected={tab === "create"} className={tab === "create" ? "active" : ""} onClick={() => setTab("create")}>
        <span>01</span><b>產生學習內容</b><small>選擇主題與範本，預先建立共用教材</small>
      </button>
      <button type="button" role="tab" aria-selected={tab === "publish"} className={tab === "publish" ? "active" : ""} onClick={() => setTab("publish")}>
        <span>02</span><b>發布管理</b><small>編輯、批次發布、下架或刪除成果</small>
      </button>
    </nav>
    <div role="tabpanel" className="admin-study-tabpanel">
      {tab === "create" ? <StudyRoomStudio adminMode /> : <ArtifactManager />}
    </div>
  </section>;
}
