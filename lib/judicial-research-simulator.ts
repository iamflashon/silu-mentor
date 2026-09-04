import { searchJudicialCases } from "./judicial-search";

const CONCEPT_EXPANSIONS: Record<string, string[]> = {
  "慰撫金": ["精神慰撫金", "非財產上損害", "精神損害賠償"],
  "支付命令": ["督促程序", "民事訴訟法第五百零八條", "金錢給付請求"],
  "舉證責任": ["證明責任", "舉證責任分配", "高度蓋然性"],
  "正當防衛": ["現在不法侵害", "防衛過當", "刑法第二十三條"],
  "行政處分": ["撤銷訴訟", "行政行為", "處分性"],
  "不作為犯": ["保證人地位", "作為義務", "刑法第十五條"],
  "因果關係": ["相當因果關係", "客觀歸責", "因果歷程"],
  "違約金": ["違約金酌減", "民法第二百五十二條", "損害賠償預定"],
  "時效": ["消滅時效", "時效抗辯", "請求權時效"],
};

const QUESTION_WORDS = /(?:請問|想知道|是否|能否|可以|可否|應否|如何|怎麼|為何|什麼|哪些|有無|得否|的話|之情形|的情況|嗎|呢|？|\?)/g;

export type ResearchRound = {
  round: number;
  purpose: string;
  queries: string[];
};

export function planJudicialResearch(question: string): ResearchRound[] {
  const clean = question.replace(/[「」『』【】()（）]/g, " ").replace(/[，、；;。：:\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  const concepts = Object.keys(CONCEPT_EXPANSIONS).filter((term) => clean.includes(term));
  const clauses = clean.split(/\s+/).map((part) => part.replace(QUESTION_WORDS, "").trim()).filter((part) => part.length >= 2 && part.length <= 24);
  const fallback = clean.replace(QUESTION_WORDS, "").replace(/\s+/g, "").trim();
  const primary = [...new Set([...concepts, ...clauses, ...(fallback ? [fallback] : [])])].slice(0, 3);
  const expanded = [...new Set(concepts.flatMap((term) => CONCEPT_EXPANSIONS[term] ?? []))].filter((term) => !primary.includes(term)).slice(0, 4);
  const combinations = concepts.length >= 2 ? [`${concepts[0]} ${concepts[1]}`, `${concepts[1]} ${concepts[0]}`] : [];
  const rounds: ResearchRound[] = [];
  if (primary.length) rounds.push({ round: 1, purpose: "先查原始爭點與核心法律概念", queries: primary });
  if (expanded.length) rounds.push({ round: 2, purpose: "改用實務常見用語、法條語言與同義詞", queries: expanded });
  if (combinations.length) rounds.push({ round: 3, purpose: "交叉組合兩個爭點，尋找同時處理兩者的裁判", queries: combinations });
  return rounds.slice(0, 3);
}

function authorityScore(court: string) {
  if (/憲法法庭|司法院大法官/.test(court)) return 100;
  if (/最高行政法院|最高法院/.test(court)) return 85;
  if (/高等行政法院|高等法院/.test(court)) return 60;
  if (/地方法院|簡易庭/.test(court)) return 20;
  return 35;
}

export async function simulateJudicialResearch(question: string) {
  const plan = planJudicialResearch(question);
  const found = new Map<string, Awaited<ReturnType<typeof searchJudicialCases>>["results"][number] & { matchedQueries: string[]; score: number; reasons: string[] }>();
  const rounds = [];
  for (const step of plan) {
    const queryRuns = [];
    for (const query of step.queries) {
      const response = await searchJudicialCases({ query, limit: 8 });
      queryRuns.push({ query, hits: response.total });
      response.results.forEach((item, index) => {
        const existing = found.get(item.jid);
        const text = `${item.title} ${item.excerpt}`;
        const exact = text.includes(query);
        const score = authorityScore(item.court) + (exact ? 30 : 8) + Math.max(0, 8 - index);
        if (existing) {
          existing.score += exact ? 12 : 4;
          if (!existing.matchedQueries.includes(query)) existing.matchedQueries.push(query);
          if (existing.matchedQueries.length > 1 && !existing.reasons.includes("多種查法都命中")) existing.reasons.push("多種查法都命中");
        } else {
          const authority = authorityScore(item.court);
          found.set(item.jid, {
            ...item,
            fullText: "",
            matchedQueries: [query],
            score,
            reasons: [authority >= 85 ? "最高審級或具高度代表性" : authority >= 60 ? "高等審級裁判" : "符合查詢爭點", exact ? "摘要直接出現查詢詞" : "案件欄位或全文命中"],
          });
        }
      });
    }
    rounds.push({ ...step, queryRuns, uniqueCasesSoFar: found.size });
  }
  const results = [...found.values()].sort((left, right) => right.score - left.score || right.judgmentDate.localeCompare(left.judgmentDate)).slice(0, 20);
  return {
    question,
    mode: "research-simulation" as const,
    notice: "目前以多輪查詢、同義詞與法院層級模擬研究流程；向量語意相似度尚未啟用。",
    rounds,
    totalUniqueCases: found.size,
    results,
  };
}
