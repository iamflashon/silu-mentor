"use client";

import { useEffect, useRef, useState } from "react";
import { unzipSync, strFromU8 } from "fflate";

const symbols = ["°C","℃","α","β","γ","δ","μ","λ","±","×","÷","≠","≤","≥","≈","→","←","↔","％","‰","✓","✕","①","②","③","④"];

function normalizeTemperature(value:string){
  return value.replace(/(\d+(?:\.\d+)?)\s*(?:[oº°]\s*)?C(?=\s|冷|熱|保存|培養|$|<)/giu,"$1°C");
}

function cleanOfficeHtml(value:string){
  return value.replace(/<!--([\s\S]*?)-->/g,"").replace(/<(meta|link|style)[^>]*>[\s\S]*?<\/\1>/gi,"").replace(/\s(class|style|lang)=("[^"]*"|'[^']*')/gi,"");
}

export function RichQuestionEditor({label,value,onChange,compact=false}:{label:string;value:string;onChange:(value:string)=>void;compact?:boolean}){
  const ref=useRef<HTMLDivElement>(null); const fileRef=useRef<HTMLInputElement>(null); const [showSymbols,setShowSymbols]=useState(false); const [showTableGrid,setShowTableGrid]=useState(false); const [gridSize,setGridSize]=useState({rows:3,cols:4}); const [selectedCell,setSelectedCell]=useState<HTMLTableCellElement|null>(null); const [uploading,setUploading]=useState(false);
  useEffect(()=>{const normalized=normalizeTemperature(value||"");if(ref.current&&ref.current.innerHTML!==normalized)ref.current.innerHTML=normalized},[value]);
  function sync(){const normalized=normalizeTemperature(ref.current?.innerHTML??"");if(ref.current&&ref.current.innerHTML!==normalized)ref.current.innerHTML=normalized;onChange(normalized)}
  function command(name:string,arg?:string){ref.current?.focus();document.execCommand(name,false,arg);sync()}
  async function upload(file:File){
    if(!file.type.startsWith("image/"))return; setUploading(true);
    const form=new FormData();form.set("file",file);const response=await fetch("/api/medtech/admin/question-assets",{method:"POST",body:form});const data=await response.json() as {url?:string;error?:string};
    if(response.ok&&data.url)command("insertImage",data.url);else alert(data.error||"圖片上傳失敗");setUploading(false);
  }
  async function paste(event:React.ClipboardEvent<HTMLDivElement>){
    const image=[...event.clipboardData.items].find(item=>item.type.startsWith("image/"))?.getAsFile();
    if(image){event.preventDefault();await upload(image);return}
    const html=event.clipboardData.getData("text/html");if(html){event.preventDefault();document.execCommand("insertHTML",false,cleanOfficeHtml(html));sync()}
  }
  function insertTable(rows:number,cols:number){const cells=Array.from({length:rows},()=>`<tr>${Array.from({length:cols},()=>"<td><br></td>").join("")}</tr>`).join("");command("insertHTML",`<table><tbody>${cells}</tbody></table><p><br></p>`);setShowTableGrid(false)}
  function editTable(action:"rowAbove"|"rowBelow"|"deleteRow"|"colLeft"|"colRight"|"deleteCol"|"mergeRight"|"split"){
    const cell=selectedCell;if(!cell)return;const row=cell.parentElement as HTMLTableRowElement|null;const table=cell.closest("table");if(!row||!table)return;const cellIndex=cell.cellIndex;
    if(action==="rowAbove"||action==="rowBelow"){const next=row.cloneNode(true) as HTMLTableRowElement;[...next.cells].forEach(item=>item.innerHTML="<br>");row.parentElement?.insertBefore(next,action==="rowAbove"?row:row.nextSibling)}
    if(action==="deleteRow"){if(table.rows.length>1)row.remove();else table.remove();setSelectedCell(null)}
    if(action==="colLeft"||action==="colRight"){[...table.rows].forEach(item=>{const next=item.insertCell(Math.min(item.cells.length,cellIndex+(action==="colRight"?1:0)));next.innerHTML="<br>"})}
    if(action==="deleteCol"){[...table.rows].forEach(item=>{if(item.cells[cellIndex])item.deleteCell(cellIndex)});if(!table.rows[0]?.cells.length)table.remove();setSelectedCell(null)}
    if(action==="mergeRight"){const right=cell.nextElementSibling as HTMLTableCellElement|null;if(right){cell.innerHTML=`${cell.innerHTML}${cell.innerHTML&&right.innerHTML?" ":""}${right.innerHTML}`;cell.colSpan=(cell.colSpan||1)+(right.colSpan||1);right.remove()}}
    if(action==="split"&&cell.colSpan>1){const count=cell.colSpan;cell.colSpan=1;for(let index=1;index<count;index+=1){const next=document.createElement("td");next.innerHTML="<br>";cell.parentElement?.insertBefore(next,cell.nextSibling)}}
    sync();
  }
  return <label className={`rich-field ${compact?"compact":""}`}><span>{label}</span><div className="rich-toolbar" role="toolbar" aria-label={`${label}格式工具`} onMouseDown={event=>{if((event.target as HTMLElement).closest("button"))event.preventDefault()}}>
    <button type="button" title="粗體" onClick={()=>command("bold")}><b>B</b></button><button type="button" title="斜體" onClick={()=>command("italic")}><i>I</i></button><button type="button" title="底線" onClick={()=>command("underline")}><u>U</u></button>
    <button type="button" title="上標" onClick={()=>command("superscript")}>x²</button><button type="button" title="下標" onClick={()=>command("subscript")}>x₂</button><button type="button" title="插入項目符號" onClick={()=>command("insertUnorderedList")}>• 項目</button>
    <button type="button" title="新增表格" className={showTableGrid?"active":""} onClick={()=>{setShowTableGrid(!showTableGrid);setShowSymbols(false)}}>▦ 表格</button><button type="button" title="特殊符號" onClick={()=>{setShowSymbols(!showSymbols);setShowTableGrid(false)}}>Ω 符號</button><button type="button" title="插入圖片" onClick={()=>fileRef.current?.click()}>{uploading?"上傳中…":"▧ 圖片"}</button>
    <button type="button" title="復原" onClick={()=>command("undo")}>↶</button><button type="button" title="重做" onClick={()=>command("redo")}>↷</button><input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value=""}}/>
  </div>{showTableGrid&&<div className="table-grid-picker" onMouseDown={event=>event.preventDefault()}><div className="table-grid-cells">{Array.from({length:64},(_,index)=>{const row=Math.floor(index/8)+1,col=index%8+1,active=row<=gridSize.rows&&col<=gridSize.cols;return <button type="button" aria-label={`${row} 列 ${col} 欄`} className={active?"active":""} key={index} onMouseEnter={()=>setGridSize({rows:row,cols:col})} onClick={()=>insertTable(row,col)}/>})}</div><b>{gridSize.rows} × {gridSize.cols}</b></div>}{showSymbols&&<div className="symbol-palette">{symbols.map(x=><button type="button" key={x} title={x==="°C"?"攝氏溫度格式":"插入特殊符號"} onClick={()=>command("insertText",x)}>{x}</button>)}</div>}
  {selectedCell&&<div className="table-context-toolbar" onMouseDown={event=>event.preventDefault()}><span>表格編輯</span><button type="button" onClick={()=>editTable("rowAbove")}>上方加列</button><button type="button" onClick={()=>editTable("rowBelow")}>下方加列</button><button type="button" onClick={()=>editTable("deleteRow")}>刪除列</button><button type="button" onClick={()=>editTable("colLeft")}>左側加欄</button><button type="button" onClick={()=>editTable("colRight")}>右側加欄</button><button type="button" onClick={()=>editTable("deleteCol")}>刪除欄</button><button type="button" disabled={!selectedCell.nextElementSibling} onClick={()=>editTable("mergeRight")}>向右合併</button><button type="button" disabled={selectedCell.colSpan<=1} onClick={()=>editTable("split")}>拆分</button></div>}
  <div ref={ref} className="rich-canvas" contentEditable suppressContentEditableWarning data-placeholder={`輸入${label}，也可以直接貼上 Word 內容或截圖`} onClick={event=>{const cell=(event.target as HTMLElement).closest("td,th");setSelectedCell(cell&&ref.current?.contains(cell)?cell as HTMLTableCellElement:null)}} onInput={sync} onBlur={sync} onPaste={paste}/><small>可直接貼上 Word 格式與螢幕截圖；圖片會保存到醫檢題庫空間。</small></label>
}

export function SourceWorkspace(){
  const [url,setUrl]=useState("");const [name,setName]=useState("");const [docx,setDocx]=useState("");
  async function open(file:File){setName(file.name);if(url)URL.revokeObjectURL(url);setDocx("");if(file.name.toLowerCase().endsWith(".docx")){const zip=unzipSync(new Uint8Array(await file.arrayBuffer()));const xml=strFromU8(zip["word/document.xml"]);const parsed=new DOMParser().parseFromString(xml,"application/xml");const blocks=[...parsed.getElementsByTagName("w:p")].map(p=>[...p.getElementsByTagName("w:t")].map(t=>t.textContent||"").join("")).filter(Boolean);setDocx(blocks.map(x=>`<p>${x.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]!))}</p>`).join(""));setUrl("")}else setUrl(URL.createObjectURL(file))}
  return <aside className="source-workspace"><header><div><b>原稿對照</b><small>{name||"開啟 Word、PDF 或圖片"}</small></div><label className="source-open">開啟原稿<input hidden type="file" accept=".docx,.pdf,image/*" onChange={e=>{const f=e.target.files?.[0];if(f)void open(f)}}/></label></header>{docx?<article dangerouslySetInnerHTML={{__html:docx}}/>:url?<iframe src={url} title="題目來源原稿"/>:<div className="source-empty"><b>左右分割編輯</b><p>原稿只在本機瀏覽器開啟，不會另外上傳。選取 Word、PDF 或圖片後，可在右側逐題編輯。</p></div>}</aside>
}
