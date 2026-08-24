export type MedtechQualitySeverity = "P0" | "P1" | "P2";
export type MedtechQualityIssue = { field:string; kind:"private-use"|"replacement"|"chapter-boundary"|"formula"|"table"; severity:MedtechQualitySeverity; message:string; excerpt:string; autoFixable:boolean };

const PUA_REPLACEMENTS: Record<string,string> = {
  "\uf02d":"−", "\uf0b0":"°", "\uf03c":"<", "\uf03e":">", "\uf03d":"=", "\uf0b8":"÷", "\uf0b4":"×", "\uf061":"α", "\uf062":"β", "\uf067":"γ", "\uf0ae":"→", "\uf0d6":"√",
};

export function stripHtml(value:unknown){ return String(value??"").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/\s+/g," ").trim(); }
function excerpt(text:string,index:number){ return text.slice(Math.max(0,index-38),Math.min(text.length,index+62)).trim(); }

export function normalizeKnownPdfSymbols(value:string){
  let output=String(value??"");
  for(const [source,target] of Object.entries(PUA_REPLACEMENTS)) output=output.split(source).join(target);
  return output
    .replace(/(pH\s*)\uf020(\s*6\.6)/gi,"$1<$2")
    .replace(/(pH\s*)[□▢▯](\s*6\.6)/gi,"$1<$2")
    .replace(/([−-]?\d+(?:\.\d+)?)\s*[□▢▯]\s*C\b/g,"$1°C")
    .replace(/([\s(])□(70\s*°?C\b)/g,"$1−$2")
    .replace(/([\s(])□(20\s*°?C\b)/g,"$1−$2");
}

export function scanMedtechField(field:string,rawValue:unknown):MedtechQualityIssue[]{
  const text=stripHtml(rawValue); if(!text)return [];
  const issues:MedtechQualityIssue[]=[];
  for(const match of text.matchAll(/[\uE000-\uF8FF]/gu)){
    const char=match[0]; const sample=excerpt(text,match.index??0); issues.push({field,kind:"private-use",severity:"P0",message:`PDF 私人字元 U+${char.codePointAt(0)!.toString(16).toUpperCase()} 尚未標準化`,excerpt:sample,autoFixable:Boolean(PUA_REPLACEMENTS[char])||normalizeKnownPdfSymbols(sample)!==sample});
  }
  for(const match of text.matchAll(/[□▢▯�]/gu)){
    const sample=excerpt(text,match.index??0); issues.push({field,kind:"replacement",severity:"P0",message:"偵測到遺失／替代字元，需與 PDF 原稿核對",excerpt:sample,autoFixable:normalizeKnownPdfSymbols(sample)!==sample});
  }
  const chapter=/(?:第\s*\d+\s*章|第\s*\d+\s*節)/u.exec(text);
  if(chapter&&!/^(?:第\s*\d+\s*章|第\s*\d+\s*節)/u.test(text)&&["explanation","completeExplanation","teacherCompleteExplanation","aiCompleteExplanation"].includes(field)) issues.push({field,kind:"chapter-boundary",severity:"P1",message:"解析內容中出現章／節標題，可能把下一章節串入上一題",excerpt:excerpt(text,chapter.index),autoFixable:false});
  if(/MOI|pfu|×\s*10/u.test(text)&&/[□▢▯\uE000-\uF8FF]/u.test(text)) issues.push({field,kind:"formula",severity:"P0",message:"公式含特殊字元，應保留上標與 ×、÷、= 等運算結構",excerpt:text.slice(0,140),autoFixable:false});
  if(/(target|signal).{0,30}[□▢▯].{0,80}(target|signal)/iu.test(text)) issues.push({field,kind:"table",severity:"P1",message:"疑似表格被攤平成純文字，需回原稿重建欄列關係",excerpt:text.slice(0,180),autoFixable:false});
  return issues;
}

export function scanMedtechQuestion(question:Record<string,unknown>){
  const fields:Record<string,unknown>={stem:question.stem,explanation:question.explanation,completeExplanation:question.completeExplanation,teacherCompleteExplanation:question.teacherCompleteExplanation,aiCompleteExplanation:question.aiCompleteExplanation};
  const options=question.options&&typeof question.options==="object"?question.options as Record<string,unknown>:{};
  for(const letter of ["A","B","C","D"])fields[`option${letter}`]=options[letter];
  return Object.entries(fields).flatMap(([field,value])=>scanMedtechField(field,value));
}
