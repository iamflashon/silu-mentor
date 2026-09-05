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
  "僱用人責任": ["民法第一百八十八條", "執行職務", "選任監督"],
  "競業禁止": ["離職後競業禁止", "競業禁止約款", "勞動基準法第九條之一"],
  "補償": ["合理補償", "代償措施", "未給付補償"],
  "忠實義務": ["董事忠實義務", "公司法第二十三條", "善良管理人注意義務"],
  "原因自由行為": ["自陷責任能力", "刑法第十九條", "故意陷於精神障礙"],
  "因果歷程錯誤": ["因果流程錯誤", "因果關係錯誤", "客體錯誤"],
  "舉證責任減輕": ["證明度降低", "表見證明", "舉證責任倒置"],
  "侵害配偶身分法益": ["侵害配偶權", "配偶身分法益", "婚姻共同生活圓滿安全幸福"],
  "客觀歸責": ["製造法所不容許風險", "風險實現", "規範保護目的"],
  "漏水": ["修復漏水", "排除侵害", "民法第七百六十七條", "公寓大廈漏水"],
  "車禍": ["交通事故", "過失傷害", "汽車交通事故損害賠償"],
  "欠錢": ["返還借款", "清償債務", "消費借貸", "債務不履行"],
  "精神賠償": ["精神慰撫金", "非財產上損害", "民法第一百九十五條"],
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
  const clauses = clean.split(/\s+/).map((part) => part.replace(QUESTION_WORDS, "").trim()).filter((part) => part.length >= 2 && part.length <= 16);
  const fallback = clean.replace(/(?:是否|能否|可否|應否|如何|怎麼|為何|有無|得否).*$/g, "").replace(QUESTION_WORDS, "").replace(/\s+/g, "").trim().slice(0, 24);
  // Once a legal concept is recognized, never send the entire natural-language
  // question to the database as one literal phrase.
  const primary = [...new Set(concepts.length ? concepts : [...clauses, ...(fallback ? [fallback] : [])])].slice(0, 3);
  const expanded = [...new Set(concepts.flatMap((term) => CONCEPT_EXPANSIONS[term] ?? []))].filter((term) => !primary.includes(term)).slice(0, 4);
  const combinations = concepts.length >= 2 ? [`${concepts[0]} ${concepts[1]}`, `${concepts[1]} ${concepts[0]}`] : [];
  const procedureSpecific = concepts.includes("支付命令")
    ? [
        `${concepts.find((term) => term !== "支付命令") ?? ""} 聲請發支付命令`,
        `司促 ${concepts.find((term) => term !== "支付命令") ?? ""}`,
        `督促程序 ${concepts.find((term) => term !== "支付命令") ?? ""}`,
      ].map((query) => query.trim()).filter((query) => query.length > 2)
    : [];
  const rounds: ResearchRound[] = [];
  if (primary.length) rounds.push({ round: 1, purpose: "先查原始爭點與核心法律概念", queries: primary });
  if (expanded.length) rounds.push({ round: 2, purpose: "改用實務常見用語、法條語言與同義詞", queries: expanded });
  if (combinations.length) rounds.push({ round: 3, purpose: "交叉組合兩個爭點，尋找同時處理兩者的裁判", queries: combinations });
  if (procedureSpecific.length) rounds.push({ round: 4, purpose: "限定督促程序與聲請語境，排除僅引用催告法條的假命中", queries: procedureSpecific });
  return rounds.slice(0, 4);
}

function authorityScore(court: string) {
  if (/憲法法庭|司法院大法官/.test(court)) return 100;
  if (/最高行政法院|最高法院/.test(court)) return 85;
  if (/高等行政法院|高等法院/.test(court)) return 60;
  if (/地方法院|簡易庭/.test(court)) return 20;
  return 35;
}

function conceptVariants(concept: string) {
  return [concept, ...(CONCEPT_EXPANSIONS[concept] ?? [])];
}

function positionsOf(text: string, variants: string[]) {
  const positions: number[] = [];
  for (const variant of variants) {
    let position = text.indexOf(variant);
    while (position >= 0) {
      positions.push(position);
      position = text.indexOf(variant, position + variant.length);
    }
  }
  return positions.sort((left, right) => left - right);
}

function conceptsAreRelatedInText(text: string, concepts: string[]) {
  if (concepts.length <= 1) return concepts.every((concept) => positionsOf(text, conceptVariants(concept)).length > 0);
  const positions = concepts.map((concept) => positionsOf(text, conceptVariants(concept)));
  if (positions.some((list) => !list.length)) return false;
  // Merely appearing somewhere in the same long judgment is not enough. The
  // concepts must occur in the same local passage to support a combined issue.
  return positions[0].some((left) => positions.slice(1).every((list) => list.some((right) => Math.abs(left - right) <= 600)));
}

const PAYMENT_ORDER_PROCEDURE = /(?:聲請人.{0,80}聲請.{0,20}支付命令|債權人.{0,80}聲請.{0,20}支付命令|聲請(?:核發|發給|發)?支付命令|支付命令(?:之)?聲請|支付命令事件|對.{0,20}支付命令.{0,20}提出異議|支付命令.{0,50}視為起訴|支付命令.{0,50}(?:確定|失效)|駁回.{0,20}支付命令|核發.{0,20}支付命令)/;
const PAYMENT_ORDER_BOILERPLATE = /依督促程序送達支付命令.{0,100}(?:催告|同一效力)|支付命令之送達.{0,100}(?:催告|同一效力)/;

function classifyEvidence(text: string, caseType: string, coreConcepts: string[], coversAllConcepts: boolean) {
  if (!coversAllConcepts) return { evidenceLevel: "background" as const, evidenceReason: "未同時涵蓋全部核心爭點。" };
  if (!coreConcepts.includes("支付命令")) return { evidenceLevel: "direct" as const, evidenceReason: "裁判在同一脈絡處理全部核心爭點。" };
  const procedureContext = PAYMENT_ORDER_PROCEDURE.test(text) || /(?:司促|促)/.test(caseType);
  const boilerplateOnly = PAYMENT_ORDER_BOILERPLATE.test(text) && !PAYMENT_ORDER_PROCEDURE.test(text) && !/(?:司促|促)/.test(caseType);
  if (procedureContext && !boilerplateOnly) return { evidenceLevel: "direct" as const, evidenceReason: "裁判確實涉及支付命令聲請、異議或督促程序。" };
  return { evidenceLevel: "indirect" as const, evidenceReason: boilerplateOnly ? "支付命令只出現在催告或遲延利息的例行法條說明，並非本案程序。" : "兩個詞雖共同出現，但未能確認本案實際進入支付命令程序。" };
}

export async function simulateJudicialResearch(question: string) {
  const plan = planJudicialResearch(question);
  const coreConcepts = Object.keys(CONCEPT_EXPANSIONS).filter((term) => question.includes(term));
  const found = new Map<string, Awaited<ReturnType<typeof searchJudicialCases>>["results"][number] & { matchedQueries: string[]; score: number; reasons: string[] }>();
  const rounds = [];
  let cloudAvailableTotal = 0;
  for (const step of plan) {
    const queryRuns = [];
    for (const query of step.queries) {
      const response = await searchJudicialCases({ query, limit: 8 });
      cloudAvailableTotal = Math.max(cloudAvailableTotal, response.availableTotal);
      queryRuns.push({ query, matched: response.total, returned: response.returned, limit: response.limit });
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
            matchedQueries: [query],
            score,
            reasons: [authority >= 85 ? "最高審級或具高度代表性" : authority >= 60 ? "高等審級裁判" : "符合查詢爭點", exact ? "摘要直接出現查詢詞" : "案件欄位或全文命中"],
          });
        }
      });
    }
    rounds.push({ ...step, queryRuns, uniqueCasesSoFar: found.size });
  }
  const ranked = [...found.values()].map((item) => {
    const evidence = `${item.title} ${item.excerpt} ${item.fullText}`;
    const matchedConcepts = coreConcepts.filter((concept) => positionsOf(evidence, conceptVariants(concept)).length > 0);
    const missingConcepts = coreConcepts.filter((concept) => !matchedConcepts.includes(concept));
    const locallyRelated = conceptsAreRelatedInText(evidence, coreConcepts);
    const coversAllConcepts = (coreConcepts.length <= 1 || missingConcepts.length === 0) && locallyRelated;
    const displayedMissingConcepts = missingConcepts.length
      ? missingConcepts
      : (!locallyRelated && coreConcepts.length > 1 ? ["兩個概念未在同一段落形成關聯"] : []);
    const confidence = coversAllConcepts && item.matchedQueries.length > 1 ? "high" : coversAllConcepts ? "medium" : "low";
    const classification = classifyEvidence(evidence, item.caseType, coreConcepts, coversAllConcepts);
    const { fullText: _fullText, ...safeItem } = item;
    return {
      ...safeItem,
      score: item.score + matchedConcepts.length * 20 - missingConcepts.length * 35,
      matchedConcepts,
      missingConcepts: displayedMissingConcepts,
      confidence,
      ...classification,
      eligibleDeepRead: classification.evidenceLevel !== "background",
      reasons: coversAllConcepts
        ? [...item.reasons, ...(coreConcepts.length > 1 ? ["核心概念在同一段落附近出現"] : [])]
        : [...item.reasons, missingConcepts.length ? `缺少核心爭點：${missingConcepts.join("、")}` : "兩個概念僅分散出現，未形成同一爭點"],
    };
  }).sort((left, right) => {
    const rank = { direct: 2, indirect: 1, background: 0 };
    return rank[right.evidenceLevel] - rank[left.evidenceLevel] || right.score - left.score || right.judgmentDate.localeCompare(left.judgmentDate);
  });
  const results = ranked.filter((item) => item.evidenceLevel === "direct").slice(0, 20);
  const supportingCandidates = ranked.filter((item) => item.evidenceLevel === "indirect").slice(0, 12);
  const exploratoryCandidates = ranked.filter((item) => item.evidenceLevel === "background").slice(0, 12);
  const answerability = results.length ? "directly-supported" : supportingCandidates.length ? "indirect-only" : "no-evidence";
  return {
    question,
    mode: "research-simulation" as const,
    notice: "目前以多輪查詢、同義詞與法院層級模擬研究流程；向量語意相似度尚未啟用。",
    cloudAvailableTotal,
    rounds,
    totalUniqueCases: found.size,
    qualifiedCases: results.length,
    directEvidenceCount: results.length,
    indirectEvidenceCount: supportingCandidates.length,
    backgroundEvidenceCount: ranked.filter((item) => item.evidenceLevel === "background").length,
    answerability,
    conclusionGuard: results.length
      ? "可依直接證據回答，但仍須讀取全文確認裁判意旨與適用範圍。"
      : "禁止依本次資料庫搜尋對問題作肯定或否定結論。只能說尚未找到直接裁判；如另依法律條文或一般法理推論，必須明確標示那不是本次裁判搜尋所得。",
    assessment: results.length
      ? `找到 ${results.length} 篇直接處理主要爭點的裁判，可進一步深讀。`
      : `目前沒有找到直接處理「${coreConcepts.join("＋") || question}」的裁判。間接或背景資料不能用來回答可以或不可以。`,
    results,
    supportingCandidates,
    exploratoryCandidates,
  };
}
