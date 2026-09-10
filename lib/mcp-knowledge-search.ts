import { mcpDatabase } from "./student-mcp-auth";

export type McpKnowledgeMatch = {
  id: string;
  title: string;
  category: string;
  content: string;
  sourceUrl: string;
};

export async function searchPublishedMcpKnowledge(query: string, limit = 6, scope: "all" | "anglepedia" = "all"): Promise<McpKnowledgeMatch[]> {
  const compact = query.trim().replace(/\s+/g, "").slice(0, 120);
  if (compact.length < 2) return [];
  const rows = await mcpDatabase().prepare(`
    SELECT id,title,category,content,source_url AS sourceUrl
    FROM mcp_knowledge_items
    WHERE status='published'
    ORDER BY reviewed_at DESC,updated_at DESC
    LIMIT 300
  `).all<McpKnowledgeMatch>();
  const grams = Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2));
  const items = (rows.results || []) as McpKnowledgeMatch[];
  return items.map((row: McpKnowledgeMatch) => {
    const haystack = `${row.category}${row.title}${row.content}`.replace(/\s+/g, "");
    const angleBoost = scope === "anglepedia" && /元照|anglepedia/i.test(haystack) ? 100 : 0;
    const baseScore = grams.reduce((sum, gram) => sum + (haystack.includes(gram) ? 1 : 0), 0)
      + (haystack.includes(compact) ? 30 : 0)
      + (compact.includes(row.title.replace(/\s+/g, "")) ? 20 : 0);
    return { row, score: baseScore + angleBoost, baseScore };
  }).filter(({ baseScore }: { row: McpKnowledgeMatch; score: number; baseScore: number }) => baseScore > 0)
    .sort((a: { row: McpKnowledgeMatch; score: number; baseScore: number }, b: { row: McpKnowledgeMatch; score: number; baseScore: number }) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(8, limit)))
    .map(({ row }: { row: McpKnowledgeMatch; score: number; baseScore: number }) => row);
}

export function formatMcpKnowledgeEvidence(rows: McpKnowledgeMatch[]) {
  if (!rows.length) return "";
  return `\n\n【MCP 管控中心已檢審通過的資料】\n${rows.map((row, index) => `${index + 1}. [${row.category}] ${row.title}\n${row.content}${row.sourceUrl ? `\n來源：${row.sourceUrl}` : ""}`).join("\n\n")}\n回答時只能依據以上已通過資料，不得使用草稿、待檢審或退回內容。`;
}
