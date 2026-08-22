import SourceQuestionWorkspace from "./SourceQuestionWorkspace";

export default async function SourceQuestionWorkspacePage({ searchParams }: { searchParams: Promise<{ sourceId?: string }> }) {
  const { sourceId } = await searchParams;
  return <SourceQuestionWorkspace sourceId={Number(sourceId ?? 0)} />;
}
