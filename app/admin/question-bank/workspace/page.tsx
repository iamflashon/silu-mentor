import DocumentQuestionWorkspace from "../../../medtech/admin/document-workspace/DocumentQuestionWorkspace";

export default async function CentralQuestionWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const supportedCategory = category === "accounting" ? "accounting" : category === "data-structure" ? "data-structure" : "medtech";
  return <DocumentQuestionWorkspace category={supportedCategory} central />;
}
