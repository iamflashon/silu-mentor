import { notFound } from "next/navigation";
import { getV2Catalog, getV2Config, type V2TeacherKey } from "../../../lib/v2-platform";
import TeacherWorkspace from "./TeacherWorkspace";

export default async function Page({ params, searchParams }: { params: Promise<{ teacher: string }>; searchParams: Promise<{ brand?: string }> }) {
  const [{ teacher }, query] = await Promise.all([params, searchParams]);
  if (!["pengli", "kangqing", "zhenghong"].includes(teacher)) notFound();
  const [catalog, config] = await Promise.all([getV2Catalog(), getV2Config()]);
  const key = teacher as V2TeacherKey;
  const space = config.teachers[key];
  if (!space.enabled || space.status !== "published") notFound();
  return <TeacherWorkspace teacher={{ ...catalog.teachers[key], name: space.name, subject: space.subject }} zoneTitle={space.zoneTitle} summary={space.summary} modules={space.modules} brand={query.brand === "angle" ? "angle" : "get"} />;
}
