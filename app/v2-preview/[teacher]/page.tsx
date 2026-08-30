import { notFound, redirect } from "next/navigation";
import type { V2TeacherKey } from "../../../lib/v2-platform";

const officialSpaces: Record<V2TeacherKey, string> = {
  pengli: "/teachers/pengli",
  kangqing: "/medtech",
  zhenghong: "/accounting",
};

export default async function Page({ params }: { params: Promise<{ teacher: string }> }) {
  const { teacher } = await params;
  if (!Object.prototype.hasOwnProperty.call(officialSpaces, teacher)) notFound();
  redirect(officialSpaces[teacher as V2TeacherKey]);
}
