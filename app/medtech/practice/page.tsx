"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Q = { n:number; stem:string; options:string[]; answer:string; topic:string };
const rows: Q[] = [
 {n:1,stem:"有關抗巨細胞病毒藥物 Ganciclovir 的敘述，下列何者錯誤？",options:["是 guanosine 的核苷類似物","可治療巨細胞病毒性視網膜炎","須經 CMV UL97 kinase 磷酸化後才具活性","CMV thymidine kinase 突變可能導致抗藥性"],answer:"C",topic:"抗病毒藥物"},
 {n:2,stem:"EBV 感染所引起的 Burkitt lymphoma，其血清抗體檢測結果應為何？",options:["VCA IgG（+）/ EA IgA（+）/ EBNA IgG（+）","VCA IgG（-）/ EA IgG（+）/ EBNA IgG（+）","VCA IgG（+）/ EA IgG（+）/ EBNA IgG（+）","VCA IgA（+）/ EA IgG（+）/ EBNA IgG（-）"],answer:"D",topic:"疱疹病毒"},
 {n:3,stem:"下列何種血球細胞檢驗最能代表 AIDS 病人的疾病嚴重度？",options:["B 淋巴細胞","CD4+ T 細胞","CD8+ T 細胞","嗜中性白血球"],answer:"C",topic:"反轉錄病毒"},
 {n:4,stem:"關於 HPV 分子檢測的敘述，下列何者錯誤？",options:["採集子宮頸細胞檢驗","通常以液基細胞學保存液保存","主要檢測病毒 DNA","可用 Hybrid capture DNA 探針同時檢驗多種高風險基因型"],answer:"B",topic:"DNA 病毒"},
 {n:5,stem:"遭血液污染針頭刺傷後出現肝炎情形，下列何種肝炎病毒感染可能性最低？",options:["E 型肝炎病毒","B 型肝炎病毒","C 型肝炎病毒","D 型肝炎病毒"],answer:"D",topic:"肝炎病毒"},
 {n:6,stem:"關於呼吸道病毒感染，下列敘述何者正確？",options:["SARS-CoV-2 Delta 感染可能導致肺炎併發 ARDS","鼻病毒主要症狀為氣喘","腺病毒主要引起 ARDS","副流感病毒主要引起肺炎"],answer:"A",topic:"呼吸道病毒"},
 {n:7,stem:"抗流感病毒藥物 oseltamivir 的作用標的是？",options:["M1 protein","M2 protein","Hemagglutinin（HA）","Neuraminidase（NA）"],answer:"A",topic:"抗病毒藥物"},
 {n:8,stem:"春節前老人長照中心發生呼吸道群聚感染，最優先考慮哪一種病毒？",options:["輪狀病毒","CMV","諾羅病毒","SARS-CoV-2 Omicron"],answer:"D",topic:"呼吸道病毒"},
 {n:9,stem:"有關腸病毒的敘述，下列何者錯誤？",options:["感染者糞便可含病毒且 RT-PCR 陽性","小兒麻痺病毒屬腸病毒屬","在咽喉黏膜細胞不大量複製","臺灣及東南亞流行之腸病毒 D 型易致幼兒手足口症及神經後遺症"],answer:"D",topic:"腸病毒"},
 {n:10,stem:"有關鼻病毒感染之敘述，下列何者不正確？",options:["病毒與下呼吸道肺細胞 ICAM-1 受體結合","在上呼吸道 ICAM-1 結合並有效複製","肺泡巨噬細胞無法阻止病毒複製，可用中和試驗分型","下呼吸道 IgA 無法阻止病毒複製，可用 Paxlovid 治療"],answer:"D",topic:"呼吸道病毒"},
 {n:11,stem:"抗 B 型肝炎病毒藥物 lamivudine 是抑制何種病毒酵素？",options:["蛋白酶","RNA-dependent DNA 聚合酶","DNA-dependent RNA 聚合酶","神經胺酸酶"],answer:"D",topic:"抗病毒藥物"},
 {n:12,stem:"有關病毒減毒活疫苗的敘述，下列何者錯誤？",options:["SARS-CoV-2 BNT mRNA 疫苗可刺激 IgM、IgG","有突變回野生型風險","可刺激 IgA","可刺激體液與細胞免疫"],answer:"B",topic:"疫苗"},
 {n:13,stem:"直接免疫螢光法檢測 SARS-CoV-2 S 抗原，螢光物質標定在何處？",options:["二級 S 抗體","病毒 S 抗原","一級 S 抗體","人類 N 抗體"],answer:"A",topic:"病毒檢驗"},
 {n:14,stem:"細胞培養液中何種物質會干擾 Influenza virus 培養？",options:["antibiotics","Hanks' balanced salt solution","serum","TPCK trypsin"],answer:"C",topic:"病毒培養"},
 {n:15,stem:"直接免疫螢光染色試驗中 Evans blue 的作用目的為何？",options:["背景染色劑","媒染劑","脫色劑","鹼性染料初染液"],answer:"C",topic:"病毒檢驗"},
 {n:16,stem:"何種 SARS-CoV-2 檢測可追查傳播來源並偵測病毒變異株？",options:["NASBA","SSCP","NGS sequencing","bDNA assay"],answer:"A",topic:"分子檢驗"},
 {n:17,stem:"有關 JC 病毒特性的敘述，下列何者正確？",options:["有外套膜","一般人感染為無症狀","不會潛藏在腎臟及腦","復發後可能導致出血性膀胱炎"],answer:"C",topic:"DNA 病毒"},
 {n:18,stem:"何種病毒複製形成的包涵體被形容為 Owl's eye？",options:["HSV","HPV","VZV","CMV"],answer:"B",topic:"疱疹病毒"},
 {n:19,stem:"下列何者主要傳染途徑為第一次呼吸道或接觸？",options:["HSV-1","EBV","VZV","HBV"],answer:"D",topic:"病毒傳播"},
 {n:20,stem:"有關 HHV-6 引發玫瑰疹的敘述，下列何者錯誤？",options:["潛伏期約 4～7 天並有淋巴結炎","發燒可達 40 度，主要感染 T 細胞","退燒後出現全身性紅疹","常用間接免疫螢光或 RT-PCR 檢查並可用限制酶分型"],answer:"C",topic:"疱疹病毒"},
 {n:21,stem:"下列何種病毒較可能發生基因體嵌入宿主染色體？",options:["HCV","SARS-CoV-2","HIV","腺病毒"],answer:"D",topic:"反轉錄病毒"},
 {n:22,stem:"有關 HSV 的敘述，下列何者錯誤？",options:["主要為接觸傳染","HSV-1 是散發性致死病毒性腦炎常見病因之一","可潛藏於三叉神經節，病毒外殼有 gA～gK","壓力及免疫抑制可能導致復發"],answer:"C",topic:"疱疹病毒"},
 {n:23,stem:"有關 Scrapie-like prion protein（PrPsc）的敘述，下列何者正確？",options:["具抗原性","會引發發炎反應","可用西方墨點法檢測 PrPsc 蛋白","潛伏期短"],answer:"B",topic:"普利昂"},
 {n:24,stem:"下列何者屬於 Poxviridae？",options:["HOC43","VZV","Molluscum contagiosum virus","Zika virus"],answer:"C",topic:"DNA 病毒"},
 {n:25,stem:"胎兒遭 B 型肝炎病毒感染，出生時最可能有何種狀況？",options:["肝癌","死亡","慢性感染","生長遲緩"],answer:"C",topic:"肝炎病毒"},
 {n:26,stem:"何種實驗診斷最能得知 B 型肝炎病毒造成 HCC 的反應？",options:["測病毒載量","測 ccc DNA","測 IgG","pre C 基因突變"],answer:"C",topic:"肝炎病毒"},
 {n:27,stem:"有關 Parvovirus B19 的敘述，下列何者錯誤？",options:["是單股 DNA 病毒","感染骨髓紅血球前驅細胞","可用 PCR 檢驗","可造成 sixth disease"],answer:"B",topic:"DNA 病毒"},
 {n:28,stem:"有關肝炎病毒診斷，下列何者正確？",options:["A 型近期感染常檢測 Anti-HAV IgM","HBeAg 消失代表病毒完全清除","HCV 病毒與抗體共存代表自動痊癒","D 型肝炎最易由飲食感染"],answer:"D",topic:"肝炎病毒"},
 {n:29,stem:"何種節媒病毒科具外套膜，且多數可穿過蟲卵並在卵中越冬？",options:["Togaviridae","Reoviridae","Flaviviridae","Bunyaviridae"],answer:"A",topic:"節媒病毒"},
 {n:30,stem:"有關 Ebola virus 的敘述，下列何者錯誤？",options:["可經黏膜接觸感染者血液感染","NP 與 VP40 參與核衣殼及細胞膜作用","果蝠被認為是可能天然宿主，病毒在細胞質複製","病毒為負股 RNA，目前沒有載體疫苗"],answer:"C",topic:"RNA 病毒"},
];
const letters = ["A","B","C","D"];
export default function MedtechPractice() {
 const [index,setIndex]=useState(0); const [answers,setAnswers]=useState<Record<number,string>>({}); const [submitted,setSubmitted]=useState(false); const [flagged,setFlagged]=useState<number[]>([]); const q=rows[index];
 const score=useMemo(()=>rows.filter(item=>answers[item.n]===item.answer).length,[answers]);
 const topics=useMemo(()=>Object.entries(rows.reduce<Record<string,{all:number;right:number}>>((acc,item)=>{acc[item.topic]??={all:0,right:0};acc[item.topic].all++;if(answers[item.n]===item.answer)acc[item.topic].right++;return acc;},{})).sort((a,b)=>(a[1].right/a[1].all)-(b[1].right/b[1].all)),[answers]);
 if(submitted) return <main className="medtech-practice"><header className="medtech-top"><Link href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>臨床病毒學</small></div></Link><nav><Link href="/medtech">首頁</Link><Link href="/medtech/practice" className="active">練國考題</Link></nav></header><section className="medtech-result"><span>測試結果</span><h1>{score}<small>／30 題</small></h1><p>作答 {Object.keys(answers).length} 題 · 答對率 {Math.round(score/30*100)}%</p><div>{topics.map(([name,value])=><article key={name}><b>{name}</b><span>{value.right}／{value.all}</span><i><em style={{width:`${value.right/value.all*100}%`}} /></i></article>)}</div><aside>教材附錄答案仍在校對階段；本次結果用來驗證測驗流程，不作為正式成績依據。</aside><button onClick={()=>{setSubmitted(false);setIndex(0)}}>查看作答內容</button></section></main>;
 return <main className="medtech-practice"><header className="medtech-top"><Link href="/medtech" className="medtech-brand"><span>醫</span><div><b>醫檢師備考</b><small>臨床病毒學</small></div></Link><nav><Link href="/medtech">首頁</Link><Link href="/medtech/practice" className="active">練國考題</Link></nav></header><section className="medtech-exam-head"><div><span>全真模擬 · 測試樣本</span><h1>臨床病毒學（下）</h1><p>第 {index+1}／30 題 · {q.topic}</p></div><button onClick={()=>setSubmitted(true)}>交卷</button></section><div className="medtech-exam-grid"><aside className="medtech-question-map"><header><b>題號</b><span>{Object.keys(answers).length}／30 已作答</span></header><div>{rows.map((item,i)=><button key={item.n} className={`${i===index?"active":""} ${answers[item.n]?"answered":""} ${flagged.includes(item.n)?"flagged":""}`} onClick={()=>setIndex(i)}>{item.n}</button>)}</div><small>實心＝已作答 · 圓點＝待確認</small></aside><section className="medtech-question"><header><span>第 {q.n} 題</span><button onClick={()=>setFlagged(v=>v.includes(q.n)?v.filter(n=>n!==q.n):[...v,q.n])}>{flagged.includes(q.n)?"取消標記":"標記待確認"}</button></header><h2>{q.stem}</h2><div className="medtech-options">{q.options.map((option,i)=>{const letter=letters[i];const chosen=answers[q.n]===letter;return <button className={chosen?"selected":""} key={letter} onClick={()=>setAnswers({...answers,[q.n]:letter})}><b>{letter}</b><span>{option}</span></button>})}</div><footer><button disabled={index===0} onClick={()=>setIndex(index-1)}>上一題</button><span>答案在交卷前不顯示</span><button disabled={index===rows.length-1} onClick={()=>setIndex(index+1)}>下一題</button></footer></section></div></main>;
}
