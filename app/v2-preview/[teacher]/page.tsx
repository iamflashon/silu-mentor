import { notFound } from "next/navigation";
import { getV2Catalog, getV2Config, type V2TeacherKey } from "../../../lib/v2-platform";
import TeacherWorkspace from "./TeacherWorkspace";

export default async function Page({ params, searchParams }: { params: Promise<{ teacher: string }>; searchParams: Promise<{ brand?: string }> }) {
  const [{ teacher }, query] = await Promise.all([params, searchParams]);
  if (!["pengli", "kangqing", "zhenghong"].includes(teacher)) notFound();
  const [catalog, config] = await Promise.all([getV2Catalog(), getV2Config()]);
  const key = teacher as V2TeacherKey;
  return <TeacherWorkspace teacher={catalog.teachers[key]} modules={config.teachers[key].modules} brand={query.brand === "angle" ? "angle" : "get"} />;
}
