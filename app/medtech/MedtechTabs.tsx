export default function MedtechTabs({active}:{active?:"chapters"|"random"|"wrong"|"guided"|"notes"}){
  const tabs=[
    ["chapters","章節刷題","/medtech/chapters"],
    ["random","隨機模考","/medtech/random"],
    ["wrong","錯題複習","/medtech/practice?wrongOnly=1"],
    ["guided","引導學習","/medtech/ai-study"],
    ["notes","我的筆記","/medtech/notes"],
  ];
  return <nav className="medtech-study-tabs" aria-label="醫檢師學習模式">{tabs.map(([key,label,href])=><a className={active===key?"active":""} href={href} key={key}>{label}</a>)}</nav>;
}
