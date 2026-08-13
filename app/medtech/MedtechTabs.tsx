export default function MedtechTabs({active}:{active:"chapters"|"random"|"wrong"|"guided"}){
  const tabs=[
    ["chapters","章節刷題","/medtech/chapters"],
    ["random","隨機模考","/medtech/practice"],
    ["wrong","錯題複習","/medtech/practice?wrongOnly=1"],
    ["guided","引導學習","/medtech/ai-study"],
  ];
  return <nav className="medtech-study-tabs" data-no-navigation-feedback aria-label="醫檢師學習模式">{tabs.map(([key,label,href])=><a className={active===key?"active":""} href={href} key={key}>{label}</a>)}</nav>;
}
